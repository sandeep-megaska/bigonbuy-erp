-- HR designations policies + RPCs + employee job upsert

-- RLS: allow any company member to read designations, restrict writes to owner/admin/hr
alter table public.erp_hr_designations enable row level security;
alter table public.erp_hr_designations force row level security;

do $$
begin
  drop policy if exists erp_hr_designations_select on public.erp_hr_designations;
  drop policy if exists erp_hr_designations_write on public.erp_hr_designations;

  create policy erp_hr_designations_select
    on public.erp_hr_designations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_hr_designations_write
    on public.erp_hr_designations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr')
        )
      )
    );
end
$$;

create or replace function public.erp_hr_designations_list(
  p_include_inactive boolean default false
) returns table (
  id uuid,
  code text,
  name text,
  description text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select d.id,
         d.code,
         d.name,
         d.description,
         d.is_active,
         d.created_at,
         d.updated_at
    from public.erp_hr_designations d
   where d.company_id = public.erp_current_company_id()
     and (p_include_inactive or d.is_active)
   order by d.name;
$$;

revoke all on function public.erp_hr_designations_list(boolean) from public;
grant execute on function public.erp_hr_designations_list(boolean) to authenticated;

create or replace function public.erp_hr_designation_upsert(
  p_id uuid default null,
  p_code text default null,
  p_name text,
  p_description text default null,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_code text := nullif(upper(trim(p_code)), '');
  v_name text := nullif(trim(p_name), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if v_name is null then
    raise exception 'Designation name is required.';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Only owner/admin/hr can manage designations.';
  end if;

  if v_code is not null then
    perform 1
      from public.erp_hr_designations d
     where d.company_id = v_company_id
       and d.code = v_code
       and (p_id is null or d.id <> p_id);

    if found then
      raise exception 'Designation code already exists.';
    end if;
  end if;

  if p_id is not null then
    update public.erp_hr_designations
       set code = v_code,
           name = v_name,
           description = v_description,
           is_active = coalesce(p_is_active, true),
           updated_at = now(),
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
     returning id into v_id;

    if v_id is null then
      raise exception 'Designation not found.';
    end if;
  else
    insert into public.erp_hr_designations (
      company_id,
      code,
      name,
      description,
      is_active,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_company_id,
      v_code,
      v_name,
      v_description,
      coalesce(p_is_active, true),
      now(),
      v_actor,
      now(),
      v_actor
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_hr_designation_upsert(uuid,text,text,text,boolean) from public;
grant execute on function public.erp_hr_designation_upsert(uuid,text,text,text,boolean) to authenticated;

create or replace function public.erp_hr_designation_delete(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
begin
  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Only owner/admin/hr can delete designations.';
  end if;

  if exists (
    select 1
      from public.erp_employee_jobs j
     where j.company_id = v_company_id
       and j.designation_id = p_id
  ) then
    raise exception 'Designation is linked to employee jobs and cannot be deleted.';
  end if;

  delete from public.erp_hr_designations
   where id = p_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_designation_delete(uuid) from public;
grant execute on function public.erp_hr_designation_delete(uuid) to authenticated;

create or replace function public.erp_employee_job_upsert(
  p_employee_id uuid,
  p_effective_from date,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_manager_employee_id uuid default null,
  p_location_id uuid default null,
  p_grade_id uuid default null,
  p_cost_center_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_eff_from date := coalesce(p_effective_from, current_date);
  v_current_id uuid;
  v_current_from date;
  v_new_id uuid;
begin
  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Only owner/admin/hr can update employee job history.';
  end if;

  perform 1
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;
  if not found then
    raise exception 'Invalid employee.';
  end if;

  if p_department_id is not null then
    perform 1
      from public.erp_hr_departments d
     where d.id = p_department_id
       and d.company_id = v_company_id
       and d.is_active;
    if not found then
      raise exception 'Invalid or inactive department.';
    end if;
  end if;

  if p_designation_id is not null then
    perform 1
      from public.erp_hr_designations d
     where d.id = p_designation_id
       and d.company_id = v_company_id
       and d.is_active;
    if not found then
      raise exception 'Invalid or inactive designation.';
    end if;
  end if;

  if p_location_id is not null then
    perform 1
      from public.erp_hr_locations l
     where l.id = p_location_id
       and l.company_id = v_company_id
       and l.is_active;
    if not found then
      raise exception 'Invalid or inactive location.';
    end if;
  end if;

  if p_grade_id is not null then
    perform 1
      from public.erp_hr_grades g
     where g.id = p_grade_id
       and g.company_id = v_company_id
       and g.is_active;
    if not found then
      raise exception 'Invalid or inactive grade.';
    end if;
  end if;

  if p_cost_center_id is not null then
    perform 1
      from public.erp_hr_cost_centers c
     where c.id = p_cost_center_id
       and c.company_id = v_company_id
       and c.is_active;
    if not found then
      raise exception 'Invalid or inactive cost center.';
    end if;
  end if;

  if p_manager_employee_id is not null then
    perform 1
      from public.erp_employees e
     where e.id = p_manager_employee_id
       and e.company_id = v_company_id;
    if not found then
      raise exception 'Invalid manager.';
    end if;
  end if;

  select j.id, j.effective_from
    into v_current_id, v_current_from
    from public.erp_employee_jobs j
   where j.company_id = v_company_id
     and j.employee_id = p_employee_id
     and j.effective_to is null
   order by j.effective_from desc
   limit 1;

  if v_current_id is not null then
    if v_eff_from <= v_current_from then
      raise exception 'Effective from must be after current job effective date (%).', v_current_from;
    end if;

    update public.erp_employee_jobs
       set effective_to = (v_eff_from - 1),
           updated_at = now(),
           updated_by = v_actor
     where id = v_current_id
       and effective_to is null;
  end if;

  insert into public.erp_employee_jobs (
    company_id,
    employee_id,
    effective_from,
    effective_to,
    manager_employee_id,
    department_id,
    designation_id,
    grade_id,
    location_id,
    cost_center_id,
    notes,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    v_eff_from,
    null,
    p_manager_employee_id,
    p_department_id,
    p_designation_id,
    p_grade_id,
    p_location_id,
    p_cost_center_id,
    p_notes,
    now(),
    v_actor,
    now(),
    v_actor
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.erp_employee_job_upsert(uuid,date,uuid,uuid,uuid,uuid,uuid,uuid,text) from public;
grant execute on function public.erp_employee_job_upsert(uuid,date,uuid,uuid,uuid,uuid,uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';
