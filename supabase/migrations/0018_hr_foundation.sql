-- HR Foundation: masters, employee job structure, documents, and audit logging
create extension if not exists "pgcrypto";

-- HR master tables
create table if not exists public.erp_hr_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  code text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_departments_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_job_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  title text not null,
  level int null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_job_titles_company_title_key unique (company_id, title)
);

create table if not exists public.erp_hr_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  name text not null,
  country text null,
  state text null,
  city text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_locations_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_employment_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  key text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_hr_employment_types_company_key_key unique (company_id, key)
);

-- Employee table enhancements for job structure and lifecycle tracking
alter table public.erp_employees
  add column if not exists department_id uuid references public.erp_hr_departments (id),
  add column if not exists job_title_id uuid references public.erp_hr_job_titles (id),
  add column if not exists location_id uuid references public.erp_hr_locations (id),
  add column if not exists employment_type_id uuid references public.erp_hr_employment_types (id),
  add column if not exists manager_employee_id uuid references public.erp_employees (id),
  add column if not exists lifecycle_status text not null default 'preboarding',
  add column if not exists exit_date date,
  add column if not exists emergency_contact_json jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employees_lifecycle_status_check'
      and conrelid = 'public.erp_employees'::regclass
  ) then
    alter table public.erp_employees
      add constraint erp_employees_lifecycle_status_check
        check (lifecycle_status in ('preboarding', 'active', 'on_notice', 'exited'));
  end if;
end
$$;

update public.erp_employees
   set lifecycle_status = coalesce(nullif(lifecycle_status, ''), 'preboarding')
 where lifecycle_status is null or lifecycle_status = '';

-- Employee documents
create table if not exists public.erp_employee_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  file_name text null,
  mime_type text null,
  size_bytes bigint null,
  notes text null,
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  deleted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_employee_documents_doc_type_check
    check (doc_type in ('photo', 'id_proof', 'offer_letter', 'certificate', 'other'))
);

-- HR audit log
create table if not exists public.erp_hr_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changes jsonb null,
  actor_user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Helper to set updated timestamps on master tables
create or replace function public.erp_hr_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Apply triggers
drop trigger if exists erp_hr_departments_set_updated on public.erp_hr_departments;
create trigger erp_hr_departments_set_updated
before update on public.erp_hr_departments
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_job_titles_set_updated on public.erp_hr_job_titles;
create trigger erp_hr_job_titles_set_updated
before update on public.erp_hr_job_titles
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_locations_set_updated on public.erp_hr_locations;
create trigger erp_hr_locations_set_updated
before update on public.erp_hr_locations
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_hr_employment_types_set_updated on public.erp_hr_employment_types;
create trigger erp_hr_employment_types_set_updated
before update on public.erp_hr_employment_types
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_documents_set_updated on public.erp_employee_documents;
create trigger erp_employee_documents_set_updated
before update on public.erp_employee_documents
for each row
execute function public.erp_hr_set_updated();

-- RLS policies for HR masters
alter table public.erp_hr_departments enable row level security;
alter table public.erp_hr_departments force row level security;
alter table public.erp_hr_job_titles enable row level security;
alter table public.erp_hr_job_titles force row level security;
alter table public.erp_hr_locations enable row level security;
alter table public.erp_hr_locations force row level security;
alter table public.erp_hr_employment_types enable row level security;
alter table public.erp_hr_employment_types force row level security;
alter table public.erp_employee_documents enable row level security;
alter table public.erp_employee_documents force row level security;
alter table public.erp_hr_audit_log enable row level security;
alter table public.erp_hr_audit_log force row level security;

do $$
begin
  -- department policies
  drop policy if exists erp_hr_departments_select on public.erp_hr_departments;
  drop policy if exists erp_hr_departments_write on public.erp_hr_departments;

  create policy erp_hr_departments_select
    on public.erp_hr_departments
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_departments_write
    on public.erp_hr_departments
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  -- job title policies
  drop policy if exists erp_hr_job_titles_select on public.erp_hr_job_titles;
  drop policy if exists erp_hr_job_titles_write on public.erp_hr_job_titles;

  create policy erp_hr_job_titles_select
    on public.erp_hr_job_titles
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_job_titles_write
    on public.erp_hr_job_titles
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  -- location policies
  drop policy if exists erp_hr_locations_select on public.erp_hr_locations;
  drop policy if exists erp_hr_locations_write on public.erp_hr_locations;

  create policy erp_hr_locations_select
    on public.erp_hr_locations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_locations_write
    on public.erp_hr_locations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  -- employment type policies
  drop policy if exists erp_hr_employment_types_select on public.erp_hr_employment_types;
  drop policy if exists erp_hr_employment_types_write on public.erp_hr_employment_types;

  create policy erp_hr_employment_types_select
    on public.erp_hr_employment_types
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_hr_employment_types_write
    on public.erp_hr_employment_types
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  -- employee documents policies
  drop policy if exists erp_employee_documents_select_hr on public.erp_employee_documents;
  drop policy if exists erp_employee_documents_select_self on public.erp_employee_documents;
  drop policy if exists erp_employee_documents_write on public.erp_employee_documents;

  create policy erp_employee_documents_select_hr
    on public.erp_employee_documents
    for select
    using (
      company_id = public.erp_current_company_id()
      and coalesce(is_deleted, false) = false
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_documents_select_self
    on public.erp_employee_documents
    for select
    using (
      company_id = public.erp_current_company_id()
      and coalesce(is_deleted, false) = false
      and doc_type <> 'id_proof'
      and auth.uid() is not null
      and (
        exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_documents_write
    on public.erp_employee_documents
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  -- HR audit log policies
  drop policy if exists erp_hr_audit_log_access on public.erp_hr_audit_log;

  create policy erp_hr_audit_log_access
    on public.erp_hr_audit_log
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
end
$$;

-- Storage bucket policies for employee private assets
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'erp-employee-private') then
    insert into storage.buckets (id, name, public) values ('erp-employee-private', 'erp-employee-private', false);
  end if;

  -- drop legacy policies if present
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'erp_employee_private_read'
  ) then
    drop policy erp_employee_private_read on storage.objects;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'erp_employee_private_write'
  ) then
    drop policy erp_employee_private_write on storage.objects;
  end if;

  create policy erp_employee_private_read
    on storage.objects
    for select
    using (
      bucket_id = 'erp-employee-private'
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
        or exists (
          select 1
          from public.erp_employee_documents d
          where d.file_path = name
            and coalesce(d.is_deleted, false) = false
            and coalesce(d.company_id, public.erp_current_company_id()) = public.erp_current_company_id()
            and d.doc_type <> 'id_proof'
            and (
              exists (
                select 1
                from public.erp_employees e
                where e.id = d.employee_id
                  and e.company_id = public.erp_current_company_id()
                  and e.user_id = auth.uid()
              )
              or exists (
                select 1
                from public.erp_employee_users eu
                where eu.employee_id = d.employee_id
                  and eu.user_id = auth.uid()
                  and coalesce(eu.is_active, true)
              )
            )
        )
      )
    );

  create policy erp_employee_private_write
    on storage.objects
    for insert
    with check (
      bucket_id = 'erp-employee-private'
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );

  create policy erp_employee_private_delete
    on storage.objects
    for delete
    using (
      bucket_id = 'erp-employee-private'
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
end
$$;

-- Helper to write audit rows
create or replace function public.erp_log_hr_audit(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_hr_audit_log (
    company_id,
    entity_type,
    entity_id,
    action,
    changes
  )
  values (
    public.erp_current_company_id(),
    trim(p_entity_type),
    p_entity_id,
    trim(p_action),
    p_changes
  );
end;
$$;

revoke all on function public.erp_log_hr_audit(text, uuid, text, jsonb) from public;
grant execute on function public.erp_log_hr_audit(text, uuid, text, jsonb) to authenticated;

-- HR master upsert and list RPCs
create or replace function public.erp_hr_department_upsert(
  p_id uuid default null,
  p_name text,
  p_code text default null,
  p_is_active boolean default true
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
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
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
    case when p_id is null then 'create' else 'update' end,
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_department_upsert(uuid, text, text, boolean) from public;
grant execute on function public.erp_hr_department_upsert(uuid, text, text, boolean) to authenticated;

create or replace function public.erp_hr_job_title_upsert(
  p_id uuid default null,
  p_title text,
  p_level int default null,
  p_is_active boolean default true
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
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
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
    case when p_id is null then 'create' else 'update' end,
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_job_title_upsert(uuid, text, int, boolean) from public;
grant execute on function public.erp_hr_job_title_upsert(uuid, text, int, boolean) to authenticated;

create or replace function public.erp_hr_location_upsert(
  p_id uuid default null,
  p_name text,
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
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing public.erp_hr_locations;
  v_row public.erp_hr_locations;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
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
    case when p_id is null then 'create' else 'update' end,
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_location_upsert(uuid, text, text, text, text, boolean) from public;
grant execute on function public.erp_hr_location_upsert(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.erp_hr_employment_type_upsert(
  p_id uuid default null,
  p_key text,
  p_name text,
  p_is_active boolean default true
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
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
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
    case when p_id is null then 'create' else 'update' end,
    jsonb_build_object('before', row_to_json(v_existing), 'after', row_to_json(v_row))
  );

  return v_row;
end;
$$;

revoke all on function public.erp_hr_employment_type_upsert(uuid, text, text, boolean) from public;
grant execute on function public.erp_hr_employment_type_upsert(uuid, text, text, boolean) to authenticated;

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
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
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
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
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
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
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
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
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
  order by et.name;
end;
$$;

revoke all on function public.erp_hr_employment_types_list() from public;
grant execute on function public.erp_hr_employment_types_list() to authenticated;

-- Employee job update RPC
create or replace function public.erp_employee_update_job(
  p_employee_id uuid,
  p_department_id uuid default null,
  p_job_title_id uuid default null,
  p_location_id uuid default null,
  p_employment_type_id uuid default null,
  p_manager_employee_id uuid default null,
  p_lifecycle_status text default 'preboarding',
  p_exit_date date default null
) returns public.erp_employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_employee public.erp_employees;
  v_before jsonb;
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

  select *
    into v_employee
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;

  if not found then
    raise exception 'Employee not found for this company';
  end if;

  v_before := jsonb_build_object(
    'department_id', v_employee.department_id,
    'job_title_id', v_employee.job_title_id,
    'location_id', v_employee.location_id,
    'employment_type_id', v_employee.employment_type_id,
    'manager_employee_id', v_employee.manager_employee_id,
    'lifecycle_status', v_employee.lifecycle_status,
    'exit_date', v_employee.exit_date
  );

  if p_department_id is not null then
    perform 1 from public.erp_hr_departments d
     where d.id = p_department_id
       and d.company_id = v_company_id
       and coalesce(d.is_active, true);
    if not found then
      raise exception 'Invalid department_id';
    end if;
  end if;

  if p_job_title_id is not null then
    perform 1 from public.erp_hr_job_titles jt
     where jt.id = p_job_title_id
       and jt.company_id = v_company_id
       and coalesce(jt.is_active, true);
    if not found then
      raise exception 'Invalid job_title_id';
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

  if p_employment_type_id is not null then
    perform 1 from public.erp_hr_employment_types et
     where et.id = p_employment_type_id
       and et.company_id = v_company_id
       and coalesce(et.is_active, true);
    if not found then
      raise exception 'Invalid employment_type_id';
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

  update public.erp_employees
     set department_id = p_department_id,
         job_title_id = p_job_title_id,
         location_id = p_location_id,
         employment_type_id = p_employment_type_id,
         manager_employee_id = p_manager_employee_id,
         lifecycle_status = v_status,
         exit_date = p_exit_date,
         updated_at = now(),
         updated_by = v_actor
   where id = p_employee_id
     and company_id = v_company_id
  returning * into v_employee;

  perform public.erp_log_hr_audit(
    'employee',
    v_employee.id,
    'update',
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'department_id', v_employee.department_id,
        'job_title_id', v_employee.job_title_id,
        'location_id', v_employee.location_id,
        'employment_type_id', v_employee.employment_type_id,
        'manager_employee_id', v_employee.manager_employee_id,
        'lifecycle_status', v_employee.lifecycle_status,
        'exit_date', v_employee.exit_date
      )
    )
  );

  return v_employee;
end;
$$;

revoke all on function public.erp_employee_update_job(uuid, uuid, uuid, uuid, uuid, uuid, text, date) from public;
grant execute on function public.erp_employee_update_job(uuid, uuid, uuid, uuid, uuid, uuid, text, date) to authenticated;

-- Employee documents RPCs
create or replace function public.erp_employee_document_add(
  p_employee_id uuid,
  p_doc_type text,
  p_file_path text,
  p_file_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_notes text default null
) returns public.erp_employee_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_employee public.erp_employees;
  v_doc public.erp_employee_documents;
  v_type text := lower(trim(coalesce(p_doc_type, '')));
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
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

  if v_path is null then
    raise exception 'file_path is required';
  end if;

  if v_type not in ('photo', 'id_proof', 'offer_letter', 'certificate', 'other') then
    raise exception 'Invalid doc_type';
  end if;

  select *
    into v_employee
    from public.erp_employees e
   where e.id = p_employee_id
     and e.company_id = v_company_id;

  if not found then
    raise exception 'Employee not found for this company';
  end if;

  insert into public.erp_employee_documents (
    company_id,
    employee_id,
    doc_type,
    file_path,
    file_name,
    mime_type,
    size_bytes,
    notes,
    created_by,
    updated_by
  )
  values (
    v_company_id,
    p_employee_id,
    v_type,
    v_path,
    nullif(trim(coalesce(p_file_name, '')), ''),
    nullif(trim(coalesce(p_mime_type, '')), ''),
    p_size_bytes,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_actor,
    v_actor
  )
  returning * into v_doc;

  perform public.erp_log_hr_audit(
    'document',
    v_doc.id,
    'upload',
    jsonb_build_object(
      'employee_id', p_employee_id,
      'doc_type', v_doc.doc_type,
      'file_path', v_doc.file_path,
      'file_name', v_doc.file_name
    )
  );

  return v_doc;
end;
$$;

revoke all on function public.erp_employee_document_add(uuid, text, text, text, text, bigint, text) from public;
grant execute on function public.erp_employee_document_add(uuid, text, text, text, text, bigint, text) to authenticated;

create or replace function public.erp_employee_document_delete(
  p_document_id uuid
) returns public.erp_employee_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_doc public.erp_employee_documents;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_document_id is null then
    raise exception 'document_id is required';
  end if;

  select *
    into v_doc
    from public.erp_employee_documents d
   where d.id = p_document_id
     and d.company_id = v_company_id
     and coalesce(d.is_deleted, false) = false;

  if not found then
    raise exception 'Document not found';
  end if;

  update public.erp_employee_documents
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = v_actor,
         updated_by = v_actor,
         updated_at = now()
   where id = p_document_id
     and company_id = v_company_id
  returning * into v_doc;

  perform public.erp_log_hr_audit(
    'document',
    v_doc.id,
    'delete',
    jsonb_build_object('document_id', p_document_id, 'employee_id', v_doc.employee_id)
  );

  return v_doc;
end;
$$;

revoke all on function public.erp_employee_document_delete(uuid) from public;
grant execute on function public.erp_employee_document_delete(uuid) to authenticated;

-- Employee profile listing with job fields
create or replace function public.erp_employee_profile(p_employee_id uuid)
returns table (
  id uuid,
  employee_code text,
  employee_no text,
  full_name text,
  email text,
  work_email text,
  personal_email text,
  phone text,
  department_id uuid,
  department_name text,
  job_title_id uuid,
  job_title text,
  location_id uuid,
  location_name text,
  employment_type_id uuid,
  employment_type text,
  manager_employee_id uuid,
  lifecycle_status text,
  exit_date date,
  emergency_contact_json jsonb,
  status text,
  employment_status text,
  joining_date date,
  user_id uuid,
  role_key text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_is_hr boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  v_is_hr := public.erp_is_hr_admin(v_actor);

  if not v_is_hr then
    if not exists (
      select 1
      from public.erp_employees e
      where e.id = p_employee_id
        and e.company_id = v_company_id
        and e.user_id = v_actor
    ) and not exists (
      select 1
      from public.erp_employee_users eu
      where eu.employee_id = p_employee_id
        and eu.company_id = v_company_id
        and eu.user_id = v_actor
        and coalesce(eu.is_active, true)
    ) then
      raise exception 'Not authorized';
    end if;
  end if;

  return query
  select
    e.id,
    e.employee_code,
    e.employee_no,
    e.full_name,
    coalesce(e.email, e.work_email, e.personal_email) as email,
    e.work_email,
    e.personal_email,
    e.phone,
    e.department_id,
    d.name as department_name,
    e.job_title_id,
    jt.title as job_title,
    e.location_id,
    l.name as location_name,
    e.employment_type_id,
    et.name as employment_type,
    e.manager_employee_id,
    e.lifecycle_status,
    e.exit_date,
    e.emergency_contact_json,
    e.status,
    e.employment_status,
    e.joining_date,
    e.user_id,
    cu.role_key,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_hr_departments d on d.id = e.department_id
  left join public.erp_hr_job_titles jt on jt.id = e.job_title_id
  left join public.erp_hr_locations l on l.id = e.location_id
  left join public.erp_hr_employment_types et on et.id = e.employment_type_id
  left join public.erp_employee_users eu
    on eu.employee_id = e.id
   and eu.company_id = v_company_id
   and coalesce(eu.is_active, true)
  left join public.erp_company_users cu
    on cu.company_id = v_company_id
   and cu.user_id = coalesce(e.user_id, eu.user_id)
   and coalesce(cu.is_active, true)
  where e.id = p_employee_id
    and e.company_id = v_company_id
  limit 1;
end;
$$;

revoke all on function public.erp_employee_profile(uuid) from public;
grant execute on function public.erp_employee_profile(uuid) to authenticated;

-- Update list RPC to include job fields
create or replace function public.erp_list_employees()
returns table (
  id uuid,
  employee_code text,
  employee_no text,
  full_name text,
  email text,
  work_email text,
  personal_email text,
  phone text,
  department text,
  designation text,
  designation_id uuid,
  department_id uuid,
  job_title_id uuid,
  job_title text,
  location_id uuid,
  location text,
  employment_type_id uuid,
  employment_type text,
  employment_status text,
  status text,
  lifecycle_status text,
  joining_date date,
  user_id uuid,
  role_key text,
  manager_employee_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_is_hr boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  v_is_hr := public.erp_is_hr_admin(v_actor);

  if not v_is_hr then
    return query
    select
      e.id,
      e.employee_code,
      e.employee_no,
      e.full_name,
      e.email,
      e.work_email,
      e.personal_email,
      e.phone,
      e.department,
      e.designation,
      e.designation_id,
      e.department_id,
      e.job_title_id,
      null::text as job_title,
      e.location_id,
      null::text as location,
      e.employment_type_id,
      null::text as employment_type,
      e.employment_status,
      e.status,
      e.lifecycle_status,
      e.joining_date,
      e.user_id,
      null::text as role_key,
      e.manager_employee_id,
      e.created_at,
      e.updated_at
    from public.erp_employees e
    where e.company_id = v_company_id
      and e.user_id = v_actor
    limit 1;
    return;
  end if;

  return query
  select
    e.id,
    e.employee_code,
    e.employee_no,
    e.full_name,
    coalesce(e.email, e.work_email, e.personal_email) as email,
    e.work_email,
    e.personal_email,
    e.phone,
    coalesce(e.department, d.name),
    coalesce(e.designation, old_d.name),
    e.designation_id,
    e.department_id,
    e.job_title_id,
    jt.title as job_title,
    e.location_id,
    l.name as location,
    e.employment_type_id,
    et.name as employment_type,
    e.employment_status,
    e.status,
    e.lifecycle_status,
    e.joining_date,
    e.user_id,
    cu.role_key,
    e.manager_employee_id,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_hr_departments d on d.id = e.department_id
  left join public.erp_designations old_d on old_d.id = e.designation_id
  left join public.erp_hr_job_titles jt on jt.id = e.job_title_id
  left join public.erp_hr_locations l on l.id = e.location_id
  left join public.erp_hr_employment_types et on et.id = e.employment_type_id
  left join public.erp_employee_users eu
    on eu.employee_id = e.id
   and coalesce(eu.company_id, v_company_id) = v_company_id
   and coalesce(eu.is_active, true)
  left join public.erp_company_users cu
    on cu.company_id = v_company_id
   and cu.user_id = coalesce(e.user_id, eu.user_id)
   and coalesce(cu.is_active, true)
  where e.company_id = v_company_id
  order by e.joining_date desc nulls last, e.created_at desc;
end;
$$;

revoke all on function public.erp_list_employees() from public;
grant execute on function public.erp_list_employees() to authenticated;
