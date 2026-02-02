-- Employee portal auth events + password management

create table if not exists public.erp_employee_auth_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  event_type text not null,
  actor_user_id uuid null,
  ip inet null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists erp_employee_auth_events_company_employee_created_idx
  on public.erp_employee_auth_events (company_id, employee_id, created_at desc);

create index if not exists erp_employee_auth_events_company_type_created_idx
  on public.erp_employee_auth_events (company_id, event_type, created_at desc);

alter table public.erp_employee_auth_events enable row level security;
alter table public.erp_employee_auth_events force row level security;

do $$
begin
  drop policy if exists erp_employee_auth_events_service_role on public.erp_employee_auth_events;
  create policy erp_employee_auth_events_service_role
    on public.erp_employee_auth_events
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

  drop policy if exists erp_employee_auth_events_select_company on public.erp_employee_auth_events;
  create policy erp_employee_auth_events_select_company
    on public.erp_employee_auth_events
    for select
    using (
      exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = erp_employee_auth_events.company_id
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'hr')
      )
    );
end
$$;

alter table public.erp_employee_auth_sessions
  add column if not exists revoked_at timestamptz null;

drop function if exists public.erp_employee_auth_admin_reset_password(uuid, uuid);

create function public.erp_employee_auth_admin_reset_password(
  p_company_id uuid,
  p_employee_id uuid
) returns table (temp_password text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_temp_password text;
  v_password_hash text;
begin
  if p_company_id is null or p_employee_id is null then
    raise exception 'company_id and employee_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  select string_agg(substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1), '')
    into v_temp_password
  from generate_series(1, 12);

  v_password_hash := extensions.crypt(v_temp_password, extensions.gen_salt('bf'));

  insert into public.erp_employee_auth_users (
    company_id,
    employee_id,
    password_hash,
    is_active,
    must_reset_password,
    created_at,
    updated_at,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_employee_id,
    v_password_hash,
    true,
    true,
    now(),
    now(),
    auth.uid(),
    auth.uid()
  )
  on conflict (company_id, employee_id)
  do update set
    password_hash = excluded.password_hash,
    is_active = true,
    must_reset_password = true,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.erp_employee_auth_events (
    company_id,
    employee_id,
    event_type,
    actor_user_id
  ) values (
    p_company_id,
    p_employee_id,
    'reset_password',
    auth.uid()
  );

  temp_password := v_temp_password;
  return next;
end;
$$;

revoke all on function public.erp_employee_auth_admin_reset_password(uuid, uuid) from public;
grant execute on function public.erp_employee_auth_admin_reset_password(uuid, uuid) to authenticated;

drop function if exists public.erp_employee_auth_change_password(text, text, text);

create function public.erp_employee_auth_change_password(
  p_session_token text,
  p_old_password text,
  p_new_password text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_token_hash text;
  v_company_id uuid;
  v_employee_id uuid;
  v_password_hash text;
  v_new_password_hash text;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_min_length int := 8;
begin
  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  if p_old_password is null or p_old_password = '' then
    raise exception 'old_password is required';
  end if;

  if p_new_password is null or length(trim(p_new_password)) < v_min_length then
    raise exception 'New password must be at least 8 characters';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  select s.company_id,
         s.employee_id,
         s.expires_at,
         s.revoked_at
    into v_company_id,
         v_employee_id,
         v_expires_at,
         v_revoked_at
  from public.erp_employee_auth_sessions s
  where s.session_token_hash = v_session_token_hash
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

  select au.password_hash
    into v_password_hash
  from public.erp_employee_auth_users au
  where au.company_id = v_company_id
    and au.employee_id = v_employee_id;

  if v_password_hash is null then
    raise exception 'Employee login not found';
  end if;

  if v_password_hash <> extensions.crypt(p_old_password, v_password_hash) then
    raise exception 'Invalid password';
  end if;

  v_new_password_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf'));

  update public.erp_employee_auth_users
     set password_hash = v_new_password_hash,
         must_reset_password = false,
         updated_at = now()
   where company_id = v_company_id
     and employee_id = v_employee_id;

  insert into public.erp_employee_auth_events (
    company_id,
    employee_id,
    event_type
  ) values (
    v_company_id,
    v_employee_id,
    'change_password'
  );
end;
$$;

revoke all on function public.erp_employee_auth_change_password(text, text, text) from public;
grant execute on function public.erp_employee_auth_change_password(text, text, text) to service_role;

drop function if exists public.erp_employee_auth_logout(text);

create function public.erp_employee_auth_logout(
  p_session_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_token_hash text;
  v_company_id uuid;
  v_employee_id uuid;
begin
  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  select s.company_id,
         s.employee_id
    into v_company_id,
         v_employee_id
  from public.erp_employee_auth_sessions s
  where s.session_token_hash = v_session_token_hash
  order by s.created_at desc
  limit 1;

  if v_company_id is null or v_employee_id is null then
    return;
  end if;

  update public.erp_employee_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
   where company_id = v_company_id
     and session_token_hash = v_session_token_hash;

  insert into public.erp_employee_auth_events (
    company_id,
    employee_id,
    event_type
  ) values (
    v_company_id,
    v_employee_id,
    'logout'
  );
end;
$$;

revoke all on function public.erp_employee_auth_logout(text) from public;
grant execute on function public.erp_employee_auth_logout(text) to service_role;

drop function if exists public.erp_employee_auth_session_get(text);

create function public.erp_employee_auth_session_get(
  p_session_token text
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  display_name text,
  must_reset_password boolean,
  role_keys text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_token_hash text;
  v_company_id uuid;
  v_employee_id uuid;
  v_employee_code text;
  v_display_name text;
  v_must_reset boolean;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_roles text[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  select s.company_id,
         s.employee_id,
         e.employee_code,
         coalesce(nullif(e.full_name, ''), e.employee_code),
         s.expires_at,
         s.revoked_at,
         au.must_reset_password
    into v_company_id,
         v_employee_id,
         v_employee_code,
         v_display_name,
         v_expires_at,
         v_revoked_at,
         v_must_reset
  from public.erp_employee_auth_sessions s
  join public.erp_employee_auth_users au
    on au.employee_id = s.employee_id
   and au.company_id = s.company_id
   and au.is_active
  join public.erp_employees e
    on e.id = s.employee_id
   and e.company_id = s.company_id
  where s.session_token_hash = v_session_token_hash
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
   where session_token_hash = v_session_token_hash
     and revoked_at is null;

  select array_agg(er.role_key)
    into v_roles
  from public.erp_employee_roles er
  where er.company_id = v_company_id
    and er.employee_id = v_employee_id;

  if v_roles is null or array_length(v_roles, 1) = 0 then
    v_roles := array['employee'];
  end if;

  company_id := v_company_id;
  employee_id := v_employee_id;
  employee_code := v_employee_code;
  display_name := v_display_name;
  must_reset_password := coalesce(v_must_reset, false);
  role_keys := v_roles;
  return next;
end;
$$;

revoke all on function public.erp_employee_auth_session_get(text) from public;
grant execute on function public.erp_employee_auth_session_get(text) to service_role;
