-- Enterprise HR employee creation and access provisioning
create extension if not exists "pgcrypto";

-- Sequential employee code generator (BOB0001, BOB0002, ...)
create sequence if not exists public.erp_employee_seq;

create or replace function public.erp_next_employee_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'BOB' || lpad(nextval('public.erp_employee_seq')::text, 4, '0')
$$;

revoke all on function public.erp_next_employee_code() from public;
grant execute on function public.erp_next_employee_code() to authenticated;

-- Helper to evaluate HR / admin / owner memberships for the canonical company
create or replace function public.erp_is_hr_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  )
$$;

revoke all on function public.erp_is_hr_admin(uuid) from public;
grant execute on function public.erp_is_hr_admin(uuid) to authenticated;

-- Align employee profile table with canonical single-company model
do $$
declare
  v_owner uuid;
begin
  select user_id
    into v_owner
    from public.erp_company_users
   where company_id = public.erp_current_company_id()
     and role_key = 'owner'
   limit 1;

  if v_owner is null then
    v_owner := '9673523f-3485-4acc-97c4-6a4662e48743'::uuid;
  end if;

  -- required company guard
  alter table public.erp_employees
    add column if not exists company_id uuid default public.erp_current_company_id();

  update public.erp_employees
     set company_id = public.erp_current_company_id()
   where company_id is null;

  alter table public.erp_employees
    alter column company_id set not null,
    alter column company_id set default public.erp_current_company_id();

  -- unique human-friendly code
  alter table public.erp_employees
    add column if not exists employee_code text;

  update public.erp_employees
     set employee_code = public.erp_next_employee_code()
   where employee_code is null or employee_code = '';

  alter table public.erp_employees
    alter column employee_code set not null;

  do $$
  declare
    v_max_seq bigint;
  begin
    select coalesce(max(nullif(regexp_replace(employee_code, '\\D', '', 'g'), '')::bigint), 0)
      into v_max_seq
      from public.erp_employees;

    if v_max_seq is null then
      v_max_seq := 0;
    end if;

    perform setval('public.erp_employee_seq', v_max_seq, true);
  end;
  $$;

  -- employee identity linkage
  alter table public.erp_employees
    add column if not exists user_id uuid unique references auth.users (id) on delete set null;

  alter table public.erp_employees
    add column if not exists email text;

  -- core profile fields
  alter table public.erp_employees
    add column if not exists full_name text,
    add column if not exists phone text,
    add column if not exists dob date,
    add column if not exists gender text,
    add column if not exists designation text,
    add column if not exists department text,
    add column if not exists joining_date date,
    add column if not exists employment_status text default 'active',
    add column if not exists photo_path text,
    add column if not exists id_proof_type text,
    add column if not exists aadhaar_last4 text,
    add column if not exists id_proof_path text,
    add column if not exists address_json jsonb,
    add column if not exists salary_json jsonb,
    add column if not exists created_by uuid default auth.uid(),
    add column if not exists updated_by uuid default auth.uid();

  update public.erp_employees
     set full_name = coalesce(nullif(full_name, ''), nullif(name, ''), 'Employee'),
         employment_status = coalesce(nullif(employment_status, ''), 'active'),
         created_by = coalesce(created_by, v_owner),
         updated_by = coalesce(updated_by, v_owner)
   where full_name is null
      or employment_status is null
      or created_by is null
      or updated_by is null;

  alter table public.erp_employees
    alter column full_name set not null,
    alter column employment_status set not null,
    alter column created_at set default now(),
    alter column updated_at set default now(),
    alter column created_by set not null,
    alter column updated_by set not null;

  -- maintain updated_at/updated_by
  create or replace function public.erp_employees_set_updated()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end;
  $$;

  drop trigger if exists erp_employees_set_updated on public.erp_employees;
  create trigger erp_employees_set_updated
  before update on public.erp_employees
  for each row
  execute function public.erp_employees_set_updated();

  -- auto-assign employee codes when missing on insert
  create or replace function public.erp_employees_set_code()
  returns trigger
  language plpgsql
  as $$
  begin
    if new.employee_code is null or new.employee_code = '' then
      new.employee_code := public.erp_next_employee_code();
    end if;
    return new;
  end;
  $$;

  drop trigger if exists erp_employees_set_code on public.erp_employees;
  create trigger erp_employees_set_code
  before insert on public.erp_employees
  for each row
  execute function public.erp_employees_set_code();

  create unique index if not exists erp_employees_employee_code_key
    on public.erp_employees (employee_code);
end
$$;

-- RLS: owner/admin/hr manage; employees can read their own profile
alter table public.erp_employees enable row level security;
alter table public.erp_employees force row level security;

do $$
begin
  drop policy if exists erp_employees_select_manager on public.erp_employees;
  drop policy if exists erp_employees_select_self on public.erp_employees;
  drop policy if exists erp_employees_insert_manager on public.erp_employees;
  drop policy if exists erp_employees_update_manager on public.erp_employees;

  create policy erp_employees_select_manager
    on public.erp_employees
    for select
    using (
      auth.role() = 'service_role'
      or public.erp_is_hr_admin(auth.uid())
    );

  create policy erp_employees_select_self
    on public.erp_employees
    for select
    using (
      auth.uid() is not null
      and auth.uid() = user_id
      and company_id = public.erp_current_company_id()
    );

  create policy erp_employees_insert_manager
    on public.erp_employees
    for insert
    with check (public.erp_is_hr_admin(auth.uid()));

  create policy erp_employees_update_manager
    on public.erp_employees
    for update
    using (public.erp_is_hr_admin(auth.uid()))
    with check (public.erp_is_hr_admin(auth.uid()));
end
$$;

-- Storage: private bucket for employee artifacts
insert into storage.buckets (id, name, public)
values ('erp-employee-private', 'erp-employee-private', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'erp_employee_private_read'
  ) then
    create policy erp_employee_private_read
      on storage.objects
      for select
      using (
        bucket_id = 'erp-employee-private'
        and (
          auth.role() = 'service_role'
          or public.erp_is_hr_admin(auth.uid())
          or (auth.uid() is not null and owner = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'erp_employee_private_write'
  ) then
    create policy erp_employee_private_write
      on storage.objects
      for insert
      with check (
        bucket_id = 'erp-employee-private'
        and (
          auth.role() = 'service_role'
          or public.erp_is_hr_admin(auth.uid())
          or (auth.uid() is not null and owner = auth.uid())
        )
      );
  end if;
end
$$;

-- RPC: create an employee profile (pre-boarding allowed)
create or replace function public.erp_create_employee(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_designation text default null,
  p_department text default null,
  p_joining_date date default null,
  p_employment_status text default 'active',
  p_dob date default null,
  p_gender text default null,
  p_address_json jsonb default null,
  p_salary_json jsonb default null,
  p_photo_path text default null,
  p_id_proof_type text default null,
  p_aadhaar_last4 text default null,
  p_id_proof_path text default null
)
returns public.erp_employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_status text;
  v_aadhaar_last4 text;
  v_employee public.erp_employees;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Full name is required';
  end if;

  v_status := coalesce(nullif(trim(coalesce(p_employment_status, '')), ''), 'active');
  if v_status not in ('active', 'inactive', 'terminated') then
    raise exception 'Invalid employment_status. Allowed: active, inactive, terminated';
  end if;

  v_aadhaar_last4 := nullif(trim(coalesce(p_aadhaar_last4, '')), '');
  if v_aadhaar_last4 is not null then
    if length(v_aadhaar_last4) <> 4 or v_aadhaar_last4 !~ '^[0-9]{4}$' then
      raise exception 'aadhaar_last4 must be exactly 4 digits';
    end if;
  end if;

  insert into public.erp_employees (
    company_id,
    full_name,
    email,
    phone,
    designation,
    department,
    joining_date,
    employment_status,
    dob,
    gender,
    address_json,
    salary_json,
    photo_path,
    id_proof_type,
    aadhaar_last4,
    id_proof_path,
    created_by,
    updated_by
  )
  values (
    v_company_id,
    trim(p_full_name),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_designation, '')), ''),
    nullif(trim(coalesce(p_department, '')), ''),
    p_joining_date,
    v_status,
    p_dob,
    nullif(trim(coalesce(p_gender, '')), ''),
    p_address_json,
    p_salary_json,
    nullif(trim(coalesce(p_photo_path, '')), ''),
    nullif(trim(coalesce(p_id_proof_type, '')), ''),
    v_aadhaar_last4,
    nullif(trim(coalesce(p_id_proof_path, '')), ''),
    v_actor,
    v_actor
  )
  returning * into v_employee;

  return v_employee;
end;
$$;

revoke all on function public.erp_create_employee(text, text, text, text, text, date, text, date, text, jsonb, jsonb, text, text, text, text) from public;
grant execute on function public.erp_create_employee(text, text, text, text, text, date, text, date, text, jsonb, jsonb, text, text, text, text) to authenticated;

-- RPC: grant ERP/system access to an employee + set membership role
create or replace function public.erp_grant_employee_access(
  p_employee_id uuid,
  p_email text,
  p_role_key text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee public.erp_employees;
  v_normalized_email text;
  v_role_exists boolean;
  v_is_owner boolean := false;
  v_employee_user_id uuid;
  v_company_user_id uuid;
  v_constraint_name text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_employee_id is null or p_auth_user_id is null then
    raise exception 'employee_id and auth user id are required';
  end if;

  v_normalized_email := lower(trim(coalesce(p_email, '')));
  if v_normalized_email = '' then
    raise exception 'Email is required';
  end if;

  select exists (select 1 from public.erp_roles r where r.key = p_role_key)
    into v_role_exists;
  if not v_role_exists then
    raise exception 'Invalid role_key: %', coalesce(p_role_key, '<null>');
  end if;

  v_is_owner := exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and cu.role_key = 'owner'
      and coalesce(cu.is_active, true)
  );

  if p_role_key = 'owner' and not v_is_owner then
    raise exception 'Only an existing owner can assign the owner role';
  end if;

  select *
    into v_employee
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;

  if not found then
    raise exception 'Employee not found for this company';
  end if;

  if v_employee.user_id is not null and v_employee.user_id <> p_auth_user_id then
    raise exception 'Employee already linked to another auth user';
  end if;

  begin
    update public.erp_employees
       set user_id = p_auth_user_id,
           email = v_normalized_email,
           updated_at = now(),
           updated_by = v_actor
     where id = p_employee_id
       and company_id = v_company_id
    returning * into v_employee;

    insert into public.erp_employee_users (
      company_id,
      employee_id,
      user_id,
      email,
      is_active,
      updated_at
    )
    values (
      v_company_id,
      p_employee_id,
      p_auth_user_id,
      v_normalized_email,
      true,
      now()
    )
    on conflict (employee_id) do update
      set company_id = excluded.company_id,
          user_id = excluded.user_id,
          email = excluded.email,
          is_active = true,
          updated_at = now()
    returning id into v_employee_user_id;

    insert into public.erp_company_users (
      company_id,
      user_id,
      role_key,
      email,
      is_active,
      updated_at
    )
    values (
      v_company_id,
      p_auth_user_id,
      p_role_key,
      v_normalized_email,
      true,
      now()
    )
    on conflict (company_id, user_id) do update
      set role_key = excluded.role_key,
          email = coalesce(excluded.email, public.erp_company_users.email),
          is_active = true,
          updated_at = now()
    returning id into v_company_user_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
      if v_constraint_name = 'erp_employee_users_user_id_key' then
        raise exception 'Conflict: auth user already linked to another employee';
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_employee.id,
    'employee_code', v_employee.employee_code,
    'user_id', p_auth_user_id,
    'role_key', p_role_key,
    'email', v_normalized_email,
    'employee_user_id', v_employee_user_id,
    'company_user_id', v_company_user_id
  );
end;
$$;

revoke all on function public.erp_grant_employee_access(uuid, text, text, uuid) from public;
grant execute on function public.erp_grant_employee_access(uuid, text, text, uuid) to authenticated;

-- Manager/self-scoped employee directory
create or replace function public.erp_list_employees()
returns table (
  id uuid,
  employee_code text,
  employee_no text,
  full_name text,
  email text,
  work_email text,
  personal_email text,
  phone text,
  department text,
  designation text,
  employment_status text,
  status text,
  joining_date date,
  user_id uuid,
  role_key text,
  photo_path text,
  id_proof_path text,
  id_proof_type text,
  aadhaar_last4 text,
  address_json jsonb,
  salary_json jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_is_hr boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  v_is_hr := public.erp_is_hr_admin(v_actor);

  if not v_is_hr then
  return query
  select
    e.id,
    e.employee_code,
    e.employee_no,
    e.full_name,
    e.email,
    e.work_email,
    e.personal_email,
    e.phone,
    e.department,
    e.designation,
    e.employment_status,
    e.status,
    e.joining_date,
    e.user_id,
    null::text as role_key,
    null::text as photo_path,
    null::text as id_proof_path,
    null::text as id_proof_type,
    null::text as aadhaar_last4,
    null::jsonb as address_json,
    null::jsonb as salary_json,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  where e.company_id = v_company_id
    and e.user_id = v_actor
  limit 1;
  return;
end if;

return query
select
  e.id,
  e.employee_code,
  e.employee_no,
  e.full_name,
  coalesce(e.email, e.work_email, e.personal_email) as email,
  e.work_email,
  e.personal_email,
  e.phone,
  e.department,
  coalesce(e.designation, d.name),
  e.employment_status,
  e.status,
  e.joining_date,
  e.user_id,
    cu.role_key,
    e.photo_path,
    e.id_proof_path,
    e.id_proof_type,
    e.aadhaar_last4,
    e.address_json,
    e.salary_json,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_employee_users eu
    on eu.employee_id = e.id
   and coalesce(eu.company_id, v_company_id) = v_company_id
   and coalesce(eu.is_active, true)
  left join public.erp_company_users cu
    on cu.company_id = v_company_id
   and cu.user_id = coalesce(e.user_id, eu.user_id)
   and coalesce(cu.is_active, true)
  left join public.erp_designations d
    on d.id = e.designation_id
  where e.company_id = v_company_id
  order by e.joining_date desc nulls last, e.created_at desc;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;
