-- Designation master and employee designation linkage
create extension if not exists "pgcrypto";

create table if not exists public.erp_designations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  department text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_designations_code_key unique (code)
);

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
  ('assistant', 'Assistant', 'Operations', true),
  ('accountant', 'Accountant', 'Finance', true),
  ('store_manager', 'Store Manager', 'Operations', true)
on conflict (code) do update
  set name = excluded.name,
      department = excluded.department,
      is_active = excluded.is_active,
      updated_at = now();

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

-- RPC: list active designations for managers
create or replace function public.erp_list_designations()
returns table (
  id uuid,
  code text,
  name text,
  department text,
  is_active boolean
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
    d.id,
    d.code,
    d.name,
    d.department,
    d.is_active
  from public.erp_designations d
  where coalesce(d.is_active, true)
  order by d.name;
end;
$$;

revoke all on function public.erp_list_designations() from public;
grant execute on function public.erp_list_designations() to authenticated;

-- RPC: list employees for the single company
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
