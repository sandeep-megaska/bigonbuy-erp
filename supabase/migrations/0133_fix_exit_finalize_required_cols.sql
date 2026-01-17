-- 0133_fix_exit_finalize_required_cols.sql
-- Ensure all NOT NULL fields in erp_hr_employee_exits are populated

create or replace function public.erp_hr_employee_exit_finalize(
  p_employee_id uuid,
  p_last_working_day date,
  p_exit_type_id uuid,
  p_exit_reason_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exit_id uuid;
  v_company_id uuid := public.erp_current_company_id();
  v_user_id uuid := auth.uid();
begin
  perform public.erp_require_hr_writer();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_waived,
    exit_reason_id,
    notes
  )
  values (
    v_company_id,
    p_employee_id,
    p_exit_type_id,
    v_user_id,
    'completed',
    now(),
    p_last_working_day,
    true,
    p_exit_reason_id,
    p_notes
  )
  returning id into v_exit_id;

  update public.erp_employees
  set lifecycle_status = 'exited',
      exit_date = p_last_working_day
  where id = p_employee_id;

  return v_exit_id;
end;
$$;
