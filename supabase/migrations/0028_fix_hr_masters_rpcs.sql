-- 0028_fix_hr_masters_rpcs.sql
-- Ensure HR master RPCs are no-arg list functions and valid upserts

-- Drop legacy signatures to avoid PostgREST ambiguity

drop function if exists public.erp_hr_department_upsert(uuid, text, text, boolean);
drop function if exists public.erp_hr_department_upsert(text, uuid, text, boolean);

drop function if exists public.erp_hr_job_title_upsert(uuid, text, int, boolean);
drop function if exists public.erp_hr_job_title_upsert(text, uuid, int, boolean);

drop function if exists public.erp_hr_location_upsert(uuid, text, text, text, text, boolean);
drop function if exists public.erp_hr_location_upsert(text, uuid, text, text, text, boolean);

drop function if exists public.erp_hr_employment_type_upsert(uuid, text, text, boolean);
drop function if exists public.erp_hr_employment_type_upsert(text, text, uuid, boolean);

-- Department upsert
create or replace function public.erp_hr_department_upsert(
  p_name text,
  p_code text default null,
  p_is_active boolean default true,
  p_id uuid default null
) returns public.erp_hr_departments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing public.erp_hr_departments;
  v_row public.erp_hr_departments;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  if auth.role() <> 'service_role' then
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    if not public.erp_is_hr_admin(v_actor) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  if v_name is null then
    raise exception 'Department name is required';
  end if;

  if p_id is not null then
    select *
      into v_existing
      from public.erp_hr_departments
     where id = p_id
       and company_id = v_company_id;

    if not found then
      raise exception 'Department not found for this company';
    end if;
  end if;

  insert into public.erp_hr_departments (
    id,
    company_id,
    name,
    code,
    is_active,
    created_by,
    updated_by
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    v_company_id,
    v_name,
    v_code,
    coalesce(p_is_active, true),
    v_actor,
    v_actor
  )
  on conflict (id) do update
    set name = excluded.name,
        code = excluded.code,
        is_active = excluded.is_active,
        updated_at = now(),
        updated_by = v_actor
  returning * into v_row;

  perform public.erp_log_hr_audit(
    'department',
    v_row.id,
    'upsert',
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_department_upsert(text, text, boolean, uuid) from public;
grant execute on function public.erp_hr_department_upsert(text, text, boolean, uuid) to authenticated;
grant execute on function public.erp_hr_department_upsert(text, text, boolean, uuid) to service_role;

-- Job title upsert
create or replace function public.erp_hr_job_title_upsert(
  p_title text,
  p_level int default null,
  p_is_active boolean default true,
  p_id uuid default null
) returns public.erp_hr_job_titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing public.erp_hr_job_titles;
  v_row public.erp_hr_job_titles;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if auth.role() <> 'service_role' then
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    if not public.erp_is_hr_admin(v_actor) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  if v_title is null then
    raise exception 'Job title is required';
  end if;

  if p_id is not null then
    select *
      into v_existing
      from public.erp_hr_job_titles
     where id = p_id
       and company_id = v_company_id;

    if not found then
      raise exception 'Job title not found for this company';
    end if;
  end if;

  insert into public.erp_hr_job_titles (
    id,
    company_id,
    title,
    level,
    is_active,
    created_by,
    updated_by
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    v_company_id,
    v_title,
    p_level,
    coalesce(p_is_active, true),
    v_actor,
    v_actor
  )
  on conflict (id) do update
    set title = excluded.title,
        level = excluded.level,
        is_active = excluded.is_active,
        updated_at = now(),
        updated_by = v_actor
  returning * into v_row;

  perform public.erp_log_hr_audit(
    'job_title',
    v_row.id,
    'upsert',
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_job_title_upsert(text, int, boolean, uuid) from public;
grant execute on function public.erp_hr_job_title_upsert(text, int, boolean, uuid) to authenticated;
grant execute on function public.erp_hr_job_title_upsert(text, int, boolean, uuid) to service_role;

-- Location upsert
create or replace function public.erp_hr_location_upsert(
  p_name text,
  p_country text default null,
  p_state text default null,
  p_city text default null,
  p_is_active boolean default true,
  p_id uuid default null
) returns public.erp_hr_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing public.erp_hr_locations;
  v_row public.erp_hr_locations;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.role() <> 'service_role' then
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    if not public.erp_is_hr_admin(v_actor) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  if v_name is null then
    raise exception 'Location name is required';
  end if;

  if p_id is not null then
    select *
      into v_existing
      from public.erp_hr_locations
     where id = p_id
       and company_id = v_company_id;

    if not found then
      raise exception 'Location not found for this company';
    end if;
  end if;

  insert into public.erp_hr_locations (
    id,
    company_id,
    name,
    country,
    state,
    city,
    is_active,
    created_by,
    updated_by
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    v_company_id,
    v_name,
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_state, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    coalesce(p_is_active, true),
    v_actor,
    v_actor
  )
  on conflict (id) do update
    set name = excluded.name,
        country = excluded.country,
        state = excluded.state,
        city = excluded.city,
        is_active = excluded.is_active,
        updated_at = now(),
        updated_by = v_actor
  returning * into v_row;

  perform public.erp_log_hr_audit(
    'location',
    v_row.id,
    'upsert',
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_location_upsert(text, text, text, text, boolean, uuid) from public;
grant execute on function public.erp_hr_location_upsert(text, text, text, text, boolean, uuid) to authenticated;
grant execute on function public.erp_hr_location_upsert(text, text, text, text, boolean, uuid) to service_role;

-- Employment type upsert
create or replace function public.erp_hr_employment_type_upsert(
  p_key text,
  p_name text,
  p_is_active boolean default true,
  p_id uuid default null
) returns public.erp_hr_employment_types
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing public.erp_hr_employment_types;
  v_row public.erp_hr_employment_types;
  v_key text := nullif(trim(coalesce(p_key, '')), '');
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.role() <> 'service_role' then
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    if not public.erp_is_hr_admin(v_actor) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  if v_key is null then
    raise exception 'Employment type key is required';
  end if;

  if v_name is null then
    raise exception 'Employment type name is required';
  end if;

  if p_id is not null then
    select *
      into v_existing
      from public.erp_hr_employment_types
     where id = p_id
       and company_id = v_company_id;

    if not found then
      raise exception 'Employment type not found for this company';
    end if;
  end if;

  insert into public.erp_hr_employment_types (
    id,
    company_id,
    key,
    name,
    is_active,
    created_by,
    updated_by
  )
  values (
    coalesce(p_id, gen_random_uuid()),
    v_company_id,
    v_key,
    v_name,
    coalesce(p_is_active, true),
    v_actor,
    v_actor
  )
  on conflict (id) do update
    set key = excluded.key,
        name = excluded.name,
        is_active = excluded.is_active,
        updated_at = now(),
        updated_by = v_actor
  returning * into v_row;

  perform public.erp_log_hr_audit(
    'employment_type',
    v_row.id,
    'upsert',
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_employment_type_upsert(text, text, boolean, uuid) from public;
grant execute on function public.erp_hr_employment_type_upsert(text, text, boolean, uuid) to authenticated;
grant execute on function public.erp_hr_employment_type_upsert(text, text, boolean, uuid) to service_role;

-- List RPCs (no-arg)
create or replace function public.erp_hr_departments_list()
returns table (
  id uuid,
  name text,
  code text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    d.id,
    d.name,
    d.code,
    d.is_active,
    d.created_at,
    d.updated_at
  from public.erp_hr_departments d
  where d.company_id = public.erp_current_company_id()
  order by d.name;
end;
$$;

revoke all on function public.erp_hr_departments_list() from public;
grant execute on function public.erp_hr_departments_list() to authenticated;
grant execute on function public.erp_hr_departments_list() to service_role;

create or replace function public.erp_hr_job_titles_list()
returns table (
  id uuid,
  title text,
  level int,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    jt.id,
    jt.title,
    jt.level,
    jt.is_active,
    jt.created_at,
    jt.updated_at
  from public.erp_hr_job_titles jt
  where jt.company_id = public.erp_current_company_id()
  order by jt.title;
end;
$$;

revoke all on function public.erp_hr_job_titles_list() from public;
grant execute on function public.erp_hr_job_titles_list() to authenticated;
grant execute on function public.erp_hr_job_titles_list() to service_role;

create or replace function public.erp_hr_locations_list()
returns table (
  id uuid,
  name text,
  country text,
  state text,
  city text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    l.id,
    l.name,
    l.country,
    l.state,
    l.city,
    l.is_active,
    l.created_at,
    l.updated_at
  from public.erp_hr_locations l
  where l.company_id = public.erp_current_company_id()
  order by l.name;
end;
$$;

revoke all on function public.erp_hr_locations_list() from public;
grant execute on function public.erp_hr_locations_list() to authenticated;
grant execute on function public.erp_hr_locations_list() to service_role;

create or replace function public.erp_hr_employment_types_list()
returns table (
  id uuid,
  key text,
  name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    et.id,
    et.key,
    et.name,
    et.is_active,
    et.created_at,
    et.updated_at
  from public.erp_hr_employment_types et
  where et.company_id = public.erp_current_company_id()
  order by et.key;
end;
$$;

revoke all on function public.erp_hr_employment_types_list() from public;
grant execute on function public.erp_hr_employment_types_list() to authenticated;
grant execute on function public.erp_hr_employment_types_list() to service_role;
