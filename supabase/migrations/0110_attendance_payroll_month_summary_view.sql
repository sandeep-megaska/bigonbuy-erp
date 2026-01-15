create or replace view public.erp_attendance_payroll_month_summary_v
with (security_invoker = true) as
with day_units as (
  select
    ad.company_id,
    ad.employee_id,
    date_trunc('month', ad.day)::date as month,
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
    end as absent_unit,
    case
      when ad.status = 'unmarked' then 1.0::numeric
      else 0::numeric
    end as unmarked_unit
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
)
select
  du.company_id,
  du.employee_id,
  du.month,
  sum(du.present_unit)::numeric(6,2) as present_days,
  sum(du.leave_paid_unit)::numeric(6,2) as leave_paid_days,
  sum(du.leave_unpaid_unit)::numeric(6,2) as leave_unpaid_days,
  sum(du.holiday_unit)::numeric(6,2) as holiday_days,
  sum(du.weekly_off_unit)::numeric(6,2) as weekly_off_days,
  sum(du.absent_unit)::numeric(6,2) as absent_days,
  sum(du.unmarked_unit)::numeric(6,2) as unmarked_days,
  (sum(du.absent_unit) + sum(du.leave_unpaid_unit))::numeric(6,2) as lop_days,
  (
    sum(du.present_unit)
    + sum(du.leave_paid_unit)
    + sum(du.holiday_unit)
    + sum(du.weekly_off_unit)
  )::numeric(6,2) as payable_days,
  p.status as period_status,
  p.frozen_at as period_frozen_at
from day_units du
left join public.erp_hr_attendance_periods p
  on p.company_id = du.company_id
 and p.month = du.month
group by
  du.company_id,
  du.employee_id,
  du.month,
  p.status,
  p.frozen_at;

comment on view public.erp_attendance_payroll_month_summary_v is
  'Monthly attendance summary for payroll proration without automatic overtime enforcement.';

comment on column public.erp_attendance_payroll_month_summary_v.company_id is
  'Company for the attendance payroll summary month.';

comment on column public.erp_attendance_payroll_month_summary_v.employee_id is
  'Employee for the attendance payroll summary month.';

comment on column public.erp_attendance_payroll_month_summary_v.month is
  'Month (first day) for the attendance payroll summary.';

comment on column public.erp_attendance_payroll_month_summary_v.present_days is
  'Sum of present day fractions for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.leave_paid_days is
  'Count of paid leave days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.leave_unpaid_days is
  'Count of unpaid leave days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.holiday_days is
  'Count of holiday days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.weekly_off_days is
  'Count of weekly off days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.absent_days is
  'Count of absent days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.unmarked_days is
  'Count of unmarked days for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.lop_days is
  'Loss-of-pay day equivalents (absent + unpaid leave).';

comment on column public.erp_attendance_payroll_month_summary_v.payable_days is
  'Present + paid leave + holiday + weekly off days for payroll proration.';

comment on column public.erp_attendance_payroll_month_summary_v.period_status is
  'Attendance period status for the month.';

comment on column public.erp_attendance_payroll_month_summary_v.period_frozen_at is
  'Timestamp when the attendance period was frozen.';
