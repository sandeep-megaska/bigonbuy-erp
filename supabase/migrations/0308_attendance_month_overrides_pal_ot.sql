-- Attendance month overrides for payroll (Present/Absent/Leave + OT)

create table if not exists public.erp_attendance_month_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  month date not null,
  employee_id uuid not null,
  present_days_override numeric(5, 2) null,
  absent_days_override numeric(5, 2) null,
  paid_leave_days_override numeric(5, 2) null,
  ot_minutes_override int null,
  use_override boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  constraint erp_attendance_month_overrides_company_month_employee_unique
    unique (company_id, month, employee_id),
  constraint erp_attendance_month_overrides_non_negative_check
    check (
      (present_days_override is null or present_days_override >= 0)
      and (absent_days_override is null or absent_days_override >= 0)
      and (paid_leave_days_override is null or paid_leave_days_override >= 0)
      and (ot_minutes_override is null or ot_minutes_override >= 0)
    )
);

create index if not exists erp_attendance_month_overrides_company_month_idx
  on public.erp_attendance_month_overrides (company_id, month);

drop trigger if exists erp_attendance_month_overrides_set_updated_at
  on public.erp_attendance_month_overrides;
create trigger erp_attendance_month_overrides_set_updated_at
before update on public.erp_attendance_month_overrides
for each row execute function public.erp_set_updated_at();

alter table public.erp_attendance_month_overrides enable row level security;
alter table public.erp_attendance_month_overrides force row level security;

do $$
begin
  drop policy if exists erp_attendance_month_overrides_select
    on public.erp_attendance_month_overrides;
  drop policy if exists erp_attendance_month_overrides_write
    on public.erp_attendance_month_overrides;

  create policy erp_attendance_month_overrides_select
    on public.erp_attendance_month_overrides
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_attendance_month_overrides_write
    on public.erp_attendance_month_overrides
    for all
    using (false)
    with check (false);
end
$$;

create or replace function public.erp_attendance_month_override_get(
  p_month date,
  p_employee_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
  v_result jsonb;
begin
  perform public.erp_require_hr_reader();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  select to_jsonb(o)
    into v_result
    from public.erp_attendance_month_overrides o
   where o.company_id = v_company_id
     and o.employee_id = p_employee_id
     and o.month = v_month
   limit 1;

  return v_result;
end;
$$;

revoke all on function public.erp_attendance_month_override_get(date, uuid) from public;
grant execute on function public.erp_attendance_month_override_get(date, uuid) to authenticated;

create or replace function public.erp_attendance_month_override_upsert(
  p_month date,
  p_employee_id uuid,
  p_present_days numeric default null,
  p_absent_days numeric default null,
  p_paid_leave_days numeric default null,
  p_ot_minutes int default null,
  p_use_override boolean default true,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
  v_id uuid;
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  insert into public.erp_attendance_month_overrides (
    company_id,
    month,
    employee_id,
    present_days_override,
    absent_days_override,
    paid_leave_days_override,
    ot_minutes_override,
    use_override,
    notes,
    created_at,
    updated_at,
    updated_by_user_id
  ) values (
    v_company_id,
    v_month,
    p_employee_id,
    p_present_days,
    p_absent_days,
    p_paid_leave_days,
    p_ot_minutes,
    coalesce(p_use_override, true),
    p_notes,
    now(),
    now(),
    auth.uid()
  )
  on conflict (company_id, month, employee_id) do update
    set present_days_override = excluded.present_days_override,
        absent_days_override = excluded.absent_days_override,
        paid_leave_days_override = excluded.paid_leave_days_override,
        ot_minutes_override = excluded.ot_minutes_override,
        use_override = excluded.use_override,
        notes = excluded.notes,
        updated_at = now(),
        updated_by_user_id = auth.uid()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_attendance_month_override_upsert(date, uuid, numeric, numeric, numeric, int, boolean, text) from public;
grant execute on function public.erp_attendance_month_override_upsert(date, uuid, numeric, numeric, numeric, int, boolean, text) to authenticated;

create or replace function public.erp_attendance_month_override_clear(
  p_month date,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  delete from public.erp_attendance_month_overrides o
   where o.company_id = v_company_id
     and o.employee_id = p_employee_id
     and o.month = v_month;
end;
$$;

revoke all on function public.erp_attendance_month_override_clear(date, uuid) from public;
grant execute on function public.erp_attendance_month_override_clear(date, uuid) to authenticated;

create or replace function public.erp_attendance_month_employee_summary(
  p_month date,
  p_employee_ids uuid[] default null
)
returns table (
  employee_id uuid,
  present_days_computed numeric,
  absent_days_computed numeric,
  paid_leave_days_computed numeric,
  ot_minutes_computed int,
  present_days_override numeric,
  absent_days_override numeric,
  paid_leave_days_override numeric,
  ot_minutes_override int,
  use_override boolean,
  present_days_effective numeric,
  absent_days_effective numeric,
  paid_leave_days_effective numeric,
  ot_minutes_effective int,
  override_notes text
)
language plpgsql
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
begin
  perform public.erp_require_hr_reader();

  v_month := date_trunc('month', p_month)::date;

  return query
  with employees as (
    select e.id as employee_id
      from public.erp_employees e
     where e.company_id = v_company_id
       and (p_employee_ids is null or e.id = any(p_employee_ids))
  ),
  computed as (
    select
      s.employee_id,
      coalesce(s.present_days, 0)::numeric as present_days,
      coalesce(s.absent_days, 0)::numeric as absent_days,
      coalesce(s.leave_paid_days, 0)::numeric as paid_leave_days
    from public.erp_attendance_payroll_month_summary_v s
    where s.company_id = v_company_id
      and s.month = v_month
  ),
  ot_summary as (
    select
      ad.employee_id,
      sum(case when ad.status = 'present' then coalesce(ad.ot_minutes, 0) else 0 end)::int as ot_minutes
    from public.erp_hr_attendance_days ad
    where ad.company_id = v_company_id
      and ad.day >= v_month
      and ad.day < (v_month + interval '1 month')
    group by ad.employee_id
  )
  select
    e.employee_id,
    coalesce(c.present_days, 0)::numeric as present_days_computed,
    coalesce(c.absent_days, 0)::numeric as absent_days_computed,
    coalesce(c.paid_leave_days, 0)::numeric as paid_leave_days_computed,
    coalesce(o.ot_minutes, 0)::int as ot_minutes_computed,
    ovr.present_days_override,
    ovr.absent_days_override,
    ovr.paid_leave_days_override,
    ovr.ot_minutes_override,
    coalesce(ovr.use_override, false) as use_override,
    case
      when ovr.id is not null and ovr.use_override
        then coalesce(ovr.present_days_override, coalesce(c.present_days, 0))
      else coalesce(c.present_days, 0)
    end as present_days_effective,
    case
      when ovr.id is not null and ovr.use_override
        then coalesce(ovr.absent_days_override, coalesce(c.absent_days, 0))
      else coalesce(c.absent_days, 0)
    end as absent_days_effective,
    case
      when ovr.id is not null and ovr.use_override
        then coalesce(ovr.paid_leave_days_override, coalesce(c.paid_leave_days, 0))
      else coalesce(c.paid_leave_days, 0)
    end as paid_leave_days_effective,
    case
      when ovr.id is not null and ovr.use_override
        then coalesce(ovr.ot_minutes_override, coalesce(o.ot_minutes, 0))
      else coalesce(o.ot_minutes, 0)
    end as ot_minutes_effective,
    ovr.notes as override_notes
  from employees e
  left join computed c
    on c.employee_id = e.employee_id
  left join ot_summary o
    on o.employee_id = e.employee_id
  left join public.erp_attendance_month_overrides ovr
    on ovr.company_id = v_company_id
   and ovr.employee_id = e.employee_id
   and ovr.month = v_month
  order by e.employee_id;
end;
$$;

revoke all on function public.erp_attendance_month_employee_summary(date, uuid[]) from public;
grant execute on function public.erp_attendance_month_employee_summary(date, uuid[]) to authenticated;

create or replace function public.erp_payroll_run_attach_attendance(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_year int;
  v_month int;
  v_month_start date;
  v_attendance_status text;
  v_updated_count integer := 0;
begin
  perform public.erp_require_hr_writer();

  select r.company_id, r.year, r.month
    into v_company_id, v_year, v_month
    from public.erp_payroll_runs r
   where r.id = p_run_id;

  if v_company_id is null then
    raise exception 'Payroll run not found';
  end if;

  v_month_start := make_date(v_year, v_month, 1);

  select ap.status
    into v_attendance_status
    from public.erp_hr_attendance_periods ap
   where ap.company_id = v_company_id
     and ap.month = v_month_start;

  with summary as (
    select
      s.employee_id,
      s.present_days_effective as present_days,
      s.paid_leave_days_effective as paid_leave_days,
      s.absent_days_effective as absent_days,
      s.ot_minutes_effective as ot_minutes,
      coalesce(ms.leave_unpaid_days, 0)::numeric as leave_unpaid_days,
      coalesce(ms.holiday_days, 0)::numeric as holiday_days,
      coalesce(ms.weekly_off_days, 0)::numeric as weekly_off_days
    from public.erp_attendance_month_employee_summary(v_month_start, null) s
    left join public.erp_attendance_payroll_month_summary_v ms
      on ms.company_id = v_company_id
     and ms.employee_id = s.employee_id
     and ms.month = v_month_start
  )
  update public.erp_payroll_items pi
     set payable_days_suggested = (
           coalesce(summary.present_days, 0)
           + coalesce(summary.paid_leave_days, 0)
           + coalesce(summary.holiday_days, 0)
           + coalesce(summary.weekly_off_days, 0)
         )::numeric(6,2),
         lop_days_suggested = (
           coalesce(summary.absent_days, 0)
           + coalesce(summary.leave_unpaid_days, 0)
         )::numeric(6,2),
         present_days_suggested = coalesce(summary.present_days, 0)::numeric(6,2),
         paid_leave_days_suggested = coalesce(summary.paid_leave_days, 0)::numeric(6,2),
         unpaid_leave_days_suggested = coalesce(summary.leave_unpaid_days, 0)::numeric(6,2),
         attendance_source = 'attendance_v2'
    from summary
   where pi.company_id = v_company_id
     and pi.payroll_run_id = p_run_id
     and summary.employee_id = pi.employee_id;

  get diagnostics v_updated_count = row_count;

  update public.erp_payroll_runs r
     set attendance_month = v_month_start,
         attendance_period_status = v_attendance_status,
         attendance_snapshot_at = now(),
         attendance_snapshot_by = auth.uid()
   where r.id = p_run_id;

  return v_updated_count;
end;
$$;

revoke all on function public.erp_payroll_run_attach_attendance(uuid) from public;
grant execute on function public.erp_payroll_run_attach_attendance(uuid) to authenticated;

notify pgrst, 'reload schema';
