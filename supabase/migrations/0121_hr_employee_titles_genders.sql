begin;

create table if not exists public.erp_hr_employee_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_titles_company_code_key unique (company_id, code),
  constraint erp_hr_employee_titles_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_employee_genders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_genders_company_code_key unique (company_id, code),
  constraint erp_hr_employee_genders_company_name_key unique (company_id, name)
);

alter table public.erp_employees
  add column if not exists title_id uuid references public.erp_hr_employee_titles(id),
  add column if not exists gender_id uuid references public.erp_hr_employee_genders(id);

drop trigger if exists erp_hr_employee_titles_set_updated on public.erp_hr_employee_titles;
create trigger erp_hr_employee_titles_set_updated
before update on public.erp_hr_employee_titles
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_employee_genders_set_updated on public.erp_hr_employee_genders;
create trigger erp_hr_employee_genders_set_updated
before update on public.erp_hr_employee_genders
for each row
execute function public.erp_hr_set_updated();

alter table public.erp_hr_employee_titles enable row level security;
alter table public.erp_hr_employee_titles force row level security;

alter table public.erp_hr_employee_genders enable row level security;
alter table public.erp_hr_employee_genders force row level security;

do $$
begin
  drop policy if exists erp_hr_employee_titles_select on public.erp_hr_employee_titles;
  drop policy if exists erp_hr_employee_titles_write on public.erp_hr_employee_titles;
  drop policy if exists erp_hr_employee_genders_select on public.erp_hr_employee_genders;
  drop policy if exists erp_hr_employee_genders_write on public.erp_hr_employee_genders;

  create policy erp_hr_employee_titles_select
    on public.erp_hr_employee_titles
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_employee_titles_write
    on public.erp_hr_employee_titles
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_employee_genders_select
    on public.erp_hr_employee_genders
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_employee_genders_write
    on public.erp_hr_employee_genders
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
end $$;

insert into public.erp_hr_employee_titles (company_id, code, name, sort_order)
select
  public.erp_current_company_id(),
  defaults.code,
  defaults.name,
  defaults.sort_order
from (
  values
    ('MR', 'Mr', 1),
    ('MRS', 'Mrs', 2),
    ('MS', 'Ms', 3),
    ('DR', 'Dr', 4),
    ('ER', 'Er', 5)
) as defaults(code, name, sort_order)
where public.erp_current_company_id() is not null
  and not exists (
    select 1
    from public.erp_hr_employee_titles t
    where t.company_id = public.erp_current_company_id()
      and t.code = defaults.code
  );

insert into public.erp_hr_employee_genders (company_id, code, name, sort_order)
select
  public.erp_current_company_id(),
  defaults.code,
  defaults.name,
  defaults.sort_order
from (
  values
    ('MALE', 'Male', 1),
    ('FEMALE', 'Female', 2),
    ('OTHER', 'Other', 3),
    ('PREFER_NOT', 'Prefer not to say', 4)
) as defaults(code, name, sort_order)
where public.erp_current_company_id() is not null
  and not exists (
    select 1
    from public.erp_hr_employee_genders g
    where g.company_id = public.erp_current_company_id()
      and g.code = defaults.code
  );

commit;
