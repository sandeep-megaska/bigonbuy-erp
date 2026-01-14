-- 0078_fix_leave_attendance_rpcs_defaults.sql
-- Fix Postgres rule: parameters after a default must also have defaults
-- Recreate leave/attendance RPCs with valid signatures.

begin;

-- 1) LEAVE TYPE UPSERT -----------------------------------------------------

drop function if exists public.erp_leave_type_upsert(uuid,text,text,boolean,boolean,text);
drop function if exists public.erp_leave_type_upsert(text,text,boolean,boolean,text,uuid);
drop function if exists public.erp_leave_type_upsert(uuid,text,text,boolean,boolean);
drop function if exists public.erp_leave_type_upsert(text,text,boolean,boolean);

-- Canonical signature (no default in the middle; optional p_id at the end with default)
create or replace function public.erp_leave_type_upsert(
  p_code text,
  p_name text,
  p_is_paid boolean,
  p_is_active boolean default true,
  p_notes text default null,
  p_id uuid default null
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
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_leave_types(company_id, code, name, is_paid, is_active, notes)
    values (v_company_id, trim(p_code), trim(p_name), p_is_paid, coalesce(p_is_active, true), p_notes)
    on conflict (company_id, code)
    do update set
      name = excluded.name,
      is_paid = excluded.is_paid,
      is_active = excluded.is_active,
      notes = excluded.notes
    returning id into v_id;
  else
    update public.erp_leave_types lt
    set code = trim(p_code),
        name = trim(p_name),
        is_paid = p_is_paid,
        is_active = coalesce(p_is_active, true),
        notes = p_notes
    where lt.company_id = v_company_id
      and lt.id = p_id
    returning lt.id into v_id;

    if v_id is null then
      raise exception 'Leave type not found';
    end if;
  end if;

  return v_id;
end;
$$;

-- 2) LEAVE REQUEST SUBMIT --------------------------------------------------

drop function if exists public.erp_leave_request_submit(uuid,text,date,date,text);
drop function if exists public.erp_leave_request_submit(uuid,text,date,date);

create or replace function public.erp_leave_request_submit(
  p_employee_id uuid,
  p_leave_type_code text,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_request_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_leave_type_code is null or length(trim(p_leave_type_code)) = 0 then
    raise exception 'leave_type_code is required';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'start_date and end_date are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'start_date cannot be after end_date';
  end if;

  -- Auth: employee can submit for self; HR/Admin can submit for anyone
  if not (
    exists (
      select 1
      from public.erp_employees e
      where e.company_id = v_company_id
        and e.id = p_employee_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = v_actor
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner','admin','hr','payroll')
    )
  ) then
    raise exception 'Not authorized';
  end if;

  -- Leave type must exist and be active
  if not exists (
    select 1
    from public.erp_leave_types lt
    where lt.company_id = v_company_id
      and lt.code = trim(p_leave_type_code)
      and lt.is_active = true
  ) then
    raise exception 'Leave type not found or inactive';
  end if;

  insert into public.erp_leave_requests(
    company_id, employee_id, leave_type_code, start_date, end_date, reason, status
  ) values (
    v_company_id, p_employee_id, trim(p_leave_type_code), p_start_date, p_end_date, p_reason, 'submitted'
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- 3) LEAVE REQUEST SET STATUS (approve/reject/cancel) ----------------------

drop function if exists public.erp_leave_request_set_status(uuid,text,text);

create or replace function public.erp_leave_request_set_status(
  p_request_id uuid,
  p_status text,
  p_reviewer_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_current_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'request_id is required';
  end if;

  if p_status is null or length(trim(p_status)) = 0 then
    raise exception 'status is required';
  end if;

  p_status := lower(trim(p_status));

  if p_status not in ('approved','rejected','cancelled') then
    raise exception 'Invalid status. Allowed: approved, rejected, cancelled';
  end if;

  -- Only HR/Admin/Payroll can approve/reject; cancellation also allowed by HR
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

  select lr.status
    into v_current_status
  from public.erp_leave_requests lr
  where lr.company_id = v_company_id
    and lr.id = p_request_id;

  if v_current_status is null then
    raise exception 'Leave request not found';
  end if;

  update public.erp_leave_requests lr
  set status = p_status,
      reviewer_notes = p_reviewer_notes,
      reviewed_at = now(),
      reviewed_by = v_actor
  where lr.company_id = v_company_id
    and lr.id = p_request_id;
end;
$$;

-- 4) ATTENDANCE DAY UPSERT -------------------------------------------------

drop function if exists public.erp_attendance_day_upsert(uuid,date,text,time,time,text);

create or replace function public.erp_attendance_day_upsert(
  p_employee_id uuid,
  p_att_date date,
  p_status text,
  p_in_time time default null,
  p_out_time time default null,
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
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_att_date is null then
    raise exception 'att_date is required';
  end if;

  if p_status is null or length(trim(p_status)) = 0 then
    raise exception 'status is required';
  end if;

  p_status := lower(trim(p_status));

  if p_status not in ('present','absent','half_day','leave','holiday','weekoff') then
    raise exception 'Invalid attendance status';
  end if;

  insert into public.erp_attendance_days(
    company_id, employee_id, att_date, status, in_time, out_time, notes, source, created_at, created_by
  ) values (
    v_company_id, p_employee_id, p_att_date, p_status, p_in_time, p_out_time, p_notes, 'manual', now(), v_actor
  )
  on conflict (company_id, employee_id, att_date)
  do update set
    status = excluded.status,
    in_time = excluded.in_time,
    out_time = excluded.out_time,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

commit;
