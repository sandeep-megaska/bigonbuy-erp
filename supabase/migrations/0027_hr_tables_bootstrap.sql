-- 0027_hr_tables_bootstrap.sql
-- Bootstrap HR foundation objects if missing (recovery migration)

create extension if not exists "pgcrypto";

create table if not exists public.erp_hr_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_departments_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_job_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  title text not null,
  level int null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_job_titles_company_title_key unique (company_id, title)
);

create table if not exists public.erp_hr_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  country text null,
  state text null,
  city text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_locations_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_employment_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  key text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_employment_types_company_key_key unique (company_id, key)
);

alter table public.erp_employees
  add column if not exists department_id uuid references public.erp_hr_departments (id),
  add column if not exists job_title_id uuid references public.erp_hr_job_titles (id),
  add column if not exists location_id uuid references public.erp_hr_locations (id),
  add column if not exists employment_type_id uuid references public.erp_hr_employment_types (id),
  add column if not exists manager_employee_id uuid references public.erp_employees (id),
  add column if not exists lifecycle_status text not null default 'preboarding',
  add column if not exists exit_date date,
  add column if not exists emergency_contact_json jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employees_lifecycle_status_check'
      and conrelid = 'public.erp_employees'::regclass
  ) then
    alter table public.erp_employees
      add constraint erp_employees_lifecycle_status_check
      check (lifecycle_status in ('preboarding', 'active', 'on_notice', 'exited'));
  end if;
end $$;

create table if not exists public.erp_employee_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  file_name text null,
  mime_type text null,
  size_bytes bigint null,
  notes text null,
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  deleted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_employee_documents_doc_type_check
    check (doc_type in ('photo', 'id_proof', 'offer_letter', 'certificate', 'other'))
);

create table if not exists public.erp_hr_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changes jsonb null,
  actor_user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function public.erp_hr_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists erp_hr_departments_set_updated on public.erp_hr_departments;
create trigger erp_hr_departments_set_updated
before update on public.erp_hr_departments
for each row execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_job_titles_set_updated on public.erp_hr_job_titles;
create trigger erp_hr_job_titles_set_updated
before update on public.erp_hr_job_titles
for each row execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_locations_set_updated on public.erp_hr_locations;
create trigger erp_hr_locations_set_updated
before update on public.erp_hr_locations
for each row execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_employment_types_set_updated on public.erp_hr_employment_types;
create trigger erp_hr_employment_types_set_updated
before update on public.erp_hr_employment_types
for each row execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_documents_set_updated on public.erp_employee_documents;
create trigger erp_employee_documents_set_updated
before update on public.erp_employee_documents
for each row execute function public.erp_hr_set_updated();
