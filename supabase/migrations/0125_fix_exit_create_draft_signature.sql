-- 0125_fix_exit_create_draft_signature.sql
-- Repair: cannot remove parameter defaults from existing function via CREATE OR REPLACE.
-- Solution: DROP the existing function (with either known signature) and CREATE it again.

-- Drop any prior variants (parameter order changed across iterations)
drop function if exists public.erp_hr_exit_create_draft(
  uuid, uuid, uuid, date, integer, boolean, text, date, uuid
);

drop function if exists public.erp_hr_exit_create_draft(
  uuid, uuid, date, uuid, integer, boolean, text, date, uuid
);

-- Recreate with corrected signature (required args first; no signature-default issues)
create function public.erp_hr_exit_create_draft(
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_last_working_day date,
  p_exit_reason_id uuid,
  p_notice_period_days integer,
  p_notice_waived boolean,
  p_notes text,
  p_initiated_on date,
  p_manager_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_exit_id uuid;

  -- Defaults handled inside body (safer than signature defaults)
  v_initiated_on date := coalesce(p_initiated_on, current_date);
  v_notice_waived boolean := coalesce(p_notice_waived, false);
  v_notice_period_days integer := p_notice_period_days;
begin
  -- Enforce permission using your existing guard
  perform public.erp_require_hr_writer();

  -- Prevent multiple active exits (draft/approved)
  if exists (
    select 1
    from public.erp_hr_employee_exits e
    where e.company_id = v_company_id
      and e.employee_id = p_employee_id
      and e.status in ('draft','approved')
  ) then
    raise exception 'An active exit already exists for this employee.';
  end if;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_period_days,
    notice_waived,
    notes,
    manager_employee_id
  )
  values (
    v_company_id,
    p_employee_id,
    p_exit_type_id,
    p_exit_reason_id,
    auth.uid(),
    'draft',
    v_initiated_on,
    p_last_working_day,
    v_notice_period_days,
    v_notice_waived,
    p_notes,
    p_manager_employee_id
  )
  returning id into v_exit_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_hr_exit_create_draft(
  uuid, uuid, date, uuid, integer, boolean, text, date, uuid
) from public;

grant execute on function public.erp_hr_exit_create_draft(
  uuid, uuid, date, uuid, integer, boolean, text, date, uuid
) to authenticated;
