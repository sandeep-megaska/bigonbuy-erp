-- Leave types, leave requests, and attendance day tracking

create table if not exists public.erp_leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  code text not null,
  name text not null,
  is_paid boolean not null default true,
  is_active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now()
);

create unique index if not exists erp_leave_types_company_code_key
  on public.erp_leave_types (company_id, code);

create table if not exists public.erp_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  leave_type_code text not null,
  start_date date not null,
  end_date date not null,
  days numeric not null default 0,
  reason text null,
  status text not null default 'draft',
  reviewer_notes text null,
  reviewed_at timestamptz null,
  reviewed_by uuid null,
  created_at timestamptz not null default now(),
  constraint erp_leave_requests_date_check
    check (start_date <= end_date),
  constraint erp_leave_requests_status_check
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled'))
);

create index if not exists erp_leave_requests_company_employee_start_idx
  on public.erp_leave_requests (company_id, employee_id, start_date);

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
  created_by uuid null default auth.uid(),
  updated_at timestamptz null,
  updated_by uuid null,
  constraint erp_attendance_days_status_check
    check (status in ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekoff')),
  constraint erp_attendance_days_company_employee_date_key
    unique (company_id, employee_id, att_date)
);

-- RLS
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
  drop policy if exists erp_leave_requests_insert_self on public.erp_leave_requests;
  drop policy if exists erp_leave_requests_update_self on public.erp_leave_requests;
  drop policy if exists erp_attendance_days_select on public.erp_attendance_days;
  drop policy if exists erp_attendance_days_write on public.erp_attendance_days;

  create policy erp_leave_types_select
    on public.erp_leave_types
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_leave_types.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
      and (
        erp_leave_types.is_active
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_leave_types.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_leave_types_write
    on public.erp_leave_types
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_leave_types.company_id
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
          where cu.company_id = erp_leave_types.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_leave_requests_select
    on public.erp_leave_requests
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_leave_requests.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
        or exists (
          select 1
          from public.erp_employees e
          where e.id = erp_leave_requests.employee_id
            and e.company_id = erp_leave_requests.company_id
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = erp_leave_requests.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_leave_requests_write_hr
    on public.erp_leave_requests
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_leave_requests.company_id
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
          where cu.company_id = erp_leave_requests.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );

  create policy erp_leave_requests_insert_self
    on public.erp_leave_requests
    for insert
    with check (
      company_id = public.erp_current_company_id()
      and status in ('draft', 'submitted')
      and (
        exists (
          select 1
          from public.erp_employees e
          where e.id = erp_leave_requests.employee_id
            and e.company_id = erp_leave_requests.company_id
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = erp_leave_requests.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_leave_requests_update_self
    on public.erp_leave_requests
    for update
    using (
      company_id = public.erp_current_company_id()
      and status in ('draft', 'submitted')
      and (
        exists (
          select 1
          from public.erp_employees e
          where e.id = erp_leave_requests.employee_id
            and e.company_id = erp_leave_requests.company_id
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = erp_leave_requests.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and status in ('draft', 'submitted', 'cancelled')
      and (
        exists (
          select 1
          from public.erp_employees e
          where e.id = erp_leave_requests.employee_id
            and e.company_id = erp_leave_requests.company_id
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = erp_leave_requests.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_attendance_days_select
    on public.erp_attendance_days
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_attendance_days.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
        or exists (
          select 1
          from public.erp_employees e
          where e.id = erp_attendance_days.employee_id
            and e.company_id = erp_attendance_days.company_id
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = erp_attendance_days.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_attendance_days_write
    on public.erp_attendance_days
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_attendance_days.company_id
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
          where cu.company_id = erp_attendance_days.company_id
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );
end
$$;

-- RPCs
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
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
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

  if p_code is null or trim(p_code) = '' then
    raise exception 'Leave type code is required';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'Leave type name is required';
  end if;

  if p_id is null then
    insert into public.erp_leave_types (
      company_id,
      code,
      name,
      is_paid,
      is_active,
      notes
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      coalesce(p_is_paid, true),
      coalesce(p_is_active, true),
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_id;
  else
    update public.erp_leave_types
       set code = trim(p_code),
           name = trim(p_name),
           is_paid = coalesce(p_is_paid, true),
           is_active = coalesce(p_is_active, true),
           notes = nullif(trim(coalesce(p_notes, '')), '')
     where id = p_id
       and company_id = v_company_id
     returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'Leave type not found';
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
  v_request_id uuid := gen_random_uuid();
  v_days numeric;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Start and end dates are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'Invalid date range';
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
    from public.erp_leave_types lt
    where lt.company_id = v_company_id
      and lt.code = p_leave_type_code
      and lt.is_active
  ) then
    raise exception 'Leave type not found';
  end if;

  if not (
    exists (
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
      where e.id = p_employee_id
        and e.company_id = v_company_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_employee_users eu
      where eu.employee_id = p_employee_id
        and eu.user_id = v_actor
        and coalesce(eu.is_active, true)
    )
  ) then
    raise exception 'Not authorized to submit for this employee';
  end if;

  v_days := (p_end_date - p_start_date + 1);
  if v_days <= 0 then
    raise exception 'Invalid leave duration';
  end if;

  insert into public.erp_leave_requests (
    id,
    company_id,
    employee_id,
    leave_type_code,
    start_date,
    end_date,
    days,
    reason,
    status
  ) values (
    v_request_id,
    v_company_id,
    p_employee_id,
    p_leave_type_code,
    p_start_date,
    p_end_date,
    v_days,
    nullif(trim(coalesce(p_reason, '')), ''),
    'submitted'
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
  v_is_hr boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_status is null or p_status not in ('draft', 'submitted', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  select *
    into v_request
  from public.erp_leave_requests
  where id = p_request_id
    and company_id = v_company_id;

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

  if p_status in ('approved', 'rejected') and not v_is_hr then
    raise exception 'Not authorized to approve or reject';
  end if;

  if p_status = 'cancelled' and not (
    v_is_hr
    or exists (
      select 1
      from public.erp_employees e
      where e.id = v_request.employee_id
        and e.company_id = v_company_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_employee_users eu
      where eu.employee_id = v_request.employee_id
        and eu.user_id = v_actor
        and coalesce(eu.is_active, true)
    )
  ) then
    raise exception 'Not authorized to cancel';
  end if;

  update public.erp_leave_requests
     set status = p_status,
         reviewer_notes = nullif(trim(coalesce(p_reviewer_notes, '')), ''),
         reviewed_at = case when p_status in ('approved', 'rejected') then now() else null end,
         reviewed_by = case when p_status in ('approved', 'rejected') then v_actor else null end
   where id = p_request_id
     and company_id = v_company_id;
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
  v_row_id uuid;
  v_is_hr boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null or p_att_date is null then
    raise exception 'Employee and date are required';
  end if;

  if p_status is null or p_status not in ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekoff') then
    raise exception 'Invalid attendance status';
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

  insert into public.erp_attendance_days (
    company_id,
    employee_id,
    att_date,
    status,
    in_time,
    out_time,
    notes,
    source,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    p_att_date,
    p_status,
    p_in_time,
    p_out_time,
    nullif(trim(coalesce(p_notes, '')), ''),
    'manual',
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, employee_id, att_date)
  do update set
    status = excluded.status,
    in_time = excluded.in_time,
    out_time = excluded.out_time,
    notes = excluded.notes,
    source = excluded.source,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_row_id;

  return v_row_id;
end;
$$;

revoke all on function public.erp_attendance_day_upsert(uuid, date, text, time, time, text) from public;
grant execute on function public.erp_attendance_day_upsert(uuid, date, text, time, time, text) to authenticated;

notify pgrst, 'reload schema';
