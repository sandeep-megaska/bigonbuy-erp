-- Salary structures and components
-- Ensure required columns exist even if table was created earlier
alter table public.erp_salary_structures
  add column if not exists company_id uuid,
  add column if not exists name text;
alter table public.erp_salary_structures
  add column if not exists pay_frequency text default 'monthly',
  add column if not exists currency text default 'INR',
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Optional: If company_id should be NOT NULL later, do it after backfill.

create table if not exists public.erp_salary_structures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  description text null,
  currency text not null default 'INR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_salary_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  structure_id uuid not null references public.erp_salary_structures (id) on delete cascade,
  name text not null,
  code text null,
  component_type text not null default 'earning',
  calc_type text not null default 'fixed',
  default_amount numeric(12, 2) null,
  is_taxable boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_salary_components_type_check
    check (component_type in ('earning', 'deduction')),
  constraint erp_salary_components_calc_check
    check (calc_type in ('fixed', 'percent'))
);

create unique index if not exists erp_salary_structures_company_name_key
  on public.erp_salary_structures (company_id, name);

create unique index if not exists erp_salary_structures_company_code_key
  on public.erp_salary_structures (company_id, code)
  where code is not null;

create unique index if not exists erp_salary_components_structure_code_key
  on public.erp_salary_components (structure_id, code)
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

drop trigger if exists erp_salary_structures_set_updated on public.erp_salary_structures;
create trigger erp_salary_structures_set_updated
before update on public.erp_salary_structures
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_salary_components_set_updated on public.erp_salary_components;
create trigger erp_salary_components_set_updated
before update on public.erp_salary_components
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_salary_structures enable row level security;
alter table public.erp_salary_structures force row level security;

alter table public.erp_salary_components enable row level security;
alter table public.erp_salary_components force row level security;

do $$
begin
  drop policy if exists erp_salary_structures_select on public.erp_salary_structures;
  drop policy if exists erp_salary_structures_write on public.erp_salary_structures;
  drop policy if exists erp_salary_components_select on public.erp_salary_components;
  drop policy if exists erp_salary_components_write on public.erp_salary_components;

  create policy erp_salary_structures_select
    on public.erp_salary_structures
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_salary_structures_write
    on public.erp_salary_structures
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_salary_components_select
    on public.erp_salary_components
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_salary_components_write
    on public.erp_salary_components
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
