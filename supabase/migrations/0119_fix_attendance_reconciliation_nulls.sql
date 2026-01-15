begin;

create or replace view public.erp_attendance_payroll_reconciliation_v
with (security_invoker = true) as
select
  i.company_id,
  i.payroll_run_id,
  make_date(r.year, r.month, 1) as month,
  i.employee_id,
  e.employee_code,
  e.full_name as employee_name,
  coalesce(a.present_days, 0) as present_days,
  coalesce(a.leave_paid_days, 0) as leave_paid_days,
  coalesce(a.leave_unpaid_days, 0) as leave_unpaid_days,
  coalesce(a.holiday_days, 0) as holiday_days,
  coalesce(a.weekly_off_days, 0) as weekly_off_days,
  coalesce(a.absent_days, 0) as absent_days,
  coalesce(a.unmarked_days, 0) as unmarked_days,
  coalesce(a.payable_days, 0) as payable_days_suggested,
  coalesce(a.lop_days, 0) as lop_days_suggested,
  coalesce(a.period_status, 'missing') as attendance_period_status,
  coalesce(i.payable_days_override, i.payable_days_suggested, a.payable_days, 0)
    as payable_days_effective,
  coalesce(i.lop_days_override, i.lop_days_suggested, a.lop_days, 0)
    as lop_days_effective,
  i.gross as gross_pay,
  i.deductions,
  i.net_pay,
  (r.status = 'finalized') as payroll_finalized,
  (ps.id is not null) as payslip_generated,
  (i.attendance_source is not null) as attendance_synced,
  (
    i.payable_days_override is not null
    or i.lop_days_override is not null
  ) as attendance_overridden,
  coalesce(a.period_status <> 'frozen', false) as attendance_unfrozen_warning
from public.erp_payroll_items i
left join public.erp_payroll_runs r
  on r.company_id = i.company_id
 and r.id = i.payroll_run_id
left join public.erp_employees e
  on e.company_id = i.company_id
 and e.id = i.employee_id
left join public.erp_attendance_payroll_month_summary_v a
  on a.company_id = i.company_id
 and a.employee_id = i.employee_id
 and a.month = make_date(r.year, r.month, 1)
left join public.erp_payroll_payslips ps
  on ps.company_id = i.company_id
 and ps.payroll_run_id = i.payroll_run_id
 and ps.payroll_item_id = i.id;

revoke all on public.erp_attendance_payroll_reconciliation_v from public;
grant select on public.erp_attendance_payroll_reconciliation_v to authenticated;

create or replace view public.erp_attendance_month_print_v
with (security_invoker = true) as
select
  summary.employee_code,
  summary.employee_name,
  summary.month,
  summary.present_days,
  summary.leave_paid_days,
  summary.leave_unpaid_days,
  summary.holiday_days,
  summary.weekly_off_days,
  summary.absent_days,
  summary.payable_days_effective,
  summary.lop_days_effective,
  summary.attendance_period_status,
  summary.payroll_finalized
from (
  select
    *,
    row_number() over (
      partition by company_id, employee_id, month
      order by payroll_finalized desc, payroll_run_id desc
    ) as row_rank
  from public.erp_attendance_payroll_reconciliation_v
) summary
where summary.row_rank = 1;

revoke all on public.erp_attendance_month_print_v from public;
grant select on public.erp_attendance_month_print_v to authenticated;

commit;
