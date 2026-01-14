-- 0091_fix_hr_designations_and_job_rpc_signature.sql
-- Fix Postgres default-parameter ordering error from 0090 by recreating RPC signatures

begin;

-- 1) Fix designation upsert signature (make all params after first default also defaulted)
drop function if exists public.erp_hr_designation_upsert(uuid, text, text, text, boolean);

create or replace function public.erp_hr_designation_upsert(
  p_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_description text default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_code text;
begin
  if v_actor is null then raise exception 'Not authenticated'; end if;
  perform public.erp_require_hr_writer();

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  v_code := nullif(upper(trim(coalesce(p_code, ''))), '');
  -- If you require code, enforce it here; otherwise allow null.

  insert into public.erp_hr_designations (
    id, company_id, code, name, description, is_active,
    created_at, created_by, updated_at, updated_by
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    v_company_id,
    v_code,
    trim(p_name),
    p_description,
    coalesce(p_is_active, true),
    now(), v_actor, now(), v_actor
  )
  on conflict (id) do update set
    code = excluded.code,
    name = excluded.name,
    description = excluded.description,
    is_active = excluded.is_active,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_hr_designation_upsert(uuid, text, text, text, boolean) from public;
grant execute on function public.erp_hr_designation_upsert(uuid, text, text, text, boolean) to authenticated;


-- 2) Fix employee job upsert signature (common bug: effective_from placed after defaulted params)
-- Make p_effective_from defaulted, but validate inside (or default to current_date).
drop function if exists public.erp_employee_job_upsert(
  uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, text
);

create or replace function public.erp_employee_job_upsert(
  p_employee_id uuid,
  p_effective_from date default current_date,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_manager_employee_id uuid default null,
  p_location_id uuid default null,
  p_grade_id uuid default null,
  p_cost_center_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_prev_id uuid;
  v_prev_from date;
  v_new_id uuid;
begin
  if v_actor is null then raise exception 'Not authenticated'; end if;
  perform public.erp_require_hr_writer();

  if p_employee_id is null then raise exception 'employee_id is required'; end if;
  if p_effective_from is null then raise exception 'effective_from is required'; end if;

  -- close current row if exists, guard against backdating
  select id, effective_from
    into v_prev_id, v_prev_from
  from public.erp_employee_jobs
  where company_id = v_company_id
    and employee_id = p_employee_id
    and effective_to is null
  order by effective_from desc
  limit 1;

  if v_prev_id is not null and p_effective_from <= v_prev_from then
    raise exception 'Invalid effective_from %. Must be after current effective_from %.',
      p_effective_from, v_prev_from;
  end if;

  if v_prev_id is not null then
    update public.erp_employee_jobs
      set effective_to = (p_effective_from - 1),
          updated_at = now(),
          updated_by = v_actor
    where company_id = v_company_id
      and id = v_prev_id;
  end if;

  insert into public.erp_employee_jobs(
    company_id, employee_id,
    effective_from, effective_to,
    manager_employee_id,
    department_id, designation_id, grade_id, location_id, cost_center_id,
    notes,
    created_at, created_by, updated_at, updated_by
  )
  values (
    v_company_id, p_employee_id,
    p_effective_from, null,
    p_manager_employee_id,
    p_department_id, p_designation_id, p_grade_id, p_location_id, p_cost_center_id,
    p_notes,
    now(), v_actor, now(), v_actor
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.erp_employee_job_upsert(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.erp_employee_job_upsert(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- refresh PostgREST schema cache
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then null;
end $$;

commit;
