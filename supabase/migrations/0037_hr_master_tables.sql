-- HR master tables: departments, designations, grades, locations, cost centers
create table if not exists public.erp_hr_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_hr_designations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_hr_grades (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_hr_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  country text null,
  state text null,
  city text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_hr_cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

alter table public.erp_hr_departments
  add column if not exists code text,
  add column if not exists description text;

alter table public.erp_hr_locations
  add column if not exists code text,
  add column if not exists description text;

create unique index if not exists erp_hr_departments_company_name_key
  on public.erp_hr_departments (company_id, name);

create unique index if not exists erp_hr_departments_company_code_key
  on public.erp_hr_departments (company_id, code)
  where code is not null;

create unique index if not exists erp_hr_designations_company_name_key
  on public.erp_hr_designations (company_id, name);

create unique index if not exists erp_hr_designations_company_code_key
  on public.erp_hr_designations (company_id, code)
  where code is not null;

create unique index if not exists erp_hr_grades_company_name_key
  on public.erp_hr_grades (company_id, name);

create unique index if not exists erp_hr_grades_company_code_key
  on public.erp_hr_grades (company_id, code)
  where code is not null;

create unique index if not exists erp_hr_locations_company_name_key
  on public.erp_hr_locations (company_id, name);

create unique index if not exists erp_hr_locations_company_code_key
  on public.erp_hr_locations (company_id, code)
  where code is not null;

create unique index if not exists erp_hr_cost_centers_company_name_key
  on public.erp_hr_cost_centers (company_id, name);

create unique index if not exists erp_hr_cost_centers_company_code_key
  on public.erp_hr_cost_centers (company_id, code)
  where code is not null;

-- updated_at trigger helper
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
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_designations_set_updated on public.erp_hr_designations;
create trigger erp_hr_designations_set_updated
before update on public.erp_hr_designations
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_grades_set_updated on public.erp_hr_grades;
create trigger erp_hr_grades_set_updated
before update on public.erp_hr_grades
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_locations_set_updated on public.erp_hr_locations;
create trigger erp_hr_locations_set_updated
before update on public.erp_hr_locations
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_cost_centers_set_updated on public.erp_hr_cost_centers;
create trigger erp_hr_cost_centers_set_updated
before update on public.erp_hr_cost_centers
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_hr_departments enable row level security;
alter table public.erp_hr_departments force row level security;

alter table public.erp_hr_designations enable row level security;
alter table public.erp_hr_designations force row level security;

alter table public.erp_hr_grades enable row level security;
alter table public.erp_hr_grades force row level security;

alter table public.erp_hr_locations enable row level security;
alter table public.erp_hr_locations force row level security;

alter table public.erp_hr_cost_centers enable row level security;
alter table public.erp_hr_cost_centers force row level security;

do $$
begin
  drop policy if exists erp_hr_departments_select on public.erp_hr_departments;
  drop policy if exists erp_hr_departments_write on public.erp_hr_departments;
  drop policy if exists erp_hr_designations_select on public.erp_hr_designations;
  drop policy if exists erp_hr_designations_write on public.erp_hr_designations;
  drop policy if exists erp_hr_grades_select on public.erp_hr_grades;
  drop policy if exists erp_hr_grades_write on public.erp_hr_grades;
  drop policy if exists erp_hr_locations_select on public.erp_hr_locations;
  drop policy if exists erp_hr_locations_write on public.erp_hr_locations;
  drop policy if exists erp_hr_cost_centers_select on public.erp_hr_cost_centers;
  drop policy if exists erp_hr_cost_centers_write on public.erp_hr_cost_centers;

  create policy erp_hr_departments_select
    on public.erp_hr_departments
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_departments_write
    on public.erp_hr_departments
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_designations_select
    on public.erp_hr_designations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_designations_write
    on public.erp_hr_designations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_grades_select
    on public.erp_hr_grades
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_grades_write
    on public.erp_hr_grades
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_locations_select
    on public.erp_hr_locations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_locations_write
    on public.erp_hr_locations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_cost_centers_select
    on public.erp_hr_cost_centers
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_cost_centers_write
    on public.erp_hr_cost_centers
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
end
$$;

notify pgrst, 'reload schema';
