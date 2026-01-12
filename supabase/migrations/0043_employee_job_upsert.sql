-- Effective-dated employee job upsert RPC
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
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_effective_from date := coalesce(p_effective_from, current_date);
  v_current_job_id uuid;
  v_employment_type_id uuid;
  v_status text := coalesce(nullif(trim(coalesce(p_lifecycle_status, '')), ''), 'preboarding');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if v_status not in ('preboarding', 'active', 'on_notice', 'exited') then
    raise exception 'Invalid lifecycle_status. Allowed: preboarding, active, on_notice, exited';
  end if;

  perform 1
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;

  if not found then
    raise exception 'Employee not found for this company';
  end if;

  if p_department_id is not null then
    perform 1 from public.erp_hr_departments d
     where d.id = p_department_id
       and d.company_id = v_company_id
       and coalesce(d.is_active, true);
    if not found then
      raise exception 'Invalid department_id';
    end if;
  end if;

  if p_designation_id is not null then
    perform 1 from public.erp_hr_designations d
     where d.id = p_designation_id
       and d.company_id = v_company_id
       and coalesce(d.is_active, true);
    if not found then
      raise exception 'Invalid designation_id';
    end if;
  end if;

  if p_location_id is not null then
    perform 1 from public.erp_hr_locations l
     where l.id = p_location_id
       and l.company_id = v_company_id
       and coalesce(l.is_active, true);
    if not found then
      raise exception 'Invalid location_id';
    end if;
  end if;

  if p_manager_employee_id is not null then
    if p_manager_employee_id = p_employee_id then
      raise exception 'manager_employee_id cannot reference the same employee';
    end if;

    perform 1
      from public.erp_employees m
     where m.id = p_manager_employee_id
       and m.company_id = v_company_id;

    if not found then
      raise exception 'Invalid manager_employee_id';
    end if;
  end if;

  if p_employment_type is not null and nullif(trim(p_employment_type), '') is not null then
    select et.id
      into v_employment_type_id
      from public.erp_hr_employment_types et
     where et.company_id = v_company_id
       and (et.key = p_employment_type or lower(et.name) = lower(p_employment_type))
     order by et.updated_at desc
     limit 1;

    if v_employment_type_id is null then
      raise exception 'Invalid employment_type';
    end if;
  end if;

  select j.id
    into v_current_job_id
    from public.erp_employee_jobs j
   where j.company_id = v_company_id
     and j.employee_id = p_employee_id
     and j.effective_to is null
   order by j.effective_from desc, j.created_at desc
   limit 1;

  if v_current_job_id is not null then
    update public.erp_employee_jobs
       set effective_to = (v_effective_from - interval '1 day')::date,
           updated_at = now(),
           updated_by = v_actor
     where id = v_current_job_id;
  end if;

  insert into public.erp_employee_jobs (
    company_id,
    employee_id,
    effective_from,
    effective_to,
    manager_employee_id,
    department_id,
    designation_id,
    location_id,
    created_by,
    updated_by
  )
  values (
    v_company_id,
    p_employee_id,
    v_effective_from,
    null,
    p_manager_employee_id,
    p_department_id,
    p_designation_id,
    p_location_id,
    v_actor,
    v_actor
  )
  returning id into v_current_job_id;

  update public.erp_employees
     set department_id = p_department_id,
         location_id = p_location_id,
         manager_employee_id = p_manager_employee_id,
         employment_type_id = v_employment_type_id,
         lifecycle_status = v_status,
         updated_at = now(),
         updated_by = v_actor
   where id = p_employee_id
     and company_id = v_company_id;

  return v_current_job_id;
end;
$$;

revoke all on function public.erp_hr_employee_job_upsert(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  date
) from public;
grant execute on function public.erp_hr_employee_job_upsert(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  date
) to authenticated;

notify pgrst, 'reload schema';
