-- Sprint-2D: attendance periods, attendance constraints, and freeze guard

create table if not exists public.erp_hr_attendance_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  month date not null,
  status text not null default 'open',
  frozen_at timestamptz null,
  frozen_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_attendance_periods_company_month_unique unique (company_id, month),
  constraint erp_hr_attendance_periods_status_check check (status in ('open', 'frozen'))
);

create index if not exists erp_hr_attendance_periods_company_id_idx
  on public.erp_hr_attendance_periods (company_id);

create index if not exists erp_hr_attendance_periods_company_month_idx
  on public.erp_hr_attendance_periods (company_id, month);

drop trigger if exists erp_hr_attendance_periods_set_updated_at
  on public.erp_hr_attendance_periods;
create trigger erp_hr_attendance_periods_set_updated_at
before update on public.erp_hr_attendance_periods
for each row
execute function public.erp_set_updated_at();

alter table public.erp_hr_attendance_periods enable row level security;
alter table public.erp_hr_attendance_periods force row level security;

do $$
begin
  drop policy if exists erp_hr_attendance_periods_select on public.erp_hr_attendance_periods;
  drop policy if exists erp_hr_attendance_periods_write on public.erp_hr_attendance_periods;

  create policy erp_hr_attendance_periods_select
    on public.erp_hr_attendance_periods
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_reader(auth.uid()))
    );

  create policy erp_hr_attendance_periods_write
    on public.erp_hr_attendance_periods
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
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_attendance_days_company_employee_day_unique'
       and conrelid = 'public.erp_hr_attendance_days'::regclass
  ) then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_company_employee_day_unique
      unique (company_id, employee_id, day);
  end if;
end
$$;

do $$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(c.oid)
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.erp_hr_attendance_days'::regclass
     and c.contype = 'c'
     and c.conname = 'erp_hr_attendance_days_status_check';

  if v_constraint is null then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'leave', 'holiday', 'weekly_off', 'unmarked'));
  elsif v_constraint not ilike '%unmarked%'
        and v_constraint ilike '%present%'
        and v_constraint ilike '%absent%'
        and v_constraint ilike '%leave%'
        and v_constraint ilike '%holiday%'
        and v_constraint ilike '%weekly_off%'
  then
    alter table public.erp_hr_attendance_days
      drop constraint erp_hr_attendance_days_status_check;
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'leave', 'holiday', 'weekly_off', 'unmarked'));
  end if;
end
$$;

create index if not exists erp_hr_attendance_days_company_employee_day_idx
  on public.erp_hr_attendance_days (company_id, employee_id, day);

create index if not exists erp_hr_attendance_days_company_day_idx
  on public.erp_hr_attendance_days (company_id, day);

create index if not exists erp_hr_attendance_days_company_status_day_idx
  on public.erp_hr_attendance_days (company_id, status, day);

create or replace function public.erp_attendance_period_is_frozen(p_day date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month_start date := date_trunc('month', p_day)::date;
  v_is_frozen boolean;
begin
  if p_day is null or v_company_id is null then
    return false;
  end if;

  select exists (
    select 1
      from public.erp_hr_attendance_periods ap
     where ap.company_id = v_company_id
       and ap.month = v_month_start
       and ap.status = 'frozen'
  )
    into v_is_frozen;

  return coalesce(v_is_frozen, false);
end;
$$;

revoke all on function public.erp_attendance_period_is_frozen(date) from public;
grant execute on function public.erp_attendance_period_is_frozen(date) to authenticated;

-- Smoke test (manual)
-- insert into public.erp_hr_attendance_periods (month)
-- values ('2025-02-01')
-- returning id;
--
-- update public.erp_hr_attendance_periods
--    set status = 'frozen',
--        frozen_at = now(),
--        frozen_by = '00000000-0000-0000-0000-000000000000'
--  where company_id = public.erp_current_company_id()
--    and month = '2025-02-01';
--
-- select public.erp_attendance_period_is_frozen('2025-02-15');
