-- Vendor portal MVP: vendor codes, portal access, and isolated vendor auth realm

alter table public.erp_vendors
  add column if not exists vendor_code text,
  add column if not exists portal_enabled boolean not null default false,
  add column if not exists portal_status text not null default 'disabled',
  add column if not exists portal_auth_user_id uuid,
  add column if not exists portal_last_login_at timestamptz,
  add column if not exists portal_temp_password_set_at timestamptz;

create unique index if not exists erp_vendors_vendor_code_uniq
  on public.erp_vendors (vendor_code)
  where vendor_code is not null;

create unique index if not exists erp_vendors_portal_auth_user_id_uniq
  on public.erp_vendors (portal_auth_user_id)
  where portal_auth_user_id is not null;

alter table public.erp_company_counters
  add column if not exists vendor_code_seq bigint not null default 0;

create or replace function public.erp_next_vendor_code(p_company_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(p_company_id, public.erp_current_company_id());
  v_seq bigint;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  insert into public.erp_company_counters (company_id, vendor_code_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set vendor_code_seq = public.erp_company_counters.vendor_code_seq + 1,
                updated_at = now()
  returning vendor_code_seq into v_seq;

  return 'VD' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_next_vendor_code(uuid) from public;
grant execute on function public.erp_next_vendor_code(uuid) to authenticated;
grant execute on function public.erp_next_vendor_code(uuid) to service_role;

create table if not exists public.erp_vendor_auth_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors (id) on delete cascade,
  password_hash text not null,
  is_active boolean not null default true,
  must_reset_password boolean not null default true,
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint erp_vendor_auth_users_company_vendor_key unique (company_id, vendor_id)
);

create index if not exists erp_vendor_auth_users_company_id_idx
  on public.erp_vendor_auth_users (company_id);

create table if not exists public.erp_vendor_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors (id) on delete cascade,
  session_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  ip inet null,
  user_agent text null,
  constraint erp_vendor_auth_sessions_token_hash_key unique (session_token_hash)
);

create index if not exists erp_vendor_auth_sessions_company_vendor_revoked_idx
  on public.erp_vendor_auth_sessions (company_id, vendor_id, revoked_at);

create index if not exists erp_vendor_auth_sessions_expires_at_idx
  on public.erp_vendor_auth_sessions (expires_at);

alter table public.erp_vendor_auth_users enable row level security;
alter table public.erp_vendor_auth_users force row level security;
alter table public.erp_vendor_auth_sessions enable row level security;
alter table public.erp_vendor_auth_sessions force row level security;

do $$
begin
  drop policy if exists erp_vendor_auth_users_service_role on public.erp_vendor_auth_users;
  create policy erp_vendor_auth_users_service_role
    on public.erp_vendor_auth_users
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

  drop policy if exists erp_vendor_auth_sessions_service_role on public.erp_vendor_auth_sessions;
  create policy erp_vendor_auth_sessions_service_role
    on public.erp_vendor_auth_sessions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
end
$$;

create or replace function public.erp_vendor_portal_access_get(
  p_company_id uuid,
  p_vendor_id uuid
) returns table (
  vendor_id uuid,
  vendor_code text,
  portal_enabled boolean,
  portal_status text,
  must_reset_password boolean,
  last_login_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  return query
  select
    v.id,
    v.vendor_code,
    v.portal_enabled,
    v.portal_status,
    au.must_reset_password,
    v.portal_last_login_at
  from public.erp_vendors v
  left join public.erp_vendor_auth_users au
    on au.company_id = v.company_id
   and au.vendor_id = v.id
  where v.company_id = p_company_id
    and v.id = p_vendor_id;
end;
$$;

revoke all on function public.erp_vendor_portal_access_get(uuid, uuid) from public;
grant execute on function public.erp_vendor_portal_access_get(uuid, uuid) to authenticated;

create or replace function public.erp_vendor_portal_enable(
  p_vendor_id uuid,
  p_company_id uuid
) returns table (
  vendor_id uuid,
  vendor_code text,
  temp_password text,
  login_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
  v_vendor_code text;
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_temp_password text;
  v_password_hash text;
begin
  if p_vendor_id is null or p_company_id is null then
    raise exception 'vendor_id and company_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.erp_vendors v where v.id = p_vendor_id and v.company_id = p_company_id
  ) then
    raise exception 'Invalid vendor_id';
  end if;

  update public.erp_vendors
     set vendor_code = coalesce(vendor_code, public.erp_next_vendor_code(company_id)),
         portal_enabled = true,
         portal_status = 'invited',
         portal_temp_password_set_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_vendor_id
     and company_id = p_company_id
  returning public.erp_vendors.vendor_code into v_vendor_code;

  select string_agg(substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1), '')
    into v_temp_password
  from generate_series(1, 12);

  v_password_hash := extensions.crypt(v_temp_password, extensions.gen_salt('bf'));

  insert into public.erp_vendor_auth_users (
    company_id,
    vendor_id,
    password_hash,
    is_active,
    must_reset_password,
    created_at,
    updated_at,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_vendor_id,
    v_password_hash,
    true,
    true,
    now(),
    now(),
    auth.uid(),
    auth.uid()
  )
  on conflict (company_id, vendor_id)
  do update set
    password_hash = excluded.password_hash,
    is_active = true,
    must_reset_password = true,
    updated_at = now(),
    updated_by = auth.uid()
  returning id into vendor_id;

  update public.erp_vendors
     set portal_auth_user_id = (select au.id from public.erp_vendor_auth_users au where au.company_id = p_company_id and au.vendor_id = p_vendor_id)
   where id = p_vendor_id
     and company_id = p_company_id;

  vendor_id := p_vendor_id;
  vendor_code := v_vendor_code;
  temp_password := v_temp_password;
  login_url := '/mfg/login';
  return next;
end;
$$;

revoke all on function public.erp_vendor_portal_enable(uuid, uuid) from public;
grant execute on function public.erp_vendor_portal_enable(uuid, uuid) to authenticated;

create or replace function public.erp_vendor_portal_disable(
  p_vendor_id uuid,
  p_company_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
begin
  if p_vendor_id is null or p_company_id is null then
    raise exception 'vendor_id and company_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  update public.erp_vendors
     set portal_enabled = false,
         portal_status = 'disabled',
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_vendor_id
     and company_id = p_company_id;

  update public.erp_vendor_auth_users
     set is_active = false,
         updated_at = now(),
         updated_by = auth.uid()
   where company_id = p_company_id
     and vendor_id = p_vendor_id;

  update public.erp_vendor_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
   where company_id = p_company_id
     and vendor_id = p_vendor_id
     and revoked_at is null;
end;
$$;

revoke all on function public.erp_vendor_portal_disable(uuid, uuid, text) from public;
grant execute on function public.erp_vendor_portal_disable(uuid, uuid, text) to authenticated;

create or replace function public.erp_vendor_auth_login(
  p_vendor_code text,
  p_password text,
  p_user_agent text default null,
  p_ip inet default null
) returns table (
  company_id uuid,
  vendor_id uuid,
  vendor_code text,
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
  v_vendor_id uuid;
  v_vendor_code text;
  v_display_name text;
  v_password_hash text;
  v_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_vendor_code is null or trim(p_vendor_code) = '' then
    raise exception 'vendor_code is required';
  end if;

  select
    v.company_id,
    v.id,
    v.vendor_code,
    coalesce(nullif(v.legal_name, ''), v.vendor_code),
    au.password_hash
  into
    v_company_id,
    v_vendor_id,
    v_vendor_code,
    v_display_name,
    v_password_hash
  from public.erp_vendors v
  join public.erp_vendor_auth_users au
    on au.vendor_id = v.id
   and au.company_id = v.company_id
  where v.vendor_code = p_vendor_code
    and v.portal_enabled = true
    and v.portal_status <> 'disabled'
    and au.is_active = true;

  if v_vendor_id is null then
    raise exception 'Invalid vendor credentials';
  end if;

  if v_password_hash <> extensions.crypt(p_password, v_password_hash) then
    raise exception 'Invalid vendor credentials';
  end if;

  v_token := gen_random_uuid()::text;
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.erp_vendor_auth_sessions (
    company_id,
    vendor_id,
    session_token_hash,
    expires_at,
    user_agent,
    ip
  ) values (
    v_company_id,
    v_vendor_id,
    v_token_hash,
    v_expires_at,
    p_user_agent,
    p_ip
  );

  update public.erp_vendor_auth_users
     set last_login_at = now(),
         updated_at = now()
   where company_id = v_company_id
     and vendor_id = v_vendor_id;

  update public.erp_vendors
     set portal_last_login_at = now(),
         portal_status = 'active',
         updated_at = now()
   where company_id = v_company_id
     and id = v_vendor_id;

  return query
  select
    v_company_id,
    v_vendor_id,
    v_vendor_code,
    v_display_name,
    v_token,
    v_expires_at;
end;
$$;

revoke all on function public.erp_vendor_auth_login(text, text, text, inet) from public;
grant execute on function public.erp_vendor_auth_login(text, text, text, inet) to service_role;

create or replace function public.erp_vendor_auth_session_get(
  p_session_token text
) returns table (
  company_id uuid,
  vendor_id uuid,
  vendor_code text,
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  return query
  select
    s.company_id,
    s.vendor_id,
    v.vendor_code,
    coalesce(nullif(v.legal_name, ''), v.vendor_code) as display_name,
    au.must_reset_password,
    array['vendor']::text[] as role_keys
  from public.erp_vendor_auth_sessions s
  join public.erp_vendor_auth_users au
    on au.company_id = s.company_id
   and au.vendor_id = s.vendor_id
  join public.erp_vendors v
    on v.company_id = s.company_id
   and v.id = s.vendor_id
  where s.session_token_hash = v_session_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and au.is_active = true
    and v.portal_enabled = true
  order by s.created_at desc
  limit 1;
end;
$$;

revoke all on function public.erp_vendor_auth_session_get(text) from public;
grant execute on function public.erp_vendor_auth_session_get(text) to service_role;

create or replace function public.erp_vendor_auth_change_password(
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
  v_vendor_id uuid;
  v_password_hash text;
  v_new_password_hash text;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
begin
  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  if p_old_password is null or p_old_password = '' then
    raise exception 'old_password is required';
  end if;

  if p_new_password is null or length(trim(p_new_password)) < 8 then
    raise exception 'New password must be at least 8 characters';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  select s.company_id, s.vendor_id, s.expires_at, s.revoked_at
    into v_company_id, v_vendor_id, v_expires_at, v_revoked_at
  from public.erp_vendor_auth_sessions s
  where s.session_token_hash = v_session_token_hash
  order by s.created_at desc
  limit 1;

  if v_vendor_id is null then
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
  from public.erp_vendor_auth_users au
  where au.company_id = v_company_id
    and au.vendor_id = v_vendor_id;

  if v_password_hash is null then
    raise exception 'Vendor login not found';
  end if;

  if v_password_hash <> extensions.crypt(p_old_password, v_password_hash) then
    raise exception 'Invalid password';
  end if;

  v_new_password_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf'));

  update public.erp_vendor_auth_users
     set password_hash = v_new_password_hash,
         must_reset_password = false,
         updated_at = now()
   where company_id = v_company_id
     and vendor_id = v_vendor_id;

  update public.erp_vendors
     set portal_status = 'active',
         updated_at = now()
   where company_id = v_company_id
     and id = v_vendor_id;
end;
$$;

revoke all on function public.erp_vendor_auth_change_password(text, text, text) from public;
grant execute on function public.erp_vendor_auth_change_password(text, text, text) to service_role;

create or replace function public.erp_vendor_auth_logout(
  p_session_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_token_hash text;
begin
  if p_session_token is null or trim(p_session_token) = '' then
    raise exception 'session_token is required';
  end if;

  v_session_token_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');

  update public.erp_vendor_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
   where session_token_hash = v_session_token_hash;
end;
$$;

revoke all on function public.erp_vendor_auth_logout(text) from public;
grant execute on function public.erp_vendor_auth_logout(text) to service_role;
