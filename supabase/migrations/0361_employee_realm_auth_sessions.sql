-- Employee realm auth, sessions, and RBAC overlay

create table if not exists public.erp_employee_auth_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  password_hash text not null,
  is_active boolean not null default true,
  must_reset_password boolean not null default true,
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint erp_employee_auth_users_company_employee_key unique (company_id, employee_id)
);

create index if not exists erp_employee_auth_users_company_id_idx
  on public.erp_employee_auth_users (company_id);

create table if not exists public.erp_employee_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  user_id uuid not null references public.erp_employee_auth_users (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  ip text null,
  user_agent text null
);

create index if not exists erp_employee_auth_sessions_company_token_idx
  on public.erp_employee_auth_sessions (company_id, token_hash);

create index if not exists erp_employee_auth_sessions_company_user_idx
  on public.erp_employee_auth_sessions (company_id, user_id);

create table if not exists public.erp_permissions (
  code text primary key,
  name text not null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_role_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  role_key text not null references public.erp_roles (key),
  permission_code text not null references public.erp_permissions (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint erp_role_permissions_company_role_perm_key unique (company_id, role_key, permission_code)
);

create index if not exists erp_role_permissions_company_id_idx
  on public.erp_role_permissions (company_id);

create table if not exists public.erp_employee_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  role_key text not null references public.erp_roles (key),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint erp_employee_roles_company_employee_role_key unique (company_id, employee_id, role_key)
);

create index if not exists erp_employee_roles_company_id_idx
  on public.erp_employee_roles (company_id);

create index if not exists erp_employee_roles_employee_id_idx
  on public.erp_employee_roles (employee_id);

alter table public.erp_employee_auth_users enable row level security;
alter table public.erp_employee_auth_users force row level security;
alter table public.erp_employee_auth_sessions enable row level security;
alter table public.erp_employee_auth_sessions force row level security;
alter table public.erp_permissions enable row level security;
alter table public.erp_permissions force row level security;
alter table public.erp_role_permissions enable row level security;
alter table public.erp_role_permissions force row level security;
alter table public.erp_employee_roles enable row level security;
alter table public.erp_employee_roles force row level security;

do $$
begin
  drop policy if exists erp_employee_auth_users_service_role on public.erp_employee_auth_users;
  create policy erp_employee_auth_users_service_role
    on public.erp_employee_auth_users
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

  drop policy if exists erp_employee_auth_sessions_service_role on public.erp_employee_auth_sessions;
  create policy erp_employee_auth_sessions_service_role
    on public.erp_employee_auth_sessions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

  drop policy if exists erp_permissions_read_authenticated on public.erp_permissions;
  create policy erp_permissions_read_authenticated
    on public.erp_permissions
    for select
    using (auth.role() = 'service_role' or auth.uid() is not null);

  drop policy if exists erp_permissions_write_admin on public.erp_permissions;
  create policy erp_permissions_write_admin
    on public.erp_permissions
    for all
    using (public.erp_is_owner_or_admin())
    with check (public.erp_is_owner_or_admin());

  drop policy if exists erp_role_permissions_service_role on public.erp_role_permissions;
  create policy erp_role_permissions_service_role
    on public.erp_role_permissions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

  drop policy if exists erp_employee_roles_service_role on public.erp_employee_roles;
  create policy erp_employee_roles_service_role
    on public.erp_employee_roles
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
end
$$;

create or replace function public.erp_employee_has_permission(
  p_company_id uuid,
  p_employee_id uuid,
  p_permission_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles text[];
  v_has_permission boolean := false;
begin
  if p_company_id is null or p_employee_id is null or p_permission_code is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = p_company_id
  ) then
    return false;
  end if;

  select array_agg(er.role_key)
    into v_roles
  from public.erp_employee_roles er
  where er.company_id = p_company_id
    and er.employee_id = p_employee_id;

  if v_roles is null or array_length(v_roles, 1) = 0 then
    v_roles := array['employee'];
  end if;

  select exists (
    select 1
    from public.erp_role_permissions rp
    where rp.company_id = p_company_id
      and rp.permission_code = p_permission_code
      and rp.role_key = any (v_roles)
  ) into v_has_permission;

  return coalesce(v_has_permission, false);
end;
$$;

revoke all on function public.erp_employee_has_permission(uuid, uuid, text) from public;
grant execute on function public.erp_employee_has_permission(uuid, uuid, text) to authenticated;

create or replace function public.erp_employee_require_permission(
  p_company_id uuid,
  p_employee_id uuid,
  p_permission_code text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.erp_employee_has_permission(p_company_id, p_employee_id, p_permission_code) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_employee_require_permission(uuid, uuid, text) from public;
grant execute on function public.erp_employee_require_permission(uuid, uuid, text) to authenticated;

create or replace function public.erp_employee_auth_user_get(
  p_employee_code text
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  password_hash text,
  is_active boolean,
  must_reset_password boolean,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_employee_code is null or trim(p_employee_code) = '' then
    raise exception 'employee_code is required';
  end if;

  return query
  select
    e.company_id,
    e.id as employee_id,
    e.employee_code,
    au.password_hash,
    au.is_active,
    au.must_reset_password,
    coalesce(nullif(e.full_name, ''), nullif(e.name, ''), e.employee_code) as display_name
  from public.erp_employees e
  join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.employee_code = p_employee_code;
end;
$$;

revoke all on function public.erp_employee_auth_user_get(text) from public;
grant execute on function public.erp_employee_auth_user_get(text) to service_role;

create or replace function public.erp_employee_auth_user_upsert(
  p_company_id uuid,
  p_employee_id uuid,
  p_password_hash text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_is_authorized boolean := false;
begin
  if p_company_id is null or p_employee_id is null or p_actor_user_id is null then
    raise exception 'company_id, employee_id, and actor_user_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = p_actor_user_id
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = p_company_id
  ) then
    raise exception 'Invalid employee_id';
  end if;

  select au.id
    into v_existing_id
  from public.erp_employee_auth_users au
  where au.company_id = p_company_id
    and au.employee_id = p_employee_id;

  if v_existing_id is null then
    if p_password_hash is null or trim(p_password_hash) = '' then
      raise exception 'password_hash is required to create login';
    end if;

    insert into public.erp_employee_auth_users (
      company_id,
      employee_id,
      password_hash,
      must_reset_password,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_employee_id,
      p_password_hash,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_existing_id;
  else
    if p_password_hash is not null and trim(p_password_hash) <> '' then
      update public.erp_employee_auth_users
         set password_hash = p_password_hash,
             must_reset_password = true,
             updated_at = now(),
             updated_by = p_actor_user_id
       where id = v_existing_id;
    end if;
  end if;

  return v_existing_id;
end;
$$;

revoke all on function public.erp_employee_auth_user_upsert(uuid, uuid, text, uuid) from public;
grant execute on function public.erp_employee_auth_user_upsert(uuid, uuid, text, uuid) to authenticated;

create or replace function public.erp_employee_session_create(
  p_company_id uuid,
  p_employee_code text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_ip text default null,
  p_user_agent text default null
) returns table (
  employee_id uuid,
  user_id uuid,
  session_id uuid,
  must_reset_password boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_user_id uuid;
  v_session_id uuid;
  v_must_reset boolean;
begin
  if p_company_id is null or p_employee_code is null or trim(p_employee_code) = '' then
    raise exception 'company_id and employee_code are required';
  end if;

  if p_token_hash is null or trim(p_token_hash) = '' then
    raise exception 'token_hash is required';
  end if;

  if p_expires_at is null then
    raise exception 'expires_at is required';
  end if;

  select e.id
    into v_employee_id
  from public.erp_employees e
  where e.company_id = p_company_id
    and e.employee_code = p_employee_code;

  if v_employee_id is null then
    raise exception 'Employee not found';
  end if;

  select au.id, au.must_reset_password
    into v_user_id, v_must_reset
  from public.erp_employee_auth_users au
  where au.company_id = p_company_id
    and au.employee_id = v_employee_id
    and au.is_active;

  if v_user_id is null then
    raise exception 'Employee login not enabled';
  end if;

  insert into public.erp_employee_auth_sessions (
    company_id,
    user_id,
    token_hash,
    expires_at,
    ip,
    user_agent
  ) values (
    p_company_id,
    v_user_id,
    p_token_hash,
    p_expires_at,
    nullif(trim(coalesce(p_ip, '')), ''),
    nullif(trim(coalesce(p_user_agent, '')), '')
  ) returning id into v_session_id;

  update public.erp_employee_auth_users
     set last_login_at = now(),
         updated_at = now()
   where id = v_user_id;

  employee_id := v_employee_id;
  user_id := v_user_id;
  session_id := v_session_id;
  must_reset_password := coalesce(v_must_reset, true);
  return next;
end;
$$;

revoke all on function public.erp_employee_session_create(uuid, text, text, timestamptz, text, text) from public;
grant execute on function public.erp_employee_session_create(uuid, text, text, timestamptz, text, text) to service_role;

create or replace function public.erp_employee_session_revoke(
  p_company_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_employee_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
   where id = p_session_id
     and company_id = p_company_id;
end;
$$;

revoke all on function public.erp_employee_session_revoke(uuid, uuid) from public;
grant execute on function public.erp_employee_session_revoke(uuid, uuid) to service_role;

create or replace function public.erp_employee_session_get(
  p_company_id uuid,
  p_token_hash text
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

  if p_token_hash is null or trim(p_token_hash) = '' then
    raise exception 'token_hash is required';
  end if;

  select e.id,
         e.employee_code,
         coalesce(nullif(e.full_name, ''), nullif(e.name, ''), e.employee_code),
         s.expires_at,
         s.revoked_at
    into v_employee_id, v_employee_code, v_display_name, v_expires_at, v_revoked_at
  from public.erp_employee_auth_sessions s
  join public.erp_employee_auth_users au
    on au.id = s.user_id
   and au.company_id = s.company_id
   and au.is_active
  join public.erp_employees e
    on e.id = au.employee_id
   and e.company_id = s.company_id
  where s.company_id = p_company_id
    and s.token_hash = p_token_hash
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

create or replace function public.erp_employee_leave_request_draft_upsert(
  p_company_id uuid,
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_date_from date,
  p_date_to date,
  p_id uuid default null,
  p_reason text default null,
  p_start_session text default 'full',
  p_end_session text default 'full'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_company_id uuid := p_company_id;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  perform public.erp_employee_require_permission(v_company_id, p_employee_id, 'leave.apply');

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Invalid employee_id';
  end if;

  if not exists (
    select 1
    from public.erp_hr_leave_types lt
    where lt.id = p_leave_type_id
      and lt.company_id = v_company_id
      and lt.is_active
  ) then
    raise exception 'Invalid leave_type_id';
  end if;

  if p_date_from is null or p_date_to is null then
    raise exception 'date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Invalid date range';
  end if;

  if p_id is null then
    insert into public.erp_hr_leave_requests (
      company_id,
      employee_id,
      leave_type_id,
      date_from,
      date_to,
      reason,
      status,
      start_session,
      end_session,
      updated_by
    ) values (
      v_company_id,
      p_employee_id,
      p_leave_type_id,
      p_date_from,
      p_date_to,
      p_reason,
      'draft',
      p_start_session,
      p_end_session,
      p_employee_id
    ) returning id into v_id;
  else
    update public.erp_hr_leave_requests
       set leave_type_id = p_leave_type_id,
           date_from = p_date_from,
           date_to = p_date_to,
           reason = p_reason,
           status = 'draft',
           start_session = p_start_session,
           end_session = p_end_session,
           updated_by = p_employee_id
     where id = p_id
       and company_id = v_company_id
       and employee_id = p_employee_id
       and status = 'draft'
    returning id into v_id;

    if v_id is null then
      raise exception 'Leave request not found or not editable';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_employee_leave_request_draft_upsert(uuid, uuid, uuid, date, date, uuid, text, text, text) from public;
grant execute on function public.erp_employee_leave_request_draft_upsert(uuid, uuid, uuid, date, date, uuid, text, text, text) to service_role;

create or replace function public.erp_employee_leave_request_submit(
  p_company_id uuid,
  p_employee_id uuid,
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  if p_company_id is null or p_employee_id is null or p_request_id is null then
    raise exception 'company_id, employee_id, and request_id are required';
  end if;

  perform public.erp_employee_require_permission(p_company_id, p_employee_id, 'leave.apply');

  select *
    into v_request
  from public.erp_hr_leave_requests lr
  where lr.id = p_request_id
    and lr.company_id = p_company_id
    and lr.employee_id = p_employee_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  if v_request.status <> 'draft' then
    raise exception 'Only draft requests can be submitted';
  end if;

  update public.erp_hr_leave_requests
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now(),
         updated_by = p_employee_id
   where id = p_request_id
     and company_id = p_company_id
     and employee_id = p_employee_id
     and status = 'draft';
end;
$$;

revoke all on function public.erp_employee_leave_request_submit(uuid, uuid, uuid) from public;
grant execute on function public.erp_employee_leave_request_submit(uuid, uuid, uuid) to service_role;

create or replace function public.erp_employee_leave_request_cancel(
  p_company_id uuid,
  p_employee_id uuid,
  p_request_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  if p_company_id is null or p_employee_id is null or p_request_id is null then
    raise exception 'company_id, employee_id, and request_id are required';
  end if;

  perform public.erp_employee_require_permission(p_company_id, p_employee_id, 'leave.apply');

  select *
    into v_request
  from public.erp_hr_leave_requests lr
  where lr.id = p_request_id
    and lr.company_id = p_company_id
    and lr.employee_id = p_employee_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  if v_request.status not in ('draft', 'submitted', 'approved') then
    raise exception 'Only draft, submitted, or approved requests can be cancelled';
  end if;

  update public.erp_hr_leave_requests
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_note = p_note,
         updated_at = now(),
         updated_by = p_employee_id
   where id = p_request_id
     and company_id = p_company_id
     and employee_id = p_employee_id;

  delete from public.erp_hr_leave_request_days
   where company_id = p_company_id
     and leave_request_id = p_request_id;
end;
$$;

revoke all on function public.erp_employee_leave_request_cancel(uuid, uuid, uuid, text) from public;
grant execute on function public.erp_employee_leave_request_cancel(uuid, uuid, uuid, text) to service_role;

create or replace function public.erp_employee_exit_request_submit(
  p_company_id uuid,
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid default null,
  p_last_working_day date default null,
  p_notice_period_days int default null,
  p_notice_waived boolean default false,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exit_id uuid;
  v_manager_employee_id uuid;
  v_last_working_day date;
begin
  if p_company_id is null or p_employee_id is null or p_exit_type_id is null then
    raise exception 'company_id, employee_id, and exit_type_id are required';
  end if;

  perform public.erp_employee_require_permission(p_company_id, p_employee_id, 'exit.submit');

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = p_company_id
  ) then
    raise exception 'Invalid employee_id';
  end if;

  if not exists (
    select 1
    from public.erp_hr_employee_exit_types t
    where t.id = p_exit_type_id
      and t.company_id = p_company_id
      and t.is_active
  ) then
    raise exception 'Invalid exit_type_id';
  end if;

  if p_exit_reason_id is not null then
    if not exists (
      select 1
      from public.erp_hr_employee_exit_reasons r
      where r.id = p_exit_reason_id
        and r.company_id = p_company_id
        and r.is_active
    ) then
      raise exception 'Invalid exit_reason_id';
    end if;
  end if;

  if exists (
    select 1
    from public.erp_hr_employee_exits e
    where e.company_id = p_company_id
      and e.employee_id = p_employee_id
      and e.status in ('draft', 'submitted', 'approved')
  ) then
    raise exception 'An active exit already exists for this employee';
  end if;

  select j.manager_employee_id
    into v_manager_employee_id
  from public.erp_employee_jobs j
  where j.company_id = p_company_id
    and j.employee_id = p_employee_id
  order by j.effective_from desc, j.created_at desc
  limit 1;

  v_last_working_day := coalesce(p_last_working_day, current_date);

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_period_days,
    notice_waived,
    manager_employee_id,
    notes
  ) values (
    p_company_id,
    p_employee_id,
    p_exit_type_id,
    p_exit_reason_id,
    p_employee_id,
    'submitted',
    current_date,
    v_last_working_day,
    p_notice_period_days,
    coalesce(p_notice_waived, false),
    v_manager_employee_id,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_exit_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_employee_exit_request_submit(uuid, uuid, uuid, uuid, date, int, boolean, text) from public;
grant execute on function public.erp_employee_exit_request_submit(uuid, uuid, uuid, uuid, date, int, boolean, text) to service_role;

create or replace function public.erp_leave_request_submit(
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_request record;
  v_is_hr_admin boolean;
  v_is_employee boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_request
    from public.erp_hr_leave_requests lr
   where lr.id = p_request_id
     and lr.company_id = v_company_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  if v_request.status <> 'draft' then
    raise exception 'Only draft requests can be submitted';
  end if;

  v_is_hr_admin := public.erp_is_hr_admin(v_actor);

  if not v_is_hr_admin then
    v_is_employee := exists (
      select 1
      from public.erp_employees e
      where e.company_id = v_company_id
        and e.id = v_request.employee_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_employee_users eu
      where eu.company_id = v_company_id
        and eu.employee_id = v_request.employee_id
        and eu.user_id = v_actor
        and coalesce(eu.is_active, true)
    );

    if not v_is_employee then
      raise exception 'Not authorized to submit this request';
    end if;

    perform public.erp_employee_require_permission(v_company_id, v_request.employee_id, 'leave.apply');
  end if;

  update public.erp_hr_leave_requests
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now(),
         updated_by = v_actor
   where id = p_request_id
     and company_id = v_company_id
     and status = 'draft';
end;
$$;

revoke all on function public.erp_leave_request_submit(uuid) from public;
grant execute on function public.erp_leave_request_submit(uuid) to authenticated;

insert into public.erp_permissions (code, name, description)
values
  ('leave.apply', 'Leave Apply', 'Submit leave requests as an employee'),
  ('exit.submit', 'Exit Submit', 'Submit exit/resignation requests')
on conflict (code) do nothing;

insert into public.erp_role_permissions (company_id, role_key, permission_code, created_at, updated_at)
select c.id,
       'employee',
       p.code,
       now(),
       now()
from public.erp_companies c
cross join (values ('leave.apply'), ('exit.submit')) as p(code)
on conflict (company_id, role_key, permission_code) do nothing;
