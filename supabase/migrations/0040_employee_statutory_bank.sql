-- Employee statutory and bank tables
insert into public.erp_roles (key, name)
values ('payroll', 'Payroll')
on conflict (key) do nothing;

create table if not exists public.erp_employee_statutory (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  pan text null,
  uan text null,
  pf_number text null,
  esic_number text null,
  professional_tax_number text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_employee_statutory_employee_key unique (employee_id)
);

create table if not exists public.erp_employee_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  bank_name text not null,
  branch_name text null,
  account_holder_name text null,
  account_number text not null,
  ifsc_code text null,
  account_type text null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_employee_bank_accounts_primary_key
  on public.erp_employee_bank_accounts (employee_id, is_primary)
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

drop trigger if exists erp_employee_statutory_set_updated on public.erp_employee_statutory;
create trigger erp_employee_statutory_set_updated
before update on public.erp_employee_statutory
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_bank_accounts_set_updated on public.erp_employee_bank_accounts;
create trigger erp_employee_bank_accounts_set_updated
before update on public.erp_employee_bank_accounts
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_employee_statutory enable row level security;
alter table public.erp_employee_statutory force row level security;

alter table public.erp_employee_bank_accounts enable row level security;
alter table public.erp_employee_bank_accounts force row level security;

do $$
begin
  drop policy if exists erp_employee_statutory_select on public.erp_employee_statutory;
  drop policy if exists erp_employee_statutory_write on public.erp_employee_statutory;
  drop policy if exists erp_employee_bank_accounts_select on public.erp_employee_bank_accounts;
  drop policy if exists erp_employee_bank_accounts_write on public.erp_employee_bank_accounts;

  create policy erp_employee_statutory_select
    on public.erp_employee_statutory
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_statutory_write
    on public.erp_employee_statutory
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_bank_accounts_select
    on public.erp_employee_bank_accounts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );

  create policy erp_employee_bank_accounts_write
    on public.erp_employee_bank_accounts
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );
end
$$;

notify pgrst, 'reload schema';
