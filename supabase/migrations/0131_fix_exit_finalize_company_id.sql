-- 0131_fix_exit_finalize_company_id.sql
-- Ensure company_id is populated on erp_hr_employee_exits insert

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
begin
  perform public.erp_require_hr_writer();

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    last_working_day,
    exit_type_id,
    exit_reason_id,
    notes,
    status
  )
  values (
    v_company_id,
    p_employee_id,
    p_last_working_day,
    p_exit_type_id,
    p_exit_reason_id,
    p_notes,
    'completed'
  )
  returning id into v_exit_id;

  update public.erp_employees
  set lifecycle_status = 'exited',
      exit_date = p_last_working_day
  where id = p_employee_id;

  return v_exit_id;
end;
$$;
