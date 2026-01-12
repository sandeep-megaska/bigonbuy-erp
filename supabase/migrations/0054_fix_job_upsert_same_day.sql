-- Allow saving job multiple times on the same effective_from date by updating the latest row.
-- Only create a new history row when effective_from is later than the latest row.

create or replace function public.erp_hr_employee_job_upsert(
  p_employee_id uuid,
  p_department_id uuid,
  p_designation_id uuid,
  p_location_id uuid,
  p_employment_type text,
  p_manager_employee_id uuid,
  p_lifecycle_status text,
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

  -- If saving on the same effective_from date, just update the latest row (no new history row)
  if v_prev_id is not null and v_prev_from = v_eff_from then
    update public.erp_employee_jobs
    set department_id = p_department_id,
        designation_id = p_designation_id,
        location_id = p_location_id,
        employment_type = p_employment_type,
        manager_employee_id = p_manager_employee_id,
        lifecycle_status = p_lifecycle_status,
        updated_at = now(),
        updated_by = auth.uid()
    where id = v_prev_id;

    return v_prev_id;
  end if;

  -- Disallow back-dating (earlier than latest)
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

  -- Insert new current row
  insert into public.erp_employee_jobs (
    company_id, employee_id,
    department_id, designation_id, location_id,
    employment_type, manager_employee_id, lifecycle_status,
    effective_from, effective_to,
    created_at, created_by, updated_at, updated_by
  ) values (
    v_company_id, p_employee_id,
    p_department_id, p_designation_id, p_location_id,
    p_employment_type, p_manager_employee_id, p_lifecycle_status,
    v_eff_from, null,
    now(), auth.uid(), now(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.erp_hr_employee_job_upsert(uuid,uuid,uuid,uuid,text,uuid,text,date) from public;
grant execute on function public.erp_hr_employee_job_upsert(uuid,uuid,uuid,uuid,text,uuid,text,date) to authenticated;
