-- Leave types, leave requests, attendance days

create table if not exists public.erp_leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  code text not null,
  name text not null,
  is_paid boolean not null default true,
  accrual_policy text null,
  is_active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_leave_types_company_code_unique unique (company_id, code)
);

create table if not exists public.erp_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  leave_type_code text not null,
  start_date date not null,
  end_date date not null,
  days numeric(6, 2) null,
  reason text null,
  status text not null default 'draft',
  reviewer_user_id uuid null,
  reviewer_notes text null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_leave_requests_date_check
    check (start_date <= end_date),
  constraint erp_leave_requests_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled'))
);

create table if not exists public.erp_attendance_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  att_date date not null,
  status text not null,
  in_time time null,
  out_time time null,
  notes text null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_attendance_days_status_check
    check (status in ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekoff')),
  constraint erp_attendance_days_company_employee_date_unique
    unique (company_id, employee_id, att_date)
);

drop trigger if exists erp_leave_types_set_updated on public.erp_leave_types;
create trigger erp_leave_types_set_updated
before update on public.erp_leave_types
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_leave_requests_set_updated on public.erp_leave_requests;
create trigger erp_leave_requests_set_updated
before update on public.erp_leave_requests
for each row
execute function public.erp_hr_set_updated();

drop trigger if exists erp_attendance_days_set_updated on public.erp_attendance_days;
create trigger erp_attendance_days_set_updated
before update on public.erp_attendance_days
for each row
execute function public.erp_hr_set_updated();

alter table public.erp_leave_types enable row level security;
alter table public.erp_leave_types force row level security;
alter table public.erp_leave_requests enable row level security;
alter table public.erp_leave_requests force row level security;
alter table public.erp_attendance_days enable row level security;
alter table public.erp_attendance_days force row level security;

do $$
begin
  drop policy if exists erp_leave_types_select on public.erp_leave_types;
  drop policy if exists erp_leave_types_write on public.erp_leave_types;
  drop policy if exists erp_leave_requests_select on public.erp_leave_requests;
  drop policy if exists erp_leave_requests_write_hr on public.erp_leave_requests;
  drop policy if exists erp_leave_requests_write_self on public.erp_leave_requests;
  drop policy if exists erp_leave_requests_update_self on public.erp_leave_requests;
  drop policy if exists erp_leave_requests_delete_self on public.erp_leave_requests;
  drop policy if exists erp_attendance_days_select on public.erp_attendance_days;
  drop policy if exists erp_attendance_days_write on public.erp_attendance_days;

  create policy erp_leave_types_select
    on public.erp_leave_types
    for select
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
        and (is_active or public.erp_is_hr_admin(auth.uid()))
      )
    );

  create policy erp_leave_types_write
    on public.erp_leave_types
    for all
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and public.erp_is_hr_admin(auth.uid())
      )
    )
    with check (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_leave_requests_select
    on public.erp_leave_requests
    for select
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and (
          public.erp_is_hr_admin(auth.uid())
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = company_id
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
          )
          or exists (
            select 1
            from public.erp_employees e
            where e.company_id = company_id
              and e.id = employee_id
              and e.user_id = auth.uid()
          )
        )
      )
    );

  create policy erp_leave_requests_write_hr
    on public.erp_leave_requests
    for all
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    )
    with check (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_leave_requests_write_self
    on public.erp_leave_requests
    for insert
    with check (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and status in ('draft', 'submitted')
        and exists (
          select 1
          from public.erp_employees e
          where e.company_id = company_id
            and e.id = employee_id
            and e.user_id = auth.uid()
        )
      )
    );

  create policy erp_leave_requests_update_self
    on public.erp_leave_requests
    for update
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_employees e
          where e.company_id = company_id
            and e.id = employee_id
            and e.user_id = auth.uid()
        )
      )
    )
    with check (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and status in ('draft', 'submitted', 'cancelled')
        and exists (
          select 1
          from public.erp_employees e
          where e.company_id = company_id
            and e.id = employee_id
            and e.user_id = auth.uid()
        )
      )
    );

  create policy erp_leave_requests_delete_self
    on public.erp_leave_requests
    for delete
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and status in ('draft', 'submitted', 'cancelled')
        and exists (
          select 1
          from public.erp_employees e
          where e.company_id = company_id
            and e.id = employee_id
            and e.user_id = auth.uid()
        )
      )
    );

  create policy erp_attendance_days_select
    on public.erp_attendance_days
    for select
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and (
          exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = company_id
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
          )
          or exists (
            select 1
            from public.erp_employees e
            where e.company_id = company_id
              and e.id = employee_id
              and e.user_id = auth.uid()
          )
        )
      )
    );

  create policy erp_attendance_days_write
    on public.erp_attendance_days
    for all
    using (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    )
    with check (
      auth.role() = 'service_role'
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );
end;
$$;

create or replace function public.erp_leave_type_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_is_paid boolean,
  p_is_active boolean default true,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'code is required';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_leave_types (
      id,
      company_id,
      code,
      name,
      is_paid,
      is_active,
      notes,
      created_by,
      updated_by
    ) values (
      v_id,
      v_company_id,
      btrim(p_code),
      btrim(p_name),
      coalesce(p_is_paid, true),
      coalesce(p_is_active, true),
      p_notes,
      v_actor,
      v_actor
    );
  else
    update public.erp_leave_types
      set code = btrim(p_code),
          name = btrim(p_name),
          is_paid = coalesce(p_is_paid, true),
          is_active = coalesce(p_is_active, true),
          notes = p_notes
    where company_id = v_company_id
      and id = p_id;

    if not found then
      raise exception 'Leave type not found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_leave_type_upsert(uuid, text, text, boolean, boolean, text) from public;
grant execute on function public.erp_leave_type_upsert(uuid, text, text, boolean, boolean, text) to authenticated;

create or replace function public.erp_leave_request_submit(
  p_employee_id uuid,
  p_leave_type_code text,
  p_start_date date,
  p_end_date date,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_days numeric(6, 2);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'start and end dates are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'start_date must be before end_date';
  end if;

  if p_leave_type_code is null or btrim(p_leave_type_code) = '' then
    raise exception 'leave_type_code is required';
  end if;

  if p_employee_id is null then
    v_employee_id := public.erp_hr_my_employee_id();
  else
    v_employee_id := p_employee_id;
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.company_id = v_company_id
      and e.id = v_employee_id
  ) then
    raise exception 'Employee not found';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    if v_employee_id <> public.erp_hr_my_employee_id() then
      raise exception 'Not authorized to submit for this employee';
    end if;
  end if;

  if not exists (
    select 1
    from public.erp_leave_types lt
    where lt.company_id = v_company_id
      and lt.code = btrim(p_leave_type_code)
      and lt.is_active
  ) then
    raise exception 'Leave type not found';
  end if;

  v_days := (p_end_date - p_start_date + 1);

  insert into public.erp_leave_requests (
    id,
    company_id,
    employee_id,
    leave_type_code,
    start_date,
    end_date,
    days,
    reason,
    status,
    created_by,
    updated_by
  ) values (
    v_request_id,
    v_company_id,
    v_employee_id,
    btrim(p_leave_type_code),
    p_start_date,
    p_end_date,
    v_days,
    p_reason,
    'submitted',
    v_actor,
    v_actor
  );

  return v_request_id;
end;
$$;

revoke all on function public.erp_leave_request_submit(uuid, text, date, date, text) from public;
grant execute on function public.erp_leave_request_submit(uuid, text, date, date, text) to authenticated;

create or replace function public.erp_leave_request_set_status(
  p_request_id uuid,
  p_status text,
  p_reviewer_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_request record;
  v_is_hr boolean := false;
  v_is_manager boolean := false;
  v_actor_employee_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_status is null or p_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  select *
    into v_request
    from public.erp_leave_requests lr
   where lr.company_id = v_company_id
     and lr.id = p_request_id;

  if v_request.id is null then
    raise exception 'Leave request not found';
  end if;

  v_is_hr := exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  );

  if not v_is_hr then
    select e.id
      into v_actor_employee_id
      from public.erp_employees e
     where e.company_id = v_company_id
       and e.user_id = v_actor
     limit 1;

    if v_actor_employee_id is not null then
      v_is_manager := exists (
        select 1
        from public.erp_employees e
        where e.company_id = v_company_id
          and e.id = v_request.employee_id
          and e.manager_employee_id = v_actor_employee_id
      );
    end if;
  end if;

  if not v_is_hr and not v_is_manager then
    if p_status = 'cancelled' and exists (
      select 1
      from public.erp_employees e
      where e.company_id = v_company_id
        and e.id = v_request.employee_id
        and e.user_id = v_actor
    ) then
      null;
    else
      raise exception 'Not authorized';
    end if;
  end if;

  if v_is_manager and p_status = 'cancelled' then
    raise exception 'Not authorized';
  end if;

  if not v_is_hr and not v_is_manager and p_status in ('approved', 'rejected') then
    raise exception 'Not authorized';
  end if;

  update public.erp_leave_requests
     set status = p_status,
         reviewer_user_id = v_actor,
         reviewer_notes = p_reviewer_notes,
         reviewed_at = now()
   where company_id = v_company_id
     and id = p_request_id;
end;
$$;

revoke all on function public.erp_leave_request_set_status(uuid, text, text) from public;
grant execute on function public.erp_leave_request_set_status(uuid, text, text) to authenticated;

create or replace function public.erp_attendance_day_upsert(
  p_employee_id uuid,
  p_att_date date,
  p_status text,
  p_in_time time default null,
  p_out_time time default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null or p_att_date is null then
    raise exception 'employee_id and att_date are required';
  end if;

  if p_status is null or p_status not in ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekoff') then
    raise exception 'Invalid status';
  end if;

  v_allowed := exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  );

  if not v_allowed then
    raise exception 'Not authorized';
  end if;

  insert into public.erp_attendance_days (
    id,
    company_id,
    employee_id,
    att_date,
    status,
    in_time,
    out_time,
    notes,
    source,
    created_by,
    updated_by
  ) values (
    v_id,
    v_company_id,
    p_employee_id,
    p_att_date,
    p_status,
    p_in_time,
    p_out_time,
    p_notes,
    'manual',
    v_actor,
    v_actor
  )
  on conflict (company_id, employee_id, att_date)
  do update set
    status = excluded.status,
    in_time = excluded.in_time,
    out_time = excluded.out_time,
    notes = excluded.notes,
    source = excluded.source
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_attendance_day_upsert(uuid, date, text, time, time, text) from public;
grant execute on function public.erp_attendance_day_upsert(uuid, date, text, time, time, text) to authenticated;

notify pgrst, 'reload schema';
