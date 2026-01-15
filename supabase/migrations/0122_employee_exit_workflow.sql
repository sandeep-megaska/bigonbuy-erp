begin;

create table if not exists public.erp_hr_employee_exit_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_exit_types_company_code_key unique (company_id, code),
  constraint erp_hr_employee_exit_types_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_employee_exit_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_exit_reasons_company_code_key unique (company_id, code),
  constraint erp_hr_employee_exit_reasons_company_name_key unique (company_id, name)
);

create table if not exists public.erp_hr_employee_exits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  employee_id uuid not null references public.erp_employees(id) on delete cascade,
  exit_type_id uuid not null references public.erp_hr_employee_exit_types(id),
  exit_reason_id uuid null references public.erp_hr_employee_exit_reasons(id),
  initiated_by_user_id uuid not null,
  status text not null default 'draft',
  initiated_on date not null default current_date,
  last_working_day date not null,
  notice_period_days int null,
  notice_waived boolean not null default false,
  manager_employee_id uuid null references public.erp_employees(id),
  approved_by_user_id uuid null,
  approved_at timestamptz null,
  rejected_by_user_id uuid null,
  rejected_at timestamptz null,
  rejection_reason text null,
  completed_by_user_id uuid null,
  completed_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_employee_exits_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'completed', 'withdrawn'))
);

alter table public.erp_employees
  add column if not exists exit_date date;

drop trigger if exists erp_hr_employee_exit_types_set_updated_at
  on public.erp_hr_employee_exit_types;
create trigger erp_hr_employee_exit_types_set_updated_at
before update on public.erp_hr_employee_exit_types
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_employee_exit_reasons_set_updated_at
  on public.erp_hr_employee_exit_reasons;
create trigger erp_hr_employee_exit_reasons_set_updated_at
before update on public.erp_hr_employee_exit_reasons
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_employee_exits_set_updated_at
  on public.erp_hr_employee_exits;
create trigger erp_hr_employee_exits_set_updated_at
before update on public.erp_hr_employee_exits
for each row
execute function public.erp_set_updated_at();

alter table public.erp_hr_employee_exit_types enable row level security;
alter table public.erp_hr_employee_exit_types force row level security;

alter table public.erp_hr_employee_exit_reasons enable row level security;
alter table public.erp_hr_employee_exit_reasons force row level security;

alter table public.erp_hr_employee_exits enable row level security;
alter table public.erp_hr_employee_exits force row level security;

do $$
begin
  drop policy if exists erp_hr_employee_exit_types_select on public.erp_hr_employee_exit_types;
  drop policy if exists erp_hr_employee_exit_types_write on public.erp_hr_employee_exit_types;
  drop policy if exists erp_hr_employee_exit_reasons_select on public.erp_hr_employee_exit_reasons;
  drop policy if exists erp_hr_employee_exit_reasons_write on public.erp_hr_employee_exit_reasons;
  drop policy if exists erp_hr_employee_exits_select on public.erp_hr_employee_exits;
  drop policy if exists erp_hr_employee_exits_write on public.erp_hr_employee_exits;

  create policy erp_hr_employee_exit_types_select
    on public.erp_hr_employee_exit_types
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_hr_employee_exit_types_write
    on public.erp_hr_employee_exit_types
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    );

  create policy erp_hr_employee_exit_reasons_select
    on public.erp_hr_employee_exit_reasons
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_hr_employee_exit_reasons_write
    on public.erp_hr_employee_exit_reasons
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    );

  create policy erp_hr_employee_exits_select
    on public.erp_hr_employee_exits
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_hr_employee_exits_write
    on public.erp_hr_employee_exits
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_writer() is null
      )
    );
end $$;

insert into public.erp_hr_employee_exit_types (company_id, code, name, sort_order)
select
  public.erp_current_company_id(),
  defaults.code,
  defaults.name,
  defaults.sort_order
from (
  values
    ('RESIGNATION', 'Resignation', 1),
    ('TERMINATION', 'Termination', 2),
    ('END_OF_CONTRACT', 'End of Contract', 3),
    ('RETIREMENT', 'Retirement', 4),
    ('ABSCONDING', 'Absconding', 5)
) as defaults(code, name, sort_order)
where public.erp_current_company_id() is not null
  and not exists (
    select 1
    from public.erp_hr_employee_exit_types t
    where t.company_id = public.erp_current_company_id()
      and t.code = defaults.code
  );

insert into public.erp_hr_employee_exit_reasons (company_id, code, name, sort_order)
select
  public.erp_current_company_id(),
  defaults.code,
  defaults.name,
  defaults.sort_order
from (
  values
    ('PERSONAL', 'Personal', 1),
    ('BETTER_OPPORTUNITY', 'Better opportunity', 2),
    ('PERFORMANCE', 'Performance', 3),
    ('MISCONDUCT', 'Misconduct', 4),
    ('HEALTH', 'Health', 5),
    ('RELOCATION', 'Relocation', 6)
) as defaults(code, name, sort_order)
where public.erp_current_company_id() is not null
  and not exists (
    select 1
    from public.erp_hr_employee_exit_reasons r
    where r.company_id = public.erp_current_company_id()
      and r.code = defaults.code
  );

create or replace function public.erp_hr_employee_exit_create(
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid,
  p_last_working_day date,
  p_notice_period_days int,
  p_notice_waived boolean,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_exit_id uuid;
  v_manager_employee_id uuid;
begin
  perform public.erp_require_hr_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_exit_type_id is null then
    raise exception 'exit_type_id is required';
  end if;

  if p_last_working_day is null then
    raise exception 'last_working_day is required';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Invalid employee_id';
  end if;

  if not exists (
    select 1
    from public.erp_hr_employee_exit_types t
    where t.id = p_exit_type_id
      and t.company_id = v_company_id
      and t.is_active
  ) then
    raise exception 'Invalid exit_type_id';
  end if;

  if p_exit_reason_id is not null then
    if not exists (
      select 1
      from public.erp_hr_employee_exit_reasons r
      where r.id = p_exit_reason_id
        and r.company_id = v_company_id
        and r.is_active
    ) then
      raise exception 'Invalid exit_reason_id';
    end if;
  end if;

  select j.manager_employee_id
    into v_manager_employee_id
  from public.erp_employee_jobs j
  where j.company_id = v_company_id
    and j.employee_id = p_employee_id
  order by j.effective_from desc, j.created_at desc
  limit 1;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_period_days,
    notice_waived,
    manager_employee_id,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    p_exit_type_id,
    p_exit_reason_id,
    v_actor,
    'draft',
    current_date,
    p_last_working_day,
    p_notice_period_days,
    coalesce(p_notice_waived, false),
    v_manager_employee_id,
    p_notes
  )
  returning id into v_exit_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_hr_employee_exit_create(uuid, uuid, uuid, date, int, boolean, text) from public;
grant execute on function public.erp_hr_employee_exit_create(uuid, uuid, uuid, date, int, boolean, text) to authenticated;

create or replace function public.erp_hr_employee_exit_submit(
  p_exit_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_hr_writer();

  update public.erp_hr_employee_exits
     set status = 'submitted'
   where id = p_exit_id
     and company_id = v_company_id
     and status = 'draft';

  if not found then
    raise exception 'Exit request must be in draft status';
  end if;
end;
$$;

revoke all on function public.erp_hr_employee_exit_submit(uuid) from public;
grant execute on function public.erp_hr_employee_exit_submit(uuid) to authenticated;

create or replace function public.erp_hr_employee_exit_approve(
  p_exit_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_is_hr boolean;
  v_is_manager boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select e.employee_id
    into v_employee_id
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id
    and e.company_id = v_company_id;

  if v_employee_id is null then
    raise exception 'Exit request not found';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_hr;

  if not v_is_hr then
    select exists (
      select 1
      from (
        select j.manager_employee_id
        from public.erp_employee_jobs j
        where j.company_id = v_company_id
          and j.employee_id = v_employee_id
        order by j.effective_from desc, j.created_at desc
        limit 1
      ) as current_job
      join public.erp_employee_users eu
        on eu.employee_id = current_job.manager_employee_id
       and eu.user_id = v_actor
       and coalesce(eu.is_active, true)
    ) into v_is_manager;
  end if;

  if not v_is_hr and not coalesce(v_is_manager, false) then
    raise exception 'Not authorized';
  end if;

  update public.erp_hr_employee_exits
     set status = 'approved',
         approved_by_user_id = v_actor,
         approved_at = now()
   where id = p_exit_id
     and company_id = v_company_id
     and status = 'submitted';

  if not found then
    raise exception 'Exit request must be submitted for approval';
  end if;
end;
$$;

revoke all on function public.erp_hr_employee_exit_approve(uuid) from public;
grant execute on function public.erp_hr_employee_exit_approve(uuid) to authenticated;

create or replace function public.erp_hr_employee_exit_reject(
  p_exit_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_is_hr boolean;
  v_is_manager boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select e.employee_id
    into v_employee_id
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id
    and e.company_id = v_company_id;

  if v_employee_id is null then
    raise exception 'Exit request not found';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) into v_is_hr;

  if not v_is_hr then
    select exists (
      select 1
      from (
        select j.manager_employee_id
        from public.erp_employee_jobs j
        where j.company_id = v_company_id
          and j.employee_id = v_employee_id
        order by j.effective_from desc, j.created_at desc
        limit 1
      ) as current_job
      join public.erp_employee_users eu
        on eu.employee_id = current_job.manager_employee_id
       and eu.user_id = v_actor
       and coalesce(eu.is_active, true)
    ) into v_is_manager;
  end if;

  if not v_is_hr and not coalesce(v_is_manager, false) then
    raise exception 'Not authorized';
  end if;

  update public.erp_hr_employee_exits
     set status = 'rejected',
         rejected_by_user_id = v_actor,
         rejected_at = now(),
         rejection_reason = p_reason
   where id = p_exit_id
     and company_id = v_company_id
     and status = 'submitted';

  if not found then
    raise exception 'Exit request must be submitted for rejection';
  end if;
end;
$$;

revoke all on function public.erp_hr_employee_exit_reject(uuid, text) from public;
grant execute on function public.erp_hr_employee_exit_reject(uuid, text) to authenticated;

create or replace function public.erp_hr_employee_exit_complete(
  p_exit_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_last_working_day date;
begin
  perform public.erp_require_hr_writer();

  select e.employee_id, e.last_working_day
    into v_employee_id, v_last_working_day
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id
    and e.company_id = v_company_id
    and e.status = 'approved';

  if v_employee_id is null then
    raise exception 'Exit request must be approved before completion';
  end if;

  update public.erp_hr_employee_exits
     set status = 'completed',
         completed_by_user_id = v_actor,
         completed_at = now()
   where id = p_exit_id
     and company_id = v_company_id;

  update public.erp_employees
     set exit_date = v_last_working_day,
         lifecycle_status = 'exited'
   where id = v_employee_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_employee_exit_complete(uuid) from public;
grant execute on function public.erp_hr_employee_exit_complete(uuid) to authenticated;

commit;
