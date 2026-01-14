create or replace view public.erp_payroll_attendance_inputs_v
with (security_invoker = true) as
select
  ad.company_id,
  ad.employee_id,
  date_trunc('month', ad.day)::date as month,
  sum(case when ad.status = 'present' then 1 else 0 end)::numeric as present_days,
  sum(case when ad.status = 'leave' then 1 else 0 end)::numeric as leave_days,
  sum(case when ad.status = 'absent' then 1 else 0 end)::numeric as lop_days,
  (
    sum(case when ad.status = 'present' then 1 else 0 end)
    + sum(case when ad.status = 'leave' then 1 else 0 end)
    + sum(case when ad.status = 'holiday' then 1 else 0 end)
    + sum(case when ad.status = 'weekly_off' then 1 else 0 end)
  )::numeric as payable_days,
  sum(case when ad.status = 'unmarked' then 1 else 0 end)::numeric as unmarked_days,
  sum(case when ad.status = 'present' then coalesce(ad.work_minutes, 0) else 0 end)::int as total_work_minutes,
  sum(case when ad.status = 'present' then coalesce(ad.ot_minutes, 0) else 0 end)::int as total_ot_minutes,
  sum(case when ad.status = 'present' then coalesce(ad.late_minutes, 0) else 0 end)::int as total_late_minutes,
  sum(case when ad.status = 'present' then coalesce(ad.early_leave_minutes, 0) else 0 end)::int as total_early_leave_minutes,
  sum(case when ad.status = 'present' then coalesce(ad.day_fraction, 1.0) else 0 end) as present_day_equivalent,
  sum(case when ad.status = 'leave' then coalesce(ad.day_fraction, 1.0) else 0 end) as leave_day_equivalent
from public.erp_hr_attendance_days ad
group by
  ad.company_id,
  ad.employee_id,
  date_trunc('month', ad.day)::date;

comment on view public.erp_payroll_attendance_inputs_v is
  'Payroll inputs derived from attendance days, including payable totals and time metrics.';

comment on column public.erp_payroll_attendance_inputs_v.company_id is
  'Company for the attendance summary month.';

comment on column public.erp_payroll_attendance_inputs_v.employee_id is
  'Employee for the attendance summary month.';

comment on column public.erp_payroll_attendance_inputs_v.month is
  'Month (first day) for the attendance summary.';

comment on column public.erp_payroll_attendance_inputs_v.present_days is
  'Number of present days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.leave_days is
  'Number of leave days in the month (treated as paid for payroll inputs).';

comment on column public.erp_payroll_attendance_inputs_v.lop_days is
  'Number of loss-of-pay (absent) days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.payable_days is
  'Present + leave + holiday + weekly off days. Leave is paid for now; adjust when paid/unpaid leave types are available.';

comment on column public.erp_payroll_attendance_inputs_v.unmarked_days is
  'Number of unmarked days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.total_work_minutes is
  'Total work minutes for present days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.total_ot_minutes is
  'Total overtime minutes for present days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.total_late_minutes is
  'Total late minutes for present days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.total_early_leave_minutes is
  'Total early leave minutes for present days in the month.';

comment on column public.erp_payroll_attendance_inputs_v.present_day_equivalent is
  'Sum of day fractions for present days (defaults to 1 per present day).';

comment on column public.erp_payroll_attendance_inputs_v.leave_day_equivalent is
  'Sum of day fractions for leave days (defaults to 1 per leave day).';
