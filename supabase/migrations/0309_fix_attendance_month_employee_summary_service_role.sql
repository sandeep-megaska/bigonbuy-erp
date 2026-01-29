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
  v_month_normalized date;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  v_month_normalized := date_trunc('month', p_month)::date;

  return query
  with employees as (
    select e.id
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
      and s.month = v_month_normalized
  ),
  ot_summary as (
    select
      ad.employee_id,
      sum(case when ad.status = 'present' then coalesce(ad.ot_minutes, 0) else 0 end)::int as ot_minutes
    from public.erp_hr_attendance_days ad
    where ad.company_id = v_company_id
      and ad.day >= v_month_normalized
      and ad.day < (v_month_normalized + interval '1 month')
    group by ad.employee_id
  )
  select
    e.id as employee_id,
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
      when ovr.use_override = true
        then coalesce(ovr.present_days_override, coalesce(c.present_days, 0))
      else coalesce(c.present_days, 0)
    end as present_days_effective,
    case
      when ovr.use_override = true
        then coalesce(ovr.absent_days_override, coalesce(c.absent_days, 0))
      else coalesce(c.absent_days, 0)
    end as absent_days_effective,
    case
      when ovr.use_override = true
        then coalesce(ovr.paid_leave_days_override, coalesce(c.paid_leave_days, 0))
      else coalesce(c.paid_leave_days, 0)
    end as paid_leave_days_effective,
    case
      when ovr.use_override = true
        then coalesce(ovr.ot_minutes_override, coalesce(o.ot_minutes, 0))
      else coalesce(o.ot_minutes, 0)
    end as ot_minutes_effective,
    ovr.notes as override_notes
  from employees e
  left join computed c
    on c.employee_id = e.id
  left join ot_summary o
    on o.employee_id = e.id
  left join public.erp_attendance_month_overrides ovr
    on ovr.company_id = v_company_id
   and ovr.month = v_month_normalized
   and ovr.employee_id = e.id
  order by e.id;
end;
$$;

revoke all on function public.erp_attendance_month_employee_summary(date, uuid[]) from public;
grant execute on function public.erp_attendance_month_employee_summary(date, uuid[]) to authenticated;
