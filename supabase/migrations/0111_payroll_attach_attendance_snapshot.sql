-- Sprint-2F: attach attendance snapshot to payroll runs/items

alter table public.erp_payroll_runs
  add column if not exists attendance_month date null,
  add column if not exists attendance_period_status text null,
  add column if not exists attendance_snapshot_at timestamptz null,
  add column if not exists attendance_snapshot_by uuid null;

alter table public.erp_payroll_items
  add column if not exists payable_days_suggested numeric(6, 2) null,
  add column if not exists lop_days_suggested numeric(6, 2) null,
  add column if not exists present_days_suggested numeric(6, 2) null,
  add column if not exists paid_leave_days_suggested numeric(6, 2) null,
  add column if not exists unpaid_leave_days_suggested numeric(6, 2) null,
  add column if not exists attendance_source text null,
  add column if not exists payable_days_override numeric(6, 2) null,
  add column if not exists lop_days_override numeric(6, 2) null;

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

  update public.erp_payroll_items pi
     set payable_days_suggested = s.payable_days,
         lop_days_suggested = s.lop_days,
         present_days_suggested = s.present_days,
         paid_leave_days_suggested = s.paid_leave_days,
         unpaid_leave_days_suggested = s.unpaid_leave_days,
         attendance_source = 'attendance_v1'
    from public.erp_attendance_payroll_month_summary_v s
   where pi.company_id = v_company_id
     and pi.payroll_run_id = p_run_id
     and s.company_id = v_company_id
     and s.employee_id = pi.employee_id
     and s.month = v_month_start;

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
