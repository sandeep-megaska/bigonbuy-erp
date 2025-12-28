-- Company user invitation flow and management RPCs

-- Ensure membership has a stored email for auditability
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_company_users'
      and column_name = 'email'
  ) then
    alter table public.erp_company_users
      add column email text;
  end if;
end
$$;

-- Ensure active flags exist and default to true on membership tables
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_users'
      and column_name = 'is_active'
  ) then
    alter table public.erp_employee_users
      add column is_active boolean default true;
  end if;

  alter table public.erp_employee_users alter column is_active set default true;
  update public.erp_employee_users set is_active = true where is_active is null;
  alter table public.erp_employee_users alter column is_active set not null;
end
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_company_users'
      and column_name = 'is_active'
  ) then
    alter table public.erp_company_users
      add column is_active boolean default true;
  end if;

  alter table public.erp_company_users alter column is_active set default true;
  update public.erp_company_users set is_active = true where is_active is null;
  alter table public.erp_company_users alter column is_active set not null;
end
$$;

-- Ensure unique membership per company/user pair
create unique index if not exists ux_erp_company_users_company_user
  on public.erp_company_users (company_id, user_id);

-- Invitation audit log (RPC-only access)
create table if not exists public.erp_company_user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role_key text not null references public.erp_roles (key),
  invited_by uuid not null references auth.users (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.erp_company_user_invites enable row level security;
alter table public.erp_company_user_invites force row level security;

create unique index if not exists ux_erp_company_user_invites_company_user
  on public.erp_company_user_invites (company_id, user_id);

-- Seed canonical roles defensively
insert into public.erp_roles (key, name) values
  ('owner', 'Owner'),
  ('admin', 'Administrator'),
  ('hr', 'HR Manager'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- Canonical company resolver (reuse seeded ID if helper table is empty)
create or replace function public.erp_current_company_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select id from public.erp_company limit 1),
    (select id from public.erp_companies limit 1),
    'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid
  );
$$;

revoke all on function public.erp_current_company_id() from public;
grant execute on function public.erp_current_company_id() to authenticated;

-- Helper: check if provided uid is a manager (owner/admin/hr) with an active membership
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  );
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- Designation master to support employee profiles
create extension if not exists "pgcrypto";

create table if not exists public.erp_designations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  department text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.erp_designations
  add column if not exists department text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_designations_code_key'
      and conrelid = 'public.erp_designations'::regclass
  ) then
    alter table public.erp_designations
      add constraint erp_designations_code_key unique (code);
  end if;
end
$$;

alter table public.erp_designations enable row level security;
alter table public.erp_designations force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'erp_designations' and p.policyname = 'erp_designations_select_manager'
  ) then
    create policy erp_designations_select_manager
      on public.erp_designations
      for select
      using (
        auth.role() = 'service_role'
        or public.is_erp_manager(auth.uid())
      );
  end if;
end
$$;

insert into public.erp_designations (code, name, department, is_active)
values
  ('ASSISTANT', 'Assistant', null, true),
  ('ACCOUNTANT', 'Accountant', null, true),
  ('STORE_MANAGER', 'Store Manager', null, true),
  ('HR_EXECUTIVE', 'HR Executive', null, true)
on conflict (code) do nothing;

-- Ensure employee profile columns exist (idempotent)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'company_id'
  ) then
    alter table public.erp_employees add column company_id uuid references public.erp_companies (id) on delete cascade;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'employee_no'
  ) then
    alter table public.erp_employees add column employee_no text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'full_name'
  ) then
    alter table public.erp_employees add column full_name text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'work_email'
  ) then
    alter table public.erp_employees add column work_email text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'personal_email'
  ) then
    alter table public.erp_employees add column personal_email text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'phone'
  ) then
    alter table public.erp_employees add column phone text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'joining_date'
  ) then
    alter table public.erp_employees add column joining_date date;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'status'
  ) then
    alter table public.erp_employees add column status text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'department'
  ) then
    alter table public.erp_employees add column department text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'designation'
  ) then
    alter table public.erp_employees add column designation text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'designation_id'
  ) then
    alter table public.erp_employees
      add column designation_id uuid references public.erp_designations (id);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'created_at'
  ) then
    alter table public.erp_employees add column created_at timestamptz not null default now();
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_employees' and column_name = 'updated_at'
  ) then
    alter table public.erp_employees add column updated_at timestamptz not null default now();
  end if;
end
$$;

alter table public.erp_employees alter column created_at set default now();
alter table public.erp_employees alter column updated_at set default now();

-- RPC: list employees for the single company (manager only)
create or replace function public.erp_list_employees()
returns table (
  id uuid,
  company_id uuid,
  employee_no text,
  full_name text,
  work_email text,
  personal_email text,
  phone text,
  joining_date date,
  status text,
  department text,
  designation text,
  designation_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  return query
  select
    e.id,
    coalesce(e.company_id, public.erp_current_company_id()) as company_id,
    e.employee_no,
    e.full_name,
    e.work_email,
    e.personal_email,
    e.phone,
    e.joining_date,
    e.status,
    e.department,
    e.designation,
    e.designation_id,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  where coalesce(e.company_id, public.erp_current_company_id()) = public.erp_current_company_id()
  order by e.joining_date desc nulls last, e.created_at desc;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;

-- RPC: create or update employee profile with designation linkage
create or replace function public.erp_upsert_employee(
  p_employee_id uuid default null,
  p_employee_no text default null,
  p_full_name text,
  p_work_email text default null,
  p_personal_email text default null,
  p_phone text default null,
  p_joining_date date default null,
  p_status text default 'active',
  p_department text default null,
  p_designation text default null,
  p_designation_id uuid default null
) returns public.erp_employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee public.erp_employees;
  v_designation_name text := nullif(trim(coalesce(p_designation, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  if p_designation_id is not null then
    perform 1
    from public.erp_designations d
    where d.id = p_designation_id
      and coalesce(d.is_active, true);

    if not found then
      raise exception 'Invalid designation id';
    end if;
  end if;

  if v_designation_name is null and p_designation_id is not null then
    select name
      into v_designation_name
      from public.erp_designations
     where id = p_designation_id;
  end if;

  if p_employee_id is null then
    insert into public.erp_employees (
      company_id,
      employee_no,
      full_name,
      work_email,
      personal_email,
      phone,
      joining_date,
      status,
      department,
      designation,
      designation_id,
      created_at,
      updated_at
    )
    values (
      v_company_id,
      nullif(trim(coalesce(p_employee_no, '')), ''),
      trim(p_full_name),
      nullif(trim(coalesce(p_work_email, '')), ''),
      nullif(trim(coalesce(p_personal_email, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      p_joining_date,
      coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'),
      nullif(trim(coalesce(p_department, '')), ''),
      v_designation_name,
      p_designation_id,
      now(),
      now()
    )
    returning * into v_employee;
  else
    update public.erp_employees
       set employee_no = nullif(trim(coalesce(p_employee_no, '')), ''),
           full_name = trim(p_full_name),
           work_email = nullif(trim(coalesce(p_work_email, '')), ''),
           personal_email = nullif(trim(coalesce(p_personal_email, '')), ''),
           phone = nullif(trim(coalesce(p_phone, '')), ''),
           joining_date = p_joining_date,
           status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'),
           department = nullif(trim(coalesce(p_department, '')), ''),
           designation = v_designation_name,
           designation_id = p_designation_id,
           company_id = v_company_id,
           updated_at = now()
     where id = p_employee_id
       and coalesce(company_id, v_company_id) = v_company_id
    returning * into v_employee;
  end if;

  if v_employee is null then
    raise exception 'Employee not found or not updated';
  end if;

  return v_employee;
end;
$$;

revoke all on function public.erp_upsert_employee(
  uuid, text, text, text, text, text, date, text, text, text, uuid
) from public;
grant execute on function public.erp_upsert_employee(
  uuid, text, text, text, text, text, date, text, text, text, uuid
) to authenticated;

-- RPC: invite or update a company user membership
create or replace function public.erp_invite_company_user(
  p_user_id uuid,
  p_email text,
  p_role_key text,
  p_full_name text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_normalized_email text;
  v_existing_owner uuid;
  v_invite_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_user_id is null then
    raise exception 'Target user id is required';
  end if;

  v_normalized_email := lower(trim(coalesce(p_email, '')));
  if v_normalized_email = '' then
    raise exception 'Email is required';
  end if;

  if p_role_key not in ('owner', 'admin', 'hr', 'employee') then
    raise exception 'Invalid role: %', p_role_key;
  end if;

  if not exists (select 1 from public.erp_roles where key = p_role_key) then
    raise exception 'Role not found in erp_roles: %', p_role_key;
  end if;

  if p_role_key = 'owner' then
    select user_id
      into v_existing_owner
      from public.erp_company_users
     where company_id = v_company_id
       and role_key = 'owner'
     limit 1;

    if v_existing_owner is not null and v_existing_owner <> p_user_id then
      raise exception 'Owner already exists; cannot assign a second owner';
    end if;
  end if;

  insert into public.erp_company_users (company_id, user_id, role_key, email, updated_at)
  values (v_company_id, p_user_id, p_role_key, v_normalized_email, now())
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        email = coalesce(excluded.email, public.erp_company_users.email),
        is_active = true,
        updated_at = now();

  insert into public.erp_company_user_invites (company_id, user_id, email, role_key, invited_by, invited_at)
  values (v_company_id, p_user_id, v_normalized_email, p_role_key, auth.uid(), now())
  on conflict (company_id, user_id) do update
    set email = excluded.email,
        role_key = excluded.role_key,
        invited_by = excluded.invited_by,
        invited_at = excluded.invited_at
  returning id into v_invite_id;

  return json_build_object(
    'company_id', v_company_id,
    'user_id', p_user_id,
    'email', v_normalized_email,
    'role_key', p_role_key,
    'invite_id', v_invite_id,
    'invited_by', auth.uid(),
    'full_name', p_full_name
  );
end;
$$;

revoke all on function public.erp_invite_company_user(uuid, text, text, text) from public;
grant execute on function public.erp_invite_company_user(uuid, text, text, text) to authenticated;

-- RPC: list company users for the single company
create or replace function public.erp_list_company_users()
returns table (
  user_id uuid,
  email text,
  role_key text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  return query
  select
    cu.user_id,
    coalesce(cu.email, u.email),
    cu.role_key,
    cu.created_at,
    cu.updated_at
  from public.erp_company_users cu
  left join auth.users u on u.id = cu.user_id
  where cu.company_id = public.erp_current_company_id()
  order by cu.created_at desc;
end;
$$;

revoke all on function public.erp_list_company_users() from public;
grant execute on function public.erp_list_company_users() to authenticated;
