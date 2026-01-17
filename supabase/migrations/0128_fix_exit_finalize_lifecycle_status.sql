-- 0128_fix_exit_finalize_lifecycle_status.sql
-- Fix lifecycle_status update to comply with erp_employees_lifecycle_status_check

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
begin
  -- keep your existing permission guard (example)
  perform public.erp_require_hr_writer();

  insert into public.erp_hr_employee_exits (
    employee_id,
    last_working_day,
    exit_type_id,
    exit_reason_id,
    notes,
    status
  )
  values (
    p_employee_id,
    p_last_working_day,
    p_exit_type_id,
    p_exit_reason_id,
    p_notes,
    'completed'
  )
  returning id into v_exit_id;

  -- IMPORTANT: set ONLY allowed lifecycle_status
  update public.erp_employees
  set lifecycle_status = 'inactive'
  where id = p_employee_id;

  return v_exit_id;
end;
$$;
