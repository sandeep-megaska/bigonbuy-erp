create or replace view public.erp_payroll_attendance_inputs_v
with (security_invoker = true) as
select
  summary.company_id,
  summary.employee_id,
  summary.month,
  summary.present_days,
  summary.leave_days,
  summary.lop_days,
  (
    summary.present_days
    + summary.leave_days
    + summary.holiday_days
    + summary.weekly_off_days
  )::numeric as payable_days,
  summary.unmarked_days
from public.erp_hr_attendance_monthly_summary_v as summary;

comment on view public.erp_payroll_attendance_inputs_v is
  'Payroll inputs derived from attendance monthly summary. Leave days are treated as paid until leave types are integrated.';

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
