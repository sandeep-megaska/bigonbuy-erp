-- Employee portal auth sessions + login

create table if not exists public.erp_employee_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  session_token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_seen_at timestamptz null,
  user_agent text null,
  ip inet null
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_auth_sessions'
      and column_name = 'user_id'
  ) then
    alter table public.erp_employee_auth_sessions
      rename column user_id to employee_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_auth_sessions'
      and column_name = 'token_hash'
  ) then
    alter table public.erp_employee_auth_sessions
      rename column token_hash to session_token_hash;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_auth_sessions'
      and column_name = 'ip'
      and data_type <> 'inet'
  ) then
    alter table public.erp_employee_auth_sessions
      alter column ip
      type inet
      using nullif(trim(split_part(ip, ',', 1)), '')::inet;
  end if;
end
$$;

alter table public.erp_employee_auth_sessions
  add column if not exists employee_id uuid,
  add column if not exists session_token_hash text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists user_agent text,
  add column if not exists ip inet;

update public.erp_employee_auth_sessions s
   set employee_id = au.employee_id
  from public.erp_employee_auth_users au
 where s.employee_id = au.id
   and s.company_id = au.company_id;

delete from public.erp_employee_auth_sessions
 where employee_id is null;

delete from public.erp_employee_auth_sessions
 where session_token_hash is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_auth_sessions_user_id_fkey'
  ) then
    alter table public.erp_employee_auth_sessions
      drop constraint erp_employee_auth_sessions_user_id_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_auth_sessions_employee_id_fkey'
  ) then
    alter table public.erp_employee_auth_sessions
      add constraint erp_employee_auth_sessions_employee_id_fkey
      foreign key (employee_id)
      references public.erp_employees (id)
      on delete cascade;
  end if;
end
$$;

alter table public.erp_employee_auth_sessions
  alter column employee_id set not null,
  alter column session_token_hash set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_auth_sessions_session_token_hash_key'
  ) then
    alter table public.erp_employee_auth_sessions
      add constraint erp_employee_auth_sessions_session_token_hash_key
      unique (session_token_hash);
  end if;
end
$$;

drop index if exists public.erp_employee_auth_sessions_company_token_idx;
drop index if exists public.erp_employee_auth_sessions_company_user_idx;

create index if not exists erp_employee_auth_sessions_company_employee_revoked_idx
  on public.erp_employee_auth_sessions (company_id, employee_id, revoked_at);

create index if not exists erp_employee_auth_sessions_token_hash_idx
  on public.erp_employee_auth_sessions (session_token_hash);

create index if not exists erp_employee_auth_sessions_expires_at_idx
  on public.erp_employee_auth_sessions (expires_at);

-- Clean up legacy session create helper

drop function if exists public.erp_employee_session_create(uuid, text, text, timestamptz, text, text);

-- Employee login + session issuance

drop function if exists public.erp_employee_auth_login(text, text, text, inet);

create function public.erp_employee_auth_login(
  p_employee_code text,
  p_password text,
  p_user_agent text default null,
  p_ip inet default null
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  display_name text,
  session_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_employee_code text;
  v_display_name text;
  v_password_hash text;
  v_is_active boolean;
  v_session_token text;
  v_session_token_hash text;
  v_expires_at timestamptz;
  v_session_ttl interval := interval '30 days';
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_employee_code is null or trim(p_employee_code) = '' then
    raise exception 'employee_code is required';
  end if;

  if p_password is null or p_password = '' then
    raise exception 'password is required';
  end if;

  select e.company_id,
         e.id,
         e.employee_code,
         coalesce(nullif(e.full_name, ''), e.employee_code),
         au.password_hash,
         au.is_active
    into v_company_id,
         v_employee_id,
         v_employee_code,
         v_display_name,
         v_password_hash,
         v_is_active
  from public.erp_employees e
  join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.employee_code = p_employee_code;

  if v_employee_id is null or v_password_hash is null then
    raise exception 'Invalid employee credentials';
  end if;

  if not coalesce(v_is_active, false) then
    raise exception 'Employee login is disabled';
  end if;

  if v_password_hash <> crypt(p_password, v_password_hash) then
    raise exception 'Invalid employee credentials';
  end if;

  v_session_token := gen_random_uuid()::text || random()::text;
  v_session_token_hash := encode(digest(v_session_token, 'sha256'), 'hex');
  v_expires_at := now() + v_session_ttl;

  insert into public.erp_employee_auth_sessions (
    company_id,
    employee_id,
    session_token_hash,
    expires_at,
    user_agent,
    ip,
    last_seen_at
  ) values (
    v_company_id,
    v_employee_id,
    v_session_token_hash,
    v_expires_at,
    nullif(trim(coalesce(p_user_agent, '')), ''),
    p_ip,
    now()
  );

  update public.erp_employee_auth_users
     set last_login_at = now(),
         updated_at = now()
   where company_id = v_company_id
     and employee_id = v_employee_id;

  company_id := v_company_id;
  employee_id := v_employee_id;
  employee_code := v_employee_code;
  display_name := v_display_name;
  session_token := v_session_token;
  expires_at := v_expires_at;
  return next;
end;
$$;

revoke all on function public.erp_employee_auth_login(text, text, text, inet) from public;
grant execute on function public.erp_employee_auth_login(text, text, text, inet) to service_role;

-- Session lookup + revoke

drop function if exists public.erp_employee_session_get(uuid, text);

create function public.erp_employee_session_get(
  p_company_id uuid,
  p_session_token_hash text
) returns table (
  employee_id uuid,
  company_id uuid,
  employee_code text,
  display_name text,
  roles text[],
  permissions text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_employee_code text;
  v_display_name text;
  v_roles text[];
  v_permissions text[];
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_session_token_hash is null or trim(p_session_token_hash) = '' then
    raise exception 'session_token_hash is required';
  end if;

  select e.id,
         e.employee_code,
         coalesce(nullif(e.full_name, ''), e.employee_code),
         s.expires_at,
         s.revoked_at
    into v_employee_id, v_employee_code, v_display_name, v_expires_at, v_revoked_at
  from public.erp_employee_auth_sessions s
  join public.erp_employee_auth_users au
    on au.employee_id = s.employee_id
   and au.company_id = s.company_id
   and au.is_active
  join public.erp_employees e
    on e.id = s.employee_id
   and e.company_id = s.company_id
  where s.company_id = p_company_id
    and s.session_token_hash = p_session_token_hash
  order by s.created_at desc
  limit 1;

  if v_employee_id is null then
    raise exception 'Session not found';
  end if;

  if v_revoked_at is not null then
    raise exception 'Session revoked';
  end if;

  if v_expires_at <= now() then
    raise exception 'Session expired';
  end if;

  update public.erp_employee_auth_sessions
     set last_seen_at = now()
   where company_id = p_company_id
     and session_token_hash = p_session_token_hash
     and revoked_at is null;

  select array_agg(er.role_key)
    into v_roles
  from public.erp_employee_roles er
  where er.company_id = p_company_id
    and er.employee_id = v_employee_id;

  if v_roles is null or array_length(v_roles, 1) = 0 then
    v_roles := array['employee'];
  end if;

  select array_agg(distinct rp.permission_code)
    into v_permissions
  from public.erp_role_permissions rp
  where rp.company_id = p_company_id
    and rp.role_key = any (v_roles);

  employee_id := v_employee_id;
  company_id := p_company_id;
  employee_code := v_employee_code;
  display_name := v_display_name;
  roles := v_roles;
  permissions := coalesce(v_permissions, array[]::text[]);
  return next;
end;
$$;

revoke all on function public.erp_employee_session_get(uuid, text) from public;
grant execute on function public.erp_employee_session_get(uuid, text) to service_role;

drop function if exists public.erp_employee_session_revoke(uuid, uuid);
drop function if exists public.erp_employee_session_revoke(uuid, text);

create function public.erp_employee_session_revoke(
  p_company_id uuid,
  p_session_token_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_session_token_hash is null or trim(p_session_token_hash) = '' then
    raise exception 'session_token_hash is required';
  end if;

  update public.erp_employee_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
   where company_id = p_company_id
     and session_token_hash = p_session_token_hash;
end;
$$;

revoke all on function public.erp_employee_session_revoke(uuid, text) from public;
grant execute on function public.erp_employee_session_revoke(uuid, text) to service_role;
