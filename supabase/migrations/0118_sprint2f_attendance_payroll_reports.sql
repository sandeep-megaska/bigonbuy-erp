begin;

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

create or replace view public.erp_attendance_payroll_reconciliation_v
with (security_invoker = true) as
select
  i.company_id,
  i.payroll_run_id,
  make_date(r.year, r.month, 1) as month,
  i.employee_id,
  e.employee_code,
  e.full_name as employee_name,
  a.present_days,
  a.leave_paid_days,
  a.leave_unpaid_days,
  a.holiday_days,
  a.weekly_off_days,
  a.absent_days,
  a.unmarked_days,
  a.payable_days as payable_days_suggested,
  a.lop_days as lop_days_suggested,
  a.period_status as attendance_period_status,
  coalesce(i.payable_days_override, i.payable_days_suggested) as payable_days_effective,
  coalesce(i.lop_days_override, i.lop_days_suggested) as lop_days_effective,
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
  (a.period_status <> 'frozen') as attendance_unfrozen_warning
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
