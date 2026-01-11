-- Employee compensation effective-dated + HR employee upsert enhancements
create table if not exists public.erp_employee_compensations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  salary_structure_id uuid null references public.erp_salary_structures (id) on delete set null,
  effective_from date not null default current_date,
  effective_to date null,
  currency text not null default 'INR',
  gross_annual numeric(14, 2) null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_employee_compensation_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_compensation_id uuid not null references public.erp_employee_compensations (id) on delete cascade,
  component_id uuid not null references public.erp_salary_components (id) on delete cascade,
  amount numeric(14, 2) null,
  percentage numeric(6, 2) null,
  is_override boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_compensations_effective_check'
      and conrelid = 'public.erp_employee_compensations'::regclass
  ) then
    alter table public.erp_employee_compensations
      add constraint erp_employee_compensations_effective_check
      check (effective_to is null or effective_to >= effective_from);
  end if;
end
$$;

create unique index if not exists erp_employee_compensation_components_key
  on public.erp_employee_compensation_components (employee_compensation_id, component_id);

create index if not exists erp_employee_compensations_employee_effective_idx
  on public.erp_employee_compensations (employee_id, effective_from desc);

create or replace view public.erp_employee_current_compensation as
select distinct on (c.employee_id)
  c.id,
  c.company_id,
  c.employee_id,
  c.salary_structure_id,
  c.effective_from,
  c.effective_to,
  c.currency,
  c.gross_annual,
  c.notes,
  c.created_at,
  c.created_by,
  c.updated_at,
  c.updated_by
from public.erp_employee_compensations c
where c.effective_from <= current_date
  and (c.effective_to is null or c.effective_to >= current_date)
order by c.employee_id, c.effective_from desc, c.created_at desc;

-- updated_at trigger helper
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

drop trigger if exists erp_employee_compensations_set_updated on public.erp_employee_compensations;
create trigger erp_employee_compensations_set_updated
before update on public.erp_employee_compensations
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_employee_compensation_components_set_updated on public.erp_employee_compensation_components;
create trigger erp_employee_compensation_components_set_updated
before update on public.erp_employee_compensation_components
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_employee_compensations enable row level security;
alter table public.erp_employee_compensations force row level security;

alter table public.erp_employee_compensation_components enable row level security;
alter table public.erp_employee_compensation_components force row level security;

do $$
begin
  drop policy if exists erp_employee_compensations_select on public.erp_employee_compensations;
  drop policy if exists erp_employee_compensations_write on public.erp_employee_compensations;
  drop policy if exists erp_employee_compensation_components_select on public.erp_employee_compensation_components;
  drop policy if exists erp_employee_compensation_components_write on public.erp_employee_compensation_components;

  create policy erp_employee_compensations_select
    on public.erp_employee_compensations
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );

  create policy erp_employee_compensations_write
    on public.erp_employee_compensations
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
            and cu.role_key in ('owner', 'admin', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );

  create policy erp_employee_compensation_components_select
    on public.erp_employee_compensation_components
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );

  create policy erp_employee_compensation_components_write
    on public.erp_employee_compensation_components
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
            and cu.role_key in ('owner', 'admin', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );
end
$$;

-- HR employee upsert enhancements
create or replace function public.erp_hr_employee_upsert(
  p_full_name text,
  p_id uuid default null,
  p_employee_code text default null,
  p_user_id uuid default null,
  p_manager_employee_id uuid default null,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid;
  v_lifecycle_status text := case when p_is_active then 'active' else 'inactive' end;
  v_employee_code text;
  v_existing_code text;
  v_contact_email text;
  v_contact_phone text;
begin
  -- HR-only authorization
  perform public.erp_require_hr_writer();

  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required';
  end if;

  -- validate manager chain if helper exists
  if to_regprocedure('public.erp_hr_validate_manager_chain(uuid,uuid)') is not null then
    if p_id is not null then
      perform public.erp_hr_validate_manager_chain(p_id, p_manager_employee_id);
    end if;
  end if;

  if p_id is null then
    v_employee_code := nullif(trim(coalesce(p_employee_code, '')), '');
    if v_employee_code is null then
      v_employee_code := public.erp_next_employee_code(v_company_id);
    end if;

    insert into public.erp_employees (
      company_id,
      full_name,
      employee_code,
      user_id,
      manager_employee_id,
      lifecycle_status,
      status
    )
    values (
      v_company_id,
      p_full_name,
      v_employee_code,
      p_user_id,
      p_manager_employee_id,
      v_lifecycle_status,
      v_lifecycle_status
    )
    returning id into v_employee_id;
  else
    select employee_code
      into v_existing_code
      from public.erp_employees e
     where e.id = p_id
       and e.company_id = v_company_id;

    if v_existing_code is null or v_existing_code = '' then
      v_employee_code := nullif(trim(coalesce(p_employee_code, '')), '');
      if v_employee_code is null then
        v_employee_code := public.erp_next_employee_code(v_company_id);
      end if;
    else
      v_employee_code := coalesce(nullif(trim(coalesce(p_employee_code, '')), ''), v_existing_code);
    end if;

    update public.erp_employees e
      set full_name = p_full_name,
          employee_code = v_employee_code,
          user_id = p_user_id,
          manager_employee_id = p_manager_employee_id,
          lifecycle_status = v_lifecycle_status,
          status = v_lifecycle_status,
          updated_at = now()
    where e.id = p_id
      and e.company_id = v_company_id
    returning e.id into v_employee_id;

    if v_employee_id is null then
      raise exception 'Employee not found';
    end if;
  end if;

  -- post-insert manager chain validation
  if to_regprocedure('public.erp_hr_validate_manager_chain(uuid,uuid)') is not null then
    perform public.erp_hr_validate_manager_chain(v_employee_id, p_manager_employee_id);
  end if;

  -- upsert contacts from employee profile data
  select coalesce(nullif(trim(e.email), ''), nullif(trim(e.work_email), ''), nullif(trim(e.personal_email), '')),
         nullif(trim(e.phone), '')
    into v_contact_email, v_contact_phone
    from public.erp_employees e
   where e.id = v_employee_id;

  if v_contact_email is not null or v_contact_phone is not null then
    insert into public.erp_employee_contacts (
      company_id,
      employee_id,
      contact_type,
      email,
      phone,
      is_primary,
      created_by,
      updated_by
    )
    values (
      v_company_id,
      v_employee_id,
      'primary',
      v_contact_email,
      v_contact_phone,
      true,
      auth.uid(),
      auth.uid()
    )
    on conflict (employee_id, contact_type) do update
      set email = excluded.email,
          phone = excluded.phone,
          is_primary = true,
          updated_at = now(),
          updated_by = auth.uid();
  end if;

  -- insert effective-dated job row (do not overwrite history)
  if not exists (
    select 1
    from public.erp_employee_jobs j
    where j.company_id = v_company_id
      and j.employee_id = v_employee_id
      and j.effective_from = current_date
      and j.manager_employee_id is not distinct from p_manager_employee_id
  ) then
    insert into public.erp_employee_jobs (
      company_id,
      employee_id,
      manager_employee_id,
      effective_from,
      created_by,
      updated_by
    )
    values (
      v_company_id,
      v_employee_id,
      p_manager_employee_id,
      current_date,
      auth.uid(),
      auth.uid()
    );
  end if;

  return v_employee_id;
end;
$$;

revoke all on function public.erp_hr_employee_upsert(text,uuid,text,uuid,uuid,boolean) from public;
grant execute on function public.erp_hr_employee_upsert(text,uuid,text,uuid,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
