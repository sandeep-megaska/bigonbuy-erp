-- 0130_drop_duplicate_exit_finalize_overload.sql
-- Remove duplicate overload to avoid ambiguous RPC resolution

drop function if exists public.erp_hr_employee_exit_finalize(
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid,
  p_last_working_day date,
  p_notes text
);
