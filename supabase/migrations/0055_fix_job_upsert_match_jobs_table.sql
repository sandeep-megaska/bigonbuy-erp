-- Fix job upsert to match actual erp_employee_jobs columns (no employment_type, no exit_date)
-- Supports effective-dated history with same-day updates.

drop function if exists public.erp_hr_employee_job_upsert(
  uuid, uuid, uuid, uuid, text, uuid, text, date
);

-- Also drop any other prior overloads if Codex created them
drop function if exists public.erp_hr_employee_job_upsert(
  uuid, uuid, uuid, uuid, uuid, uuid, text, date, date
);

create function public.erp_hr_employee_job_upsert(
  p_employee_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_location_id uuid,
  p_manager_employee_id uuid,
  p_grade_id uuid default null,
  p_cost_center_id uuid default null,
  p_notes text default null,
  p_effective_from date default current_date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_prev_id uuid;
  v_prev_from date;
  v_new_id uuid;
  v_eff_from date := coalesce(p_effective_from, current_date);
begin
  perform public.erp_require_hr_writer();

  -- latest job row
  select id, effective_from
    into v_prev_id, v_prev_from
  from public.erp_employee_jobs
  where company_id = v_company_id
    and employee_id = p_employee_id
  order by effective_from desc
  limit 1;

  -- Same-day save => update latest row
  if v_prev_id is not null and v_prev_from = v_eff_from then
    update public.erp_employee_jobs
    set department_id = p_department_id,
        designation_id = p_designation_id,
        location_id = p_location_id,
        manager_employee_id = p_manager_employee_id,
        grade_id = p_grade_id,
        cost_center_id = p_cost_center_id,
        notes = p_notes,
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_prev_id;

    return v_prev_id;
  end if;

  -- Disallow back-dating
  if v_prev_from is not null and v_eff_from < v_prev_from then
    raise exception 'effective_from (%) must be on/after latest effective_from (%)', v_eff_from, v_prev_from;
  end if;

  -- Close previous open row (if any)
  if v_prev_id is not null then
    update public.erp_employee_jobs
    set effective_to = (v_eff_from - 1),
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_prev_id
      and effective_to is null;
  end if;

  -- Insert new current row (effective_to must be NULL)
  insert into public.erp_employee_jobs (
    company_id, employee_id,
    effective_from, effective_to,
    manager_employee_id, department_id, designation_id, grade_id, location_id, cost_center_id,
    notes,
    created_at, created_by, updated_at, updated_by
  ) values (
    v_company_id, p_employee_id,
    v_eff_from, null,
    p_manager_employee_id, p_department_id, p_designation_id, p_grade_id, p_location_id, p_cost_center_id,
    p_notes,
    now(), auth.uid(), now(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.erp_hr_employee_job_upsert(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date) from public;
grant execute on function public.erp_hr_employee_job_upsert(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date) to authenticated;
