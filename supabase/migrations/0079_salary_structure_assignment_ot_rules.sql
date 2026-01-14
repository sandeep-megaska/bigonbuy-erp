-- Phase-2 salary refactor: structures vs assignments + OT rules

begin;

alter table public.erp_salary_structures
  add column if not exists notes text;

create table if not exists public.erp_salary_structure_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  structure_id uuid not null references public.erp_salary_structures (id) on delete cascade,
  code text not null,
  name text not null,
  component_type text not null,
  calc_mode text not null,
  value numeric null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists erp_salary_structure_components_company_structure_code_key
  on public.erp_salary_structure_components (company_id, structure_id, code);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_salary_structure_components_type_check'
      and conrelid = 'public.erp_salary_structure_components'::regclass
  ) then
    alter table public.erp_salary_structure_components
      add constraint erp_salary_structure_components_type_check
      check (component_type in ('earning', 'deduction'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_salary_structure_components_calc_check'
      and conrelid = 'public.erp_salary_structure_components'::regclass
  ) then
    alter table public.erp_salary_structure_components
      add constraint erp_salary_structure_components_calc_check
      check (calc_mode in ('fixed', 'percent_of_basic', 'manual'));
  end if;
end
$$;

create table if not exists public.erp_salary_structure_ot_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  structure_id uuid not null references public.erp_salary_structures (id) on delete cascade,
  ot_type text not null,
  multiplier numeric not null,
  base text not null default 'basic_hourly',
  hours_per_day numeric not null default 8,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists erp_salary_structure_ot_rules_company_structure_type_key
  on public.erp_salary_structure_ot_rules (company_id, structure_id, ot_type);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_salary_structure_ot_rules_type_check'
      and conrelid = 'public.erp_salary_structure_ot_rules'::regclass
  ) then
    alter table public.erp_salary_structure_ot_rules
      add constraint erp_salary_structure_ot_rules_type_check
      check (ot_type in ('normal', 'holiday'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_salary_structure_ot_rules_base_check'
      and conrelid = 'public.erp_salary_structure_ot_rules'::regclass
  ) then
    alter table public.erp_salary_structure_ot_rules
      add constraint erp_salary_structure_ot_rules_base_check
      check (base in ('basic_hourly', 'gross_hourly'));
  end if;
end
$$;

create table if not exists public.erp_employee_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  salary_structure_id uuid not null references public.erp_salary_structures (id),
  effective_from date not null,
  effective_to date null,
  notes text null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_salary_assignments_effective_check'
      and conrelid = 'public.erp_employee_salary_assignments'::regclass
  ) then
    alter table public.erp_employee_salary_assignments
      add constraint erp_employee_salary_assignments_effective_check
      check (effective_to is null or effective_to >= effective_from);
  end if;
end
$$;

create index if not exists erp_employee_salary_assignments_employee_effective_idx
  on public.erp_employee_salary_assignments (employee_id, effective_from desc);

create unique index if not exists erp_employee_salary_assignments_active_key
  on public.erp_employee_salary_assignments (company_id, employee_id)
  where effective_to is null;

alter table public.erp_salary_structure_components enable row level security;
alter table public.erp_salary_structure_components force row level security;

alter table public.erp_salary_structure_ot_rules enable row level security;
alter table public.erp_salary_structure_ot_rules force row level security;

alter table public.erp_employee_salary_assignments enable row level security;
alter table public.erp_employee_salary_assignments force row level security;

-- Update salary structure policies to include payroll role

do $$
begin
  drop policy if exists erp_salary_structures_select on public.erp_salary_structures;
  drop policy if exists erp_salary_structures_write on public.erp_salary_structures;
  drop policy if exists erp_salary_components_select on public.erp_salary_components;
  drop policy if exists erp_salary_components_write on public.erp_salary_components;
  drop policy if exists erp_salary_structure_components_select on public.erp_salary_structure_components;
  drop policy if exists erp_salary_structure_components_write on public.erp_salary_structure_components;
  drop policy if exists erp_salary_structure_ot_rules_select on public.erp_salary_structure_ot_rules;
  drop policy if exists erp_salary_structure_ot_rules_write on public.erp_salary_structure_ot_rules;
  drop policy if exists erp_employee_salary_assignments_select on public.erp_employee_salary_assignments;
  drop policy if exists erp_employee_salary_assignments_write on public.erp_employee_salary_assignments;

  create policy erp_salary_structures_select
    on public.erp_salary_structures
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_structures_write
    on public.erp_salary_structures
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_components_select
    on public.erp_salary_components
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_components_write
    on public.erp_salary_components
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_structure_components_select
    on public.erp_salary_structure_components
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_structure_components_write
    on public.erp_salary_structure_components
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_structure_ot_rules_select
    on public.erp_salary_structure_ot_rules
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_salary_structure_ot_rules_write
    on public.erp_salary_structure_ot_rules
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_employee_salary_assignments_select
    on public.erp_employee_salary_assignments
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
        or exists (
          select 1
          from public.erp_employees e
          where e.company_id = public.erp_current_company_id()
            and e.id = employee_id
            and e.user_id = auth.uid()
        )
      )
    );

  create policy erp_employee_salary_assignments_write
    on public.erp_employee_salary_assignments
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );
end
$$;

create or replace function public.erp_salary_structure_upsert(
  p_name text,
  p_is_active boolean default true,
  p_notes text default null,
  p_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_id is null then
    insert into public.erp_salary_structures (
      company_id,
      name,
      is_active,
      notes
    ) values (
      v_company_id,
      p_name,
      coalesce(p_is_active, true),
      nullif(btrim(coalesce(p_notes, '')), '')
    ) returning id into v_id;
  else
    update public.erp_salary_structures s
      set name = p_name,
          is_active = coalesce(p_is_active, true),
          notes = nullif(btrim(coalesce(p_notes, '')), ''),
          updated_at = now(),
          updated_by = v_actor
    where s.id = p_id
      and s.company_id = v_company_id
    returning s.id into v_id;

    if v_id is null then
      raise exception 'Salary structure not found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_salary_structure_upsert(text, boolean, text, uuid) from public;
grant execute on function public.erp_salary_structure_upsert(text, boolean, text, uuid) to authenticated;

create or replace function public.erp_salary_structure_component_upsert(
  p_structure_id uuid,
  p_code text,
  p_name text,
  p_component_type text,
  p_calc_mode text,
  p_value numeric default null,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_structure_id is null then
    raise exception 'structure_id is required';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'code is required';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_salary_structures s
    where s.id = p_structure_id
      and s.company_id = v_company_id
  ) then
    raise exception 'Salary structure not found';
  end if;

  insert into public.erp_salary_structure_components (
    company_id,
    structure_id,
    code,
    name,
    component_type,
    calc_mode,
    value,
    is_active
  ) values (
    v_company_id,
    p_structure_id,
    upper(trim(p_code)),
    p_name,
    p_component_type,
    p_calc_mode,
    p_value,
    coalesce(p_is_active, true)
  )
  on conflict (company_id, structure_id, code)
  do update set
    name = excluded.name,
    component_type = excluded.component_type,
    calc_mode = excluded.calc_mode,
    value = excluded.value,
    is_active = excluded.is_active
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_salary_structure_component_upsert(uuid, text, text, text, text, numeric, boolean) from public;
grant execute on function public.erp_salary_structure_component_upsert(uuid, text, text, text, text, numeric, boolean) to authenticated;

create or replace function public.erp_salary_structure_ot_rule_upsert(
  p_structure_id uuid,
  p_ot_type text,
  p_multiplier numeric,
  p_base text default 'basic_hourly',
  p_is_active boolean default true,
  p_hours_per_day numeric default 8
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_base text := coalesce(nullif(btrim(coalesce(p_base, '')), ''), 'basic_hourly');
  v_ot_type text := coalesce(nullif(btrim(coalesce(p_ot_type, '')), ''), 'normal');
  v_hours_per_day numeric := coalesce(p_hours_per_day, 8);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_structure_id is null then
    raise exception 'structure_id is required';
  end if;

  if p_multiplier is null then
    raise exception 'multiplier is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_salary_structures s
    where s.id = p_structure_id
      and s.company_id = v_company_id
  ) then
    raise exception 'Salary structure not found';
  end if;

  insert into public.erp_salary_structure_ot_rules (
    company_id,
    structure_id,
    ot_type,
    multiplier,
    base,
    hours_per_day,
    is_active
  ) values (
    v_company_id,
    p_structure_id,
    v_ot_type,
    p_multiplier,
    v_base,
    v_hours_per_day,
    coalesce(p_is_active, true)
  )
  on conflict (company_id, structure_id, ot_type)
  do update set
    multiplier = excluded.multiplier,
    base = excluded.base,
    hours_per_day = excluded.hours_per_day,
    is_active = excluded.is_active
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_salary_structure_ot_rule_upsert(uuid, text, numeric, text, boolean, numeric) from public;
grant execute on function public.erp_salary_structure_ot_rule_upsert(uuid, text, numeric, text, boolean, numeric) to authenticated;

create or replace function public.erp_employee_salary_assign(
  p_employee_id uuid,
  p_salary_structure_id uuid,
  p_effective_from date,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_effective_from date := coalesce(p_effective_from, current_date);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null or p_salary_structure_id is null then
    raise exception 'employee_id and salary_structure_id are required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Employee not found';
  end if;

  if not exists (
    select 1
    from public.erp_salary_structures s
    where s.id = p_salary_structure_id
      and s.company_id = v_company_id
  ) then
    raise exception 'Salary structure not found';
  end if;

  update public.erp_employee_salary_assignments a
     set effective_to = (v_effective_from - interval '1 day')::date
   where a.company_id = v_company_id
     and a.employee_id = p_employee_id
     and a.effective_to is null
     and a.effective_from <= v_effective_from;

  insert into public.erp_employee_salary_assignments (
    company_id,
    employee_id,
    salary_structure_id,
    effective_from,
    effective_to,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    p_salary_structure_id,
    v_effective_from,
    null,
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_employee_salary_assign(uuid, uuid, date, text) from public;
grant execute on function public.erp_employee_salary_assign(uuid, uuid, date, text) to authenticated;

create or replace function public.erp_employee_salary_current(
  p_employee_id uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_assignment record;
  v_can_read boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  v_can_read := exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  )
  or exists (
    select 1
    from public.erp_employees e
    where e.company_id = v_company_id
      and e.id = p_employee_id
      and e.user_id = v_actor
  );

  if not v_can_read then
    raise exception 'Not authorized';
  end if;

  select a.id,
         a.employee_id,
         a.salary_structure_id,
         s.name as structure_name,
         a.effective_from,
         a.effective_to,
         a.notes
    into v_assignment
    from public.erp_employee_salary_assignments a
    join public.erp_salary_structures s
      on s.id = a.salary_structure_id
     and s.company_id = v_company_id
   where a.company_id = v_company_id
     and a.employee_id = p_employee_id
     and a.effective_from <= current_date
     and (a.effective_to is null or a.effective_to >= current_date)
   order by a.effective_from desc
   limit 1;

  return json_build_object(
    'current', case when v_assignment.id is null then null else json_build_object(
      'id', v_assignment.id,
      'employee_id', v_assignment.employee_id,
      'salary_structure_id', v_assignment.salary_structure_id,
      'structure_name', v_assignment.structure_name,
      'effective_from', v_assignment.effective_from,
      'effective_to', v_assignment.effective_to,
      'notes', v_assignment.notes
    ) end,
    'history', coalesce((
      select json_agg(json_build_object(
        'id', a.id,
        'salary_structure_id', a.salary_structure_id,
        'structure_name', s.name,
        'effective_from', a.effective_from,
        'effective_to', a.effective_to,
        'notes', a.notes
      ) order by a.effective_from desc)
      from public.erp_employee_salary_assignments a
      join public.erp_salary_structures s
        on s.id = a.salary_structure_id
       and s.company_id = v_company_id
      where a.company_id = v_company_id
        and a.employee_id = p_employee_id
    ), '[]'::json),
    'ot_rules', coalesce((
      select json_agg(json_build_object(
        'ot_type', r.ot_type,
        'multiplier', r.multiplier,
        'base', r.base,
        'hours_per_day', r.hours_per_day,
        'is_active', r.is_active
      ) order by r.ot_type)
      from public.erp_salary_structure_ot_rules r
      where r.company_id = v_company_id
        and r.structure_id = v_assignment.salary_structure_id
    ), '[]'::json),
    'components', coalesce((
      select json_agg(json_build_object(
        'code', c.code,
        'name', c.name,
        'component_type', c.component_type,
        'calc_mode', c.calc_mode,
        'value', c.value,
        'is_active', c.is_active
      ) order by c.code)
      from public.erp_salary_structure_components c
      where c.company_id = v_company_id
        and c.structure_id = v_assignment.salary_structure_id
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.erp_employee_salary_current(uuid) from public;
grant execute on function public.erp_employee_salary_current(uuid) to authenticated;

insert into public.erp_salary_structure_ot_rules (
  company_id,
  structure_id,
  ot_type,
  multiplier,
  base,
  hours_per_day,
  is_active
)
select s.company_id,
       s.id,
       v.ot_type,
       v.multiplier,
       'basic_hourly',
       8,
       true
from public.erp_salary_structures s
cross join (
  values
    ('normal'::text, 1.25::numeric),
    ('holiday'::text, 2.0::numeric)
) as v(ot_type, multiplier)
where not exists (
  select 1
  from public.erp_salary_structure_ot_rules r
  where r.structure_id = s.id
    and r.company_id = s.company_id
    and r.ot_type = v.ot_type
);

-- Payroll OT logic and assignment-aware generation

drop function if exists public.erp_payroll_item_line_upsert(uuid,text,numeric,numeric,numeric,text);

create or replace function public.erp_payroll_item_line_upsert(
  p_payroll_item_id uuid,
  p_code text,
  p_units numeric,
  p_rate numeric,
  p_amount numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_ot numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_amount numeric := coalesce(p_amount, coalesce(p_units, 0) * coalesce(p_rate, 0));
  v_rate numeric := p_rate;
  v_code text := upper(trim(p_code));
  v_ot_type text;
  v_multiplier numeric;
  v_base text;
  v_hours_per_day numeric;
  v_year int;
  v_month int;
  v_period_start date;
  v_period_end date;
  v_days_in_month int;
  v_employee_id uuid;
  v_structure_id uuid;
  v_base_amount numeric := 0;
  v_base_hourly numeric := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_item_id is null or p_code is null or length(trim(p_code)) = 0 then
    raise exception 'payroll_item_id and code are required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_payroll_items pi
    where pi.id = p_payroll_item_id
      and pi.company_id = v_company_id
  ) then
    raise exception 'Payroll item not found';
  end if;

  v_ot_type := case
    when v_code in ('OT', 'OT_NORMAL') then 'normal'
    when v_code = 'OT_HOLIDAY' then 'holiday'
    else null
  end;

  if v_ot_type is not null and p_units is not null then
    select pi.employee_id,
           pr.year,
           pr.month,
           coalesce(pi.salary_basic, 0),
           coalesce(pi.salary_hra, 0),
           coalesce(pi.salary_allowances, 0)
      into v_employee_id, v_year, v_month, v_basic, v_hra, v_allowances
      from public.erp_payroll_items pi
      join public.erp_payroll_runs pr
        on pr.id = pi.payroll_run_id
     where pi.id = p_payroll_item_id
       and pi.company_id = v_company_id;

    v_period_start := make_date(v_year, v_month, 1);
    v_period_end := (v_period_start + interval '1 month - 1 day')::date;
    v_days_in_month := extract(day from (v_period_start + interval '1 month - 1 day'));

    select a.salary_structure_id
      into v_structure_id
      from public.erp_employee_salary_assignments a
     where a.company_id = v_company_id
       and a.employee_id = v_employee_id
       and a.effective_from <= v_period_end
       and (a.effective_to is null or a.effective_to >= v_period_start)
     order by a.effective_from desc
     limit 1;

    if v_structure_id is not null then
      select r.multiplier,
             r.base,
             r.hours_per_day
        into v_multiplier, v_base, v_hours_per_day
        from public.erp_salary_structure_ot_rules r
       where r.company_id = v_company_id
         and r.structure_id = v_structure_id
         and r.ot_type = v_ot_type
         and r.is_active = true
       order by r.created_at desc
       limit 1;
    end if;

    if v_multiplier is not null then
      v_base_amount := case when v_base = 'gross_hourly'
        then v_basic + v_hra + v_allowances
        else v_basic
      end;
      v_hours_per_day := coalesce(nullif(v_hours_per_day, 0), 8);
      if v_days_in_month > 0 and v_hours_per_day > 0 then
        v_base_hourly := v_base_amount / v_days_in_month / v_hours_per_day;
      else
        v_base_hourly := 0;
      end if;
      v_rate := v_base_hourly * v_multiplier;
      v_amount := coalesce(p_units, 0) * v_rate;
    end if;
  end if;

  insert into public.erp_payroll_item_lines (
    company_id,
    payroll_item_id,
    code,
    name,
    units,
    rate,
    amount,
    notes,
    created_by
  ) values (
    v_company_id,
    p_payroll_item_id,
    v_code,
    null,
    p_units,
    v_rate,
    v_amount,
    p_notes,
    v_actor
  )
  on conflict (company_id, payroll_item_id, code)
  do update set
    units = excluded.units,
    rate = excluded.rate,
    amount = excluded.amount,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_line_id;

  -- OT total
  select coalesce(sum(amount), 0)
    into v_ot
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY');

  -- salary base from payroll_items
  select
    coalesce(salary_basic, 0),
    coalesce(salary_hra, 0),
    coalesce(salary_allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  v_gross := v_basic + v_hra + v_allowances + v_ot;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;

  return v_line_id;
end;
$function$;

-- Drop ALL overloads and recreate canonical recalculation

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname='erp_payroll_item_recalculate'
  loop
    execute 'drop function if exists ' || r.sig || ';';
  end loop;
end $$;

create or replace function public.erp_payroll_item_recalculate(p_payroll_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_ot numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_item_id is null then
    raise exception 'payroll_item_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  select
    coalesce(salary_basic, 0),
    coalesce(salary_hra, 0),
    coalesce(salary_allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  if not found then
    raise exception 'Payroll item not found';
  end if;

  select coalesce(sum(amount), 0)
    into v_ot
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY');

  v_gross := v_basic + v_hra + v_allowances + v_ot;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;
end;
$function$;


drop function if exists public.erp_payroll_run_generate(uuid);

create function public.erp_payroll_run_generate(
  p_payroll_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_year int;
  v_month int;
  v_status text;
  v_period_start date;
  v_period_end date;
  v_days_in_month int;
  v_employee record;
  v_structure record;
  v_assignment record;
  v_existing record;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_lop_days numeric := 0;
  v_lop_deduction numeric := 0;
  v_daily_rate numeric := 0;
  v_notes text;
begin
  perform public.erp_require_payroll_writer();

  select year, month, status
    into v_year, v_month, v_status
  from public.erp_payroll_runs
  where id = p_payroll_run_id
    and company_id = v_company_id;

  if v_year is null then
    raise exception 'Payroll run not found';
  end if;

  if v_status = 'finalized' then
    raise exception 'Payroll run already finalized';
  end if;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  v_days_in_month := extract(day from (v_period_start + interval '1 month - 1 day'));

  for v_employee in
    select id
    from public.erp_employees
    where company_id = v_company_id
      and lifecycle_status = 'active'
  loop
    select a.salary_structure_id
      into v_assignment
      from public.erp_employee_salary_assignments a
     where a.company_id = v_company_id
       and a.employee_id = v_employee.id
       and a.effective_from <= v_period_end
       and (a.effective_to is null or a.effective_to >= v_period_start)
     order by a.effective_from desc
     limit 1;

    select *
      into v_structure
    from public.erp_salary_structures
    where company_id = v_company_id
      and id = v_assignment.salary_structure_id;

    select salary_basic,
           salary_hra,
           salary_allowances,
           deductions,
           notes
      into v_existing
    from public.erp_payroll_items
    where company_id = v_company_id
      and payroll_run_id = p_payroll_run_id
      and employee_id = v_employee.id;

    if v_structure.id is not null then
      v_basic := coalesce(v_structure.basic, 0);
      v_hra := coalesce(v_structure.hra, 0);
      v_allowances := coalesce(v_structure.allowances, 0);
      v_deductions := coalesce(v_structure.deductions, 0);
      v_notes := null;
    else
      v_basic := coalesce(v_existing.salary_basic, 0);
      v_hra := coalesce(v_existing.salary_hra, 0);
      v_allowances := coalesce(v_existing.salary_allowances, 0);
      v_deductions := coalesce(v_existing.deductions, 0);
      v_notes := coalesce(v_existing.notes, 'No salary structure');
    end if;

    v_gross := v_basic + v_hra + v_allowances;
    v_net := v_gross - v_deductions;

    select coalesce(sum(
      (least(lr.end_date, v_period_end) - greatest(lr.start_date, v_period_start) + 1)
    ), 0)
      into v_lop_days
    from public.erp_leave_requests lr
    join public.erp_leave_types lt
      on lt.company_id = lr.company_id
     and lt.code = lr.leave_type_code
    where lr.company_id = v_company_id
      and lr.employee_id = v_employee.id
      and lr.status = 'approved'
      and lt.is_paid = false
      and lt.is_active = true
      and lr.start_date <= v_period_end
      and lr.end_date >= v_period_start;

    v_daily_rate := case
      when v_days_in_month > 0 then (v_basic + v_hra + v_allowances) / v_days_in_month
      else 0
    end;
    v_lop_deduction := v_daily_rate * coalesce(v_lop_days, 0);
    v_deductions := coalesce(v_deductions, 0) + coalesce(v_lop_deduction, 0);
    v_net := v_gross - v_deductions;

    insert into public.erp_payroll_items (
      company_id,
      payroll_run_id,
      employee_id,
      salary_basic,
      salary_hra,
      salary_allowances,
      gross,
      deductions,
      net_pay,
      created_at,
      notes
    ) values (
      v_company_id,
      p_payroll_run_id,
      v_employee.id,
      v_basic,
      v_hra,
      v_allowances,
      v_gross,
      v_deductions,
      v_net,
      now(),
      v_notes
    )
    on conflict (company_id, payroll_run_id, employee_id)
    do update set
      salary_basic = excluded.salary_basic,
      salary_hra = excluded.salary_hra,
      salary_allowances = excluded.salary_allowances,
      gross = excluded.gross,
      deductions = excluded.deductions,
      net_pay = excluded.net_pay,
      notes = excluded.notes;
  end loop;
end;
$$;

revoke all on function public.erp_payroll_run_generate(uuid) from public;
grant execute on function public.erp_payroll_run_generate(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
