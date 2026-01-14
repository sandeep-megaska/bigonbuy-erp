-- Sprint-2A: attendance calendars + holidays

create table if not exists public.erp_calendars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  code text not null,
  name text not null,
  timezone text null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_calendar_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  calendar_id uuid not null references public.erp_calendars(id) on delete cascade,
  work_location_id uuid not null references public.erp_work_locations(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.erp_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  calendar_id uuid not null references public.erp_calendars(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  holiday_type text not null default 'public',
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_calendar_holidays_type_check
    check (holiday_type in ('public', 'company'))
);

create unique index if not exists erp_calendars_company_code_key
  on public.erp_calendars (company_id, code);

create unique index if not exists erp_calendars_company_default_key
  on public.erp_calendars (company_id)
  where is_default;

create index if not exists erp_calendars_company_id_idx
  on public.erp_calendars (company_id);

create index if not exists erp_calendars_company_default_idx
  on public.erp_calendars (company_id, is_default);

create unique index if not exists erp_calendar_locations_company_calendar_location_key
  on public.erp_calendar_locations (company_id, calendar_id, work_location_id);

create index if not exists erp_calendar_locations_company_id_idx
  on public.erp_calendar_locations (company_id);

create index if not exists erp_calendar_locations_calendar_id_idx
  on public.erp_calendar_locations (calendar_id);

create index if not exists erp_calendar_locations_work_location_id_idx
  on public.erp_calendar_locations (work_location_id);

create unique index if not exists erp_calendar_holidays_company_calendar_date_key
  on public.erp_calendar_holidays (company_id, calendar_id, holiday_date);

create index if not exists erp_calendar_holidays_company_id_idx
  on public.erp_calendar_holidays (company_id);

create index if not exists erp_calendar_holidays_calendar_id_idx
  on public.erp_calendar_holidays (calendar_id);

create index if not exists erp_calendar_holidays_holiday_date_idx
  on public.erp_calendar_holidays (holiday_date);

drop trigger if exists erp_calendars_set_updated_at on public.erp_calendars;
create trigger erp_calendars_set_updated_at
before update on public.erp_calendars
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_calendar_holidays_set_updated_at on public.erp_calendar_holidays;
create trigger erp_calendar_holidays_set_updated_at
before update on public.erp_calendar_holidays
for each row
execute function public.erp_set_updated_at();

alter table public.erp_calendars enable row level security;
alter table public.erp_calendars force row level security;

alter table public.erp_calendar_locations enable row level security;
alter table public.erp_calendar_locations force row level security;

alter table public.erp_calendar_holidays enable row level security;
alter table public.erp_calendar_holidays force row level security;

do $$
begin
  drop policy if exists erp_calendars_select on public.erp_calendars;
  drop policy if exists erp_calendars_write on public.erp_calendars;
  drop policy if exists erp_calendar_locations_select on public.erp_calendar_locations;
  drop policy if exists erp_calendar_locations_write on public.erp_calendar_locations;
  drop policy if exists erp_calendar_holidays_select on public.erp_calendar_holidays;
  drop policy if exists erp_calendar_holidays_write on public.erp_calendar_holidays;

  create policy erp_calendars_select
    on public.erp_calendars
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_calendars_write
    on public.erp_calendars
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_calendar_locations_select
    on public.erp_calendar_locations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_calendar_locations_write
    on public.erp_calendar_locations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_calendar_holidays_select
    on public.erp_calendar_holidays
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_calendar_holidays_write
    on public.erp_calendar_holidays
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
-- insert into public.erp_calendars (code, name, timezone, is_default)
-- values ('std', 'Standard Calendar', 'UTC', true)
-- returning id;
--
-- insert into public.erp_calendar_locations (calendar_id, work_location_id)
-- values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000');
--
-- insert into public.erp_calendar_holidays (calendar_id, holiday_date, name, holiday_type)
-- values ('00000000-0000-0000-0000-000000000000', '2025-01-01', 'New Year\'s Day', 'public');
--
-- select c.name as calendar_name,
--        h.holiday_date,
--        h.name as holiday_name,
--        wl.id as work_location_id
--   from public.erp_calendars c
--   left join public.erp_calendar_holidays h on h.calendar_id = c.id
--   left join public.erp_calendar_locations cl on cl.calendar_id = c.id
--   left join public.erp_work_locations wl on wl.id = cl.work_location_id;
