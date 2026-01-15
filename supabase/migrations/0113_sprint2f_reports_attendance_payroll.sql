-- Sprint-2F: Attendance -> Payroll reports (read-only)

create or replace function public.erp_require_hr_reader()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_hr_reader() from public;
grant execute on function public.erp_require_hr_reader() to authenticated;

create or replace function public.erp_report_attendance_payroll_summary(
  p_run_id uuid
) returns table (
  employee_id uuid,
  employee_code text,
  employee_name text,
  designation_name text,
  period_start date,
  period_end date,
  calendar_days int,
  present_days numeric,
  absent_days numeric,
  leave_days numeric,
  paid_days numeric,
  manual_ot_hours numeric,
  gross_pay numeric,
  net_pay numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_hr_reader();

  return query
  with payroll_run as (
    select
      r.id,
      r.company_id,
      make_date(r.year, r.month, 1) as period_start,
      (make_date(r.year, r.month, 1) + interval '1 month - 1 day')::date as period_end
    from public.erp_payroll_runs r
    where r.company_id = v_company_id
      and r.id = p_run_id
  ),
  payroll_items as (
    select
      pi.id as payroll_item_id,
      pi.employee_id,
      pi.gross as gross_pay,
      pi.net_pay
    from public.erp_payroll_items pi
    join payroll_run pr
      on pr.company_id = pi.company_id
     and pr.id = pi.payroll_run_id
  ),
  ot_lines as (
    select
      pil.payroll_item_id,
      sum(coalesce(pil.units, 0))::numeric as manual_ot_hours
    from public.erp_payroll_item_lines pil
    join payroll_items pi
      on pi.payroll_item_id = pil.payroll_item_id
    where pil.company_id = v_company_id
      and pil.code = 'OT'
    group by pil.payroll_item_id
  ),
  day_units as (
    select
      ad.company_id,
      ad.employee_id,
      case
        when ad.status = 'present' then coalesce(ad.day_fraction, 1.0)::numeric
        else 0::numeric
      end as present_unit,
      case
        when (ad.status = 'leave' or ad.source = 'leave')
          and coalesce(lt.is_paid, false) then 1.0::numeric
        else 0::numeric
      end as leave_paid_unit,
      case
        when (ad.status = 'leave' or ad.source = 'leave')
          and not coalesce(lt.is_paid, false) then 1.0::numeric
        else 0::numeric
      end as leave_unpaid_unit,
      case
        when ad.status = 'holiday' then 1.0::numeric
        else 0::numeric
      end as holiday_unit,
      case
        when ad.status = 'weekly_off' then 1.0::numeric
        else 0::numeric
      end as weekly_off_unit,
      case
        when ad.status = 'absent' then 1.0::numeric
        else 0::numeric
      end as absent_unit
    from public.erp_hr_attendance_days ad
    join payroll_run pr
      on pr.company_id = ad.company_id
    left join lateral (
      select lt.is_paid
        from public.erp_hr_leave_request_days lrd
        join public.erp_hr_leave_requests lr
          on lr.id = lrd.leave_request_id
         and lr.company_id = ad.company_id
         and lr.employee_id = ad.employee_id
        join public.erp_hr_leave_types lt
          on lt.id = lr.leave_type_id
         and lt.company_id = ad.company_id
       where lrd.company_id = ad.company_id
         and lrd.leave_date = ad.day
       limit 1
    ) lt on true
    where ad.company_id = v_company_id
      and ad.day between (select period_start from payroll_run) and (select period_end from payroll_run)
  ),
  attendance_summary as (
    select
      du.company_id,
      du.employee_id,
      sum(du.present_unit)::numeric as present_days,
      sum(du.absent_unit)::numeric as absent_days,
      (sum(du.leave_paid_unit) + sum(du.leave_unpaid_unit))::numeric as leave_days,
      (sum(du.present_unit) + sum(du.leave_paid_unit) + sum(du.holiday_unit) + sum(du.weekly_off_unit))::numeric as paid_days
    from day_units du
    group by du.company_id, du.employee_id
  )
  select
    pi.employee_id,
    e.employee_code,
    e.full_name as employee_name,
    coalesce(e.designation, hd.name, d.name) as designation_name,
    pr.period_start,
    pr.period_end,
    ((pr.period_end - pr.period_start) + 1)::int as calendar_days,
    coalesce(asum.present_days, 0)::numeric as present_days,
    coalesce(asum.absent_days, 0)::numeric as absent_days,
    coalesce(asum.leave_days, 0)::numeric as leave_days,
    coalesce(asum.paid_days, 0)::numeric as paid_days,
    coalesce(ot.manual_ot_hours, 0)::numeric as manual_ot_hours,
    pi.gross_pay,
    pi.net_pay
  from payroll_items pi
  join payroll_run pr
    on pr.company_id = v_company_id
  left join attendance_summary asum
    on asum.company_id = v_company_id
   and asum.employee_id = pi.employee_id
  left join ot_lines ot
    on ot.payroll_item_id = pi.payroll_item_id
  left join public.erp_employees e
    on e.company_id = v_company_id
   and e.id = pi.employee_id
  left join public.erp_hr_designations hd
    on hd.company_id = v_company_id
   and hd.id = e.designation_id
  left join public.erp_designations d
    on d.id = e.designation_id
  order by e.full_name;
end;
$$;

revoke all on function public.erp_report_attendance_payroll_summary(uuid) from public;
grant execute on function public.erp_report_attendance_payroll_summary(uuid) to authenticated;

create or replace function public.erp_report_attendance_exceptions(
  p_start date,
  p_end date,
  p_run_id uuid default null
) returns table (
  employee_id uuid,
  employee_code text,
  employee_name text,
  issue_key text,
  details text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_calendar_days int := ((p_end - p_start) + 1);
begin
  perform public.erp_require_hr_reader();

  return query
  with payroll_employees as (
    select
      pi.employee_id
    from public.erp_payroll_items pi
    where pi.company_id = v_company_id
      and pi.payroll_run_id = p_run_id
  ),
  attendance_employees as (
    select distinct
      ad.employee_id
    from public.erp_hr_attendance_days ad
    where ad.company_id = v_company_id
      and ad.day between p_start and p_end
  ),
  day_units as (
    select
      ad.employee_id,
      case
        when ad.status = 'present' then coalesce(ad.day_fraction, 1.0)::numeric
        else 0::numeric
      end as present_unit,
      case
        when (ad.status = 'leave' or ad.source = 'leave')
          and coalesce(lt.is_paid, false) then 1.0::numeric
        else 0::numeric
      end as leave_paid_unit,
      case
        when (ad.status = 'leave' or ad.source = 'leave')
          and not coalesce(lt.is_paid, false) then 1.0::numeric
        else 0::numeric
      end as leave_unpaid_unit
    from public.erp_hr_attendance_days ad
    left join lateral (
      select lt.is_paid
        from public.erp_hr_leave_request_days lrd
        join public.erp_hr_leave_requests lr
          on lr.id = lrd.leave_request_id
         and lr.company_id = ad.company_id
         and lr.employee_id = ad.employee_id
        join public.erp_hr_leave_types lt
          on lt.id = lr.leave_type_id
         and lt.company_id = ad.company_id
       where lrd.company_id = ad.company_id
         and lrd.leave_date = ad.day
       limit 1
    ) lt on true
    where ad.company_id = v_company_id
      and ad.day between p_start and p_end
  ),
  attendance_totals as (
    select
      du.employee_id,
      sum(du.present_unit)::numeric as present_days,
      (sum(du.leave_paid_unit) + sum(du.leave_unpaid_unit))::numeric as leave_days
    from day_units du
    group by du.employee_id
  ),
  inactive_employees as (
    select
      e.id as employee_id,
      e.employee_code,
      e.full_name as employee_name,
      e.status,
      e.lifecycle_status
    from public.erp_employees e
    join attendance_employees ae
      on ae.employee_id = e.id
    where e.company_id = v_company_id
      and (
        coalesce(lower(e.lifecycle_status), 'active') in ('inactive', 'terminated', 'exited', 'left', 'disabled')
        or coalesce(lower(e.status), 'active') in ('inactive', 'terminated', 'exited', 'left', 'disabled')
      )
  )
  select
    pe.employee_id,
    e.employee_code,
    e.full_name as employee_name,
    'payroll_missing_attendance'::text as issue_key,
    format('No attendance recorded between %s and %s for payroll run.', p_start, p_end) as details
  from payroll_employees pe
  join public.erp_employees e
    on e.company_id = v_company_id
   and e.id = pe.employee_id
  left join attendance_employees ae
    on ae.employee_id = pe.employee_id
  where p_run_id is not null
    and ae.employee_id is null

  union all

  select
    ae.employee_id,
    e.employee_code,
    e.full_name as employee_name,
    'attendance_missing_in_payroll'::text as issue_key,
    format('Attendance exists between %s and %s but employee is not in payroll run.', p_start, p_end) as details
  from attendance_employees ae
  join public.erp_employees e
    on e.company_id = v_company_id
   and e.id = ae.employee_id
  left join payroll_employees pe
    on pe.employee_id = ae.employee_id
  where p_run_id is not null
    and pe.employee_id is null

  union all

  select
    at.employee_id,
    e.employee_code,
    e.full_name as employee_name,
    'attendance_days_exceed_calendar'::text as issue_key,
    format('Present (%s) + leave (%s) exceeds calendar days (%s).', at.present_days, at.leave_days, v_calendar_days) as details
  from attendance_totals at
  join public.erp_employees e
    on e.company_id = v_company_id
   and e.id = at.employee_id
  where (at.present_days + at.leave_days) > v_calendar_days

  union all

  select
    ie.employee_id,
    ie.employee_code,
    ie.employee_name,
    'attendance_for_inactive_employee'::text as issue_key,
    format('Attendance exists for inactive employee (status=%s lifecycle=%s).', ie.status, ie.lifecycle_status) as details
  from inactive_employees ie
  order by employee_name, issue_key;
end;
$$;

revoke all on function public.erp_report_attendance_exceptions(date, date, uuid) from public;
grant execute on function public.erp_report_attendance_exceptions(date, date, uuid) to authenticated;

create or replace function public.erp_report_attendance_register(
  p_start date,
  p_end date
) returns table (
  work_date date,
  employee_id uuid,
  employee_code text,
  employee_name text,
  shift_name text,
  status text,
  remarks text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_hr_reader();

  return query
  select
    ad.day as work_date,
    ad.employee_id,
    e.employee_code,
    e.full_name as employee_name,
    coalesce(s.name, s.code) as shift_name,
    ad.status,
    ad.notes as remarks
  from public.erp_hr_attendance_days ad
  join public.erp_employees e
    on e.company_id = v_company_id
   and e.id = ad.employee_id
  left join public.erp_hr_shifts s
    on s.company_id = v_company_id
   and s.id = ad.shift_id
  where ad.company_id = v_company_id
    and ad.day between p_start and p_end
  order by ad.day, e.full_name;
end;
$$;

revoke all on function public.erp_report_attendance_register(date, date) from public;
grant execute on function public.erp_report_attendance_register(date, date) to authenticated;
