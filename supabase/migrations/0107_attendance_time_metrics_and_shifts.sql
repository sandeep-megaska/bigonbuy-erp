-- Sprint-2E: attendance time metrics and shift masters

alter table public.erp_hr_attendance_days
  add column if not exists work_minutes int null,
  add column if not exists late_minutes int null,
  add column if not exists early_leave_minutes int null,
  add column if not exists ot_minutes int null,
  add column if not exists day_fraction numeric(3, 2) null,
  add column if not exists shift_id uuid null,
  add column if not exists computed_at timestamptz null,
  add column if not exists computed_by uuid null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_attendance_days_day_fraction_check'
       and conrelid = 'public.erp_hr_attendance_days'::regclass
  ) then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_day_fraction_check
      check (day_fraction is null or day_fraction in (0.5, 1.0));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_attendance_days_minutes_non_negative_check'
       and conrelid = 'public.erp_hr_attendance_days'::regclass
  ) then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_minutes_non_negative_check
      check (
        (work_minutes is null or work_minutes >= 0)
        and (late_minutes is null or late_minutes >= 0)
        and (early_leave_minutes is null or early_leave_minutes >= 0)
        and (ot_minutes is null or ot_minutes >= 0)
      );
  end if;
end
$$;

create index if not exists erp_hr_attendance_days_company_employee_day_idx
  on public.erp_hr_attendance_days (company_id, employee_id, day);

create index if not exists erp_hr_attendance_days_company_day_idx
  on public.erp_hr_attendance_days (company_id, day);

create index if not exists erp_hr_attendance_days_company_status_day_idx
  on public.erp_hr_attendance_days (company_id, status, day);

create table if not exists public.erp_hr_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  code text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0,
  grace_minutes int not null default 0,
  min_half_day_minutes int not null default 240,
  min_full_day_minutes int not null default 480,
  ot_after_minutes int null,
  is_night_shift boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_shifts_company_code_unique unique (company_id, code)
);

do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints tc
     where tc.table_schema = 'public'
       and tc.table_name = 'erp_hr_attendance_days'
       and tc.constraint_type = 'FOREIGN KEY'
       and tc.constraint_name = 'erp_hr_attendance_days_shift_id_fkey'
  ) then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_shift_id_fkey
      foreign key (shift_id)
      references public.erp_hr_shifts(id)
      on delete set null;
  end if;
end
$$;

create table if not exists public.erp_hr_location_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  location_id uuid not null references public.erp_hr_locations(id) on delete cascade,
  shift_id uuid not null references public.erp_hr_shifts(id) on delete restrict,
  effective_from date not null,
  effective_to date null,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_location_shifts_effective_range_check
    check (effective_to is null or effective_to >= effective_from),
  constraint erp_hr_location_shifts_unique
    unique (company_id, location_id, shift_id, effective_from)
);

create index if not exists erp_hr_location_shifts_company_location_effective_idx
  on public.erp_hr_location_shifts (company_id, location_id, effective_from);

create table if not exists public.erp_hr_employee_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees(id) on delete cascade,
  shift_id uuid not null references public.erp_hr_shifts(id) on delete restrict,
  effective_from date not null,
  effective_to date null,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_shifts_effective_range_check
    check (effective_to is null or effective_to >= effective_from),
  constraint erp_hr_employee_shifts_unique
    unique (company_id, employee_id, shift_id, effective_from)
);

create index if not exists erp_hr_employee_shifts_company_employee_effective_idx
  on public.erp_hr_employee_shifts (company_id, employee_id, effective_from);

drop trigger if exists erp_hr_shifts_set_updated_at on public.erp_hr_shifts;
create trigger erp_hr_shifts_set_updated_at
before update on public.erp_hr_shifts
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_location_shifts_set_updated_at
  on public.erp_hr_location_shifts;
create trigger erp_hr_location_shifts_set_updated_at
before update on public.erp_hr_location_shifts
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_employee_shifts_set_updated_at
  on public.erp_hr_employee_shifts;
create trigger erp_hr_employee_shifts_set_updated_at
before update on public.erp_hr_employee_shifts
for each row
execute function public.erp_set_updated_at();

alter table public.erp_hr_shifts enable row level security;
alter table public.erp_hr_shifts force row level security;

alter table public.erp_hr_location_shifts enable row level security;
alter table public.erp_hr_location_shifts force row level security;

alter table public.erp_hr_employee_shifts enable row level security;
alter table public.erp_hr_employee_shifts force row level security;

do $$
begin
  drop policy if exists erp_hr_shifts_select on public.erp_hr_shifts;
  drop policy if exists erp_hr_shifts_write on public.erp_hr_shifts;

  create policy erp_hr_shifts_select
    on public.erp_hr_shifts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_hr_shifts_write
    on public.erp_hr_shifts
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

do $$
begin
  drop policy if exists erp_hr_location_shifts_select on public.erp_hr_location_shifts;
  drop policy if exists erp_hr_location_shifts_write on public.erp_hr_location_shifts;

  create policy erp_hr_location_shifts_select
    on public.erp_hr_location_shifts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_hr_location_shifts_write
    on public.erp_hr_location_shifts
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

do $$
begin
  drop policy if exists erp_hr_employee_shifts_select on public.erp_hr_employee_shifts;
  drop policy if exists erp_hr_employee_shifts_write on public.erp_hr_employee_shifts;

  create policy erp_hr_employee_shifts_select
    on public.erp_hr_employee_shifts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_hr_employee_shifts_write
    on public.erp_hr_employee_shifts
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
-- insert into public.erp_hr_shifts (code, name, start_time, end_time)
-- values ('DAY', 'Day Shift', '09:00', '18:00')
-- returning id;
