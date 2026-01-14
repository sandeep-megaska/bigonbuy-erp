-- Sprint-2B: attendance weekly off rules

create table if not exists public.erp_weekly_off_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  scope_type text not null,
  location_id uuid null references public.erp_hr_locations(id) on delete cascade,
  employee_id uuid null references public.erp_employees(id) on delete cascade,
  weekday int not null,
  week_of_month int null,
  is_off boolean not null default true,
  effective_from date not null,
  effective_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_weekly_off_rules_scope_check
    check (
      scope_type in ('location', 'employee')
      and (
        (scope_type = 'location' and location_id is not null and employee_id is null)
        or (scope_type = 'employee' and employee_id is not null and location_id is null)
      )
    ),
  constraint erp_weekly_off_rules_weekday_check
    check (weekday between 0 and 6),
  constraint erp_weekly_off_rules_week_of_month_check
    check (week_of_month is null or week_of_month between 1 and 5),
  constraint erp_weekly_off_rules_effective_range_check
    check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists erp_weekly_off_rules_company_scope_day_key
  on public.erp_weekly_off_rules (
    company_id,
    scope_type,
    location_id,
    employee_id,
    weekday,
    coalesce(week_of_month, 0),
    effective_from
  );

create index if not exists erp_weekly_off_rules_company_id_idx
  on public.erp_weekly_off_rules (company_id);

create index if not exists erp_weekly_off_rules_company_scope_idx
  on public.erp_weekly_off_rules (company_id, scope_type);

create index if not exists erp_weekly_off_rules_employee_id_idx
  on public.erp_weekly_off_rules (employee_id);

create index if not exists erp_weekly_off_rules_location_id_idx
  on public.erp_weekly_off_rules (location_id);

create index if not exists erp_weekly_off_rules_weekday_idx
  on public.erp_weekly_off_rules (weekday);

create index if not exists erp_weekly_off_rules_effective_range_idx
  on public.erp_weekly_off_rules (effective_from, effective_to);

drop trigger if exists erp_weekly_off_rules_set_updated_at on public.erp_weekly_off_rules;
create trigger erp_weekly_off_rules_set_updated_at
before update on public.erp_weekly_off_rules
for each row
execute function public.erp_set_updated_at();

alter table public.erp_weekly_off_rules enable row level security;
alter table public.erp_weekly_off_rules force row level security;

do $$
begin
  drop policy if exists erp_weekly_off_rules_select on public.erp_weekly_off_rules;
  drop policy if exists erp_weekly_off_rules_write on public.erp_weekly_off_rules;

  create policy erp_weekly_off_rules_select
    on public.erp_weekly_off_rules
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_weekly_off_rules_write
    on public.erp_weekly_off_rules
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

-- Smoke test (manual)
-- insert into public.erp_weekly_off_rules (scope_type, location_id, weekday, effective_from)
-- values ('location', '00000000-0000-0000-0000-000000000000', 0, '2026-01-01');
--
-- insert into public.erp_weekly_off_rules (scope_type, location_id, weekday, week_of_month, effective_from)
-- values
--   ('location', '00000000-0000-0000-0000-000000000000', 6, 2, '2026-01-01'),
--   ('location', '00000000-0000-0000-0000-000000000000', 6, 4, '2026-01-01');
--
-- insert into public.erp_weekly_off_rules (scope_type, employee_id, weekday, effective_from)
-- values ('employee', '00000000-0000-0000-0000-000000000000', 0, '2026-01-01');
