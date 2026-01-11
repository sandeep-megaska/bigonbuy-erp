-- 0026_fix_hr_upsert_defaults.sql
-- Fix Postgres default-parameter ordering for HR upsert functions (valid signatures)

-- Department upsert
create or replace function public.erp_hr_department_upsert(
  p_name text,
  p_id uuid default null,
  p_code text default null,
  p_is_active boolean default true
) returns public.erp_hr_departments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_hr_departments;
begin
  if not public.is_erp_manager() and not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  if p_id is null then
    insert into public.erp_hr_departments (company_id, name, code, is_active, created_by, updated_by)
    values (v_company_id, p_name, p_code, coalesce(p_is_active,true), v_actor, v_actor)
    returning * into v_row;
  else
    update public.erp_hr_departments
       set name = p_name,
           code = p_code,
           is_active = coalesce(p_is_active,true),
           updated_at = now(),
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
    returning * into v_row;

    if not found then raise exception 'Department not found'; end if;
  end if;

  return v_row;
end;
$$;

-- Job title upsert
create or replace function public.erp_hr_job_title_upsert(
  p_title text,
  p_id uuid default null,
  p_level int default null,
  p_is_active boolean default true
) returns public.erp_hr_job_titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_hr_job_titles;
begin
  if not public.is_erp_manager() and not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  if p_id is null then
    insert into public.erp_hr_job_titles (company_id, title, level, is_active, created_by, updated_by)
    values (v_company_id, p_title, p_level, coalesce(p_is_active,true), v_actor, v_actor)
    returning * into v_row;
  else
    update public.erp_hr_job_titles
       set title = p_title,
           level = p_level,
           is_active = coalesce(p_is_active,true),
           updated_at = now(),
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
    returning * into v_row;

    if not found then raise exception 'Job title not found'; end if;
  end if;

  return v_row;
end;
$$;

-- Location upsert
create or replace function public.erp_hr_location_upsert(
  p_name text,
  p_id uuid default null,
  p_country text default null,
  p_state text default null,
  p_city text default null,
  p_is_active boolean default true
) returns public.erp_hr_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_hr_locations;
begin
  if not public.is_erp_manager() and not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  if p_id is null then
    insert into public.erp_hr_locations (company_id, name, country, state, city, is_active, created_by, updated_by)
    values (v_company_id, p_name, p_country, p_state, p_city, coalesce(p_is_active,true), v_actor, v_actor)
    returning * into v_row;
  else
    update public.erp_hr_locations
       set name = p_name,
           country = p_country,
           state = p_state,
           city = p_city,
           is_active = coalesce(p_is_active,true),
           updated_at = now(),
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
    returning * into v_row;

    if not found then raise exception 'Location not found'; end if;
  end if;

  return v_row;
end;
$$;

-- Employment type upsert
create or replace function public.erp_hr_employment_type_upsert(
  p_key text,
  p_name text,
  p_id uuid default null,
  p_is_active boolean default true
) returns public.erp_hr_employment_types
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_hr_employment_types;
begin
  if not public.is_erp_manager() and not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  if p_id is null then
    insert into public.erp_hr_employment_types (company_id, key, name, is_active, created_by, updated_by)
    values (v_company_id, p_key, p_name, coalesce(p_is_active,true), v_actor, v_actor)
    returning * into v_row;
  else
    update public.erp_hr_employment_types
       set key = p_key,
           name = p_name,
           is_active = coalesce(p_is_active,true),
           updated_at = now(),
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
    returning * into v_row;

    if not found then raise exception 'Employment type not found'; end if;
  end if;

  return v_row;
end;
$$;
