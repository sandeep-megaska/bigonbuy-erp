-- Employee profile tables: contacts, addresses, emergency contacts
create table if not exists public.erp_employee_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  contact_type text not null default 'primary',
  email text null,
  phone text null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_employee_contacts_type_check
    check (contact_type in ('primary', 'work', 'personal'))
);

create table if not exists public.erp_employee_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  address_type text not null default 'current',
  line1 text null,
  line2 text null,
  city text null,
  state text null,
  postal_code text null,
  country text null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_employee_addresses_type_check
    check (address_type in ('current', 'permanent', 'other'))
);

create table if not exists public.erp_employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  full_name text not null,
  relationship text null,
  phone text null,
  email text null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_employee_contacts_employee_type_key
  on public.erp_employee_contacts (employee_id, contact_type);

create unique index if not exists erp_employee_addresses_employee_type_key
  on public.erp_employee_addresses (employee_id, address_type);

create unique index if not exists erp_employee_emergency_contacts_employee_primary_key
  on public.erp_employee_emergency_contacts (employee_id, is_primary)
  where is_primary;

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

drop trigger if exists erp_employee_contacts_set_updated on public.erp_employee_contacts;
create trigger erp_employee_contacts_set_updated
before update on public.erp_employee_contacts
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_addresses_set_updated on public.erp_employee_addresses;
create trigger erp_employee_addresses_set_updated
before update on public.erp_employee_addresses
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_emergency_contacts_set_updated on public.erp_employee_emergency_contacts;
create trigger erp_employee_emergency_contacts_set_updated
before update on public.erp_employee_emergency_contacts
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_employee_contacts enable row level security;
alter table public.erp_employee_contacts force row level security;

alter table public.erp_employee_addresses enable row level security;
alter table public.erp_employee_addresses force row level security;

alter table public.erp_employee_emergency_contacts enable row level security;
alter table public.erp_employee_emergency_contacts force row level security;

do $$
begin
  drop policy if exists erp_employee_contacts_select on public.erp_employee_contacts;
  drop policy if exists erp_employee_contacts_write on public.erp_employee_contacts;
  drop policy if exists erp_employee_addresses_select on public.erp_employee_addresses;
  drop policy if exists erp_employee_addresses_write on public.erp_employee_addresses;
  drop policy if exists erp_employee_emergency_contacts_select on public.erp_employee_emergency_contacts;
  drop policy if exists erp_employee_emergency_contacts_write on public.erp_employee_emergency_contacts;

  create policy erp_employee_contacts_select
    on public.erp_employee_contacts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
        or exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_contacts_write
    on public.erp_employee_contacts
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_addresses_select
    on public.erp_employee_addresses
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
        or exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_addresses_write
    on public.erp_employee_addresses
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_emergency_contacts_select
    on public.erp_employee_emergency_contacts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
        or exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_emergency_contacts_write
    on public.erp_employee_emergency_contacts
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
