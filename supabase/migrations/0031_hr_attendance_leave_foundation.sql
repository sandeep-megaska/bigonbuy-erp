-- 0031_hr_attendance_leave_foundation.sql

create table if not exists public.erp_hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  key text not null,
  name text not null,
  is_paid boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_leave_types_company_key_unique unique (company_id, key)
);

create table if not exists public.erp_hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id),
  leave_type_id uuid not null references public.erp_hr_leave_types (id),
  date_from date not null,
  date_to date not null,
  reason text null,
  status text not null,
  approver_user_id uuid null,
  decided_at timestamptz null,
  decision_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_leave_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

create table if not exists public.erp_hr_attendance_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id),
  day date not null,
  status text not null,
  check_in_at timestamptz null,
  check_out_at timestamptz null,
  notes text null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_attendance_days_status_check
    check (status in ('present', 'absent', 'weekly_off', 'holiday', 'leave')),
  constraint erp_hr_attendance_days_company_employee_day_unique
    unique (company_id, employee_id, day)
);

drop trigger if exists erp_hr_leave_types_set_updated_at on public.erp_hr_leave_types;
create trigger erp_hr_leave_types_set_updated_at
before update on public.erp_hr_leave_types
for each row execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_leave_requests_set_updated_at on public.erp_hr_leave_requests;
create trigger erp_hr_leave_requests_set_updated_at
before update on public.erp_hr_leave_requests
for each row execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_attendance_days_set_updated_at on public.erp_hr_attendance_days;
create trigger erp_hr_attendance_days_set_updated_at
before update on public.erp_hr_attendance_days
for each row execute function public.erp_set_updated_at();

create or replace function public.erp_hr_my_employee_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_user_id uuid := auth.uid();
  v_employee_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select e.id
    into v_employee_id
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.user_id = v_user_id
   limit 1;

  if v_employee_id is null then
    raise exception 'Employee not found for current user';
  end if;

  return v_employee_id;
end;
$$;

revoke all on function public.erp_hr_my_employee_id() from public;
grant execute on function public.erp_hr_my_employee_id() to authenticated;

create or replace function public.erp_hr_leave_types_list()
returns table (
  id uuid,
  key text,
  name text,
  is_paid boolean,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_company_user();

  return query
  select
    lt.id,
    lt.key,
    lt.name,
    lt.is_paid,
    lt.is_active,
    lt.created_at,
    lt.updated_at
  from public.erp_hr_leave_types lt
  where lt.company_id = v_company_id
  order by lt.name asc;
end;
$$;

revoke all on function public.erp_hr_leave_types_list() from public;
grant execute on function public.erp_hr_leave_types_list() to authenticated;

create or replace function public.erp_hr_leave_request_create(
  p_leave_type_id uuid,
  p_date_from date,
  p_date_to date,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
  v_request_id uuid := gen_random_uuid();
begin
  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Invalid date range';
  end if;

  if not exists (
    select 1
      from public.erp_hr_leave_types lt
     where lt.id = p_leave_type_id
       and lt.company_id = v_company_id
       and lt.is_active
  ) then
    raise exception 'Leave type not found';
  end if;

  insert into public.erp_hr_leave_requests (
    id,
    company_id,
    employee_id,
    leave_type_id,
    date_from,
    date_to,
    reason,
    status
  ) values (
    v_request_id,
    v_company_id,
    v_employee_id,
    p_leave_type_id,
    p_date_from,
    p_date_to,
    p_reason,
    'pending'
  );

  return v_request_id;
end;
$$;

revoke all on function public.erp_hr_leave_request_create(uuid, date, date, text) from public;
grant execute on function public.erp_hr_leave_request_create(uuid, date, date, text) to authenticated;

create or replace function public.erp_hr_leave_request_cancel(
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
  v_status text;
begin
  select lr.status
    into v_status
    from public.erp_hr_leave_requests lr
   where lr.id = p_request_id
     and lr.company_id = v_company_id
     and lr.employee_id = v_employee_id;

  if v_status is null then
    raise exception 'Leave request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Only pending requests can be cancelled';
  end if;

  update public.erp_hr_leave_requests
     set status = 'cancelled',
         updated_at = now()
   where id = p_request_id
     and company_id = v_company_id
     and employee_id = v_employee_id;
end;
$$;

revoke all on function public.erp_hr_leave_request_cancel(uuid) from public;
grant execute on function public.erp_hr_leave_request_cancel(uuid) to authenticated;

create or replace function public.erp_hr_leave_requests_list_my()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  leave_type_id uuid,
  leave_type_name text,
  date_from date,
  date_to date,
  reason text,
  status text,
  approver_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
begin
  return query
  select
    lr.id,
    lr.employee_id,
    e.full_name,
    lr.leave_type_id,
    lt.name,
    lr.date_from,
    lr.date_to,
    lr.reason,
    lr.status,
    lr.approver_user_id,
    lr.decided_at,
    lr.decision_note,
    lr.created_at,
    lr.updated_at
  from public.erp_hr_leave_requests lr
  join public.erp_employees e
    on e.id = lr.employee_id
  join public.erp_hr_leave_types lt
    on lt.id = lr.leave_type_id
  where lr.company_id = v_company_id
    and lr.employee_id = v_employee_id
  order by lr.date_from desc, lr.created_at desc;
end;
$$;

revoke all on function public.erp_hr_leave_requests_list_my() from public;
grant execute on function public.erp_hr_leave_requests_list_my() to authenticated;

create or replace function public.erp_hr_leave_requests_list_team()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  leave_type_id uuid,
  leave_type_name text,
  date_from date,
  date_to date,
  reason text,
  status text,
  approver_user_id uuid,
  decided_at timestamptz,
  decision_note text,
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
  v_employee_id uuid := public.erp_hr_my_employee_id();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if public.erp_is_hr_admin(v_actor) then
    return query
    select
      lr.id,
      lr.employee_id,
      e.full_name,
      lr.leave_type_id,
      lt.name,
      lr.date_from,
      lr.date_to,
      lr.reason,
      lr.status,
      lr.approver_user_id,
      lr.decided_at,
      lr.decision_note,
      lr.created_at,
      lr.updated_at
    from public.erp_hr_leave_requests lr
    join public.erp_employees e
      on e.id = lr.employee_id
    join public.erp_hr_leave_types lt
      on lt.id = lr.leave_type_id
    where lr.company_id = v_company_id
      and lr.status in ('pending', 'approved', 'rejected')
    order by lr.date_from desc, lr.created_at desc;
  end if;

  return query
  select
    lr.id,
    lr.employee_id,
    e.full_name,
    lr.leave_type_id,
    lt.name,
    lr.date_from,
    lr.date_to,
    lr.reason,
    lr.status,
    lr.approver_user_id,
    lr.decided_at,
    lr.decision_note,
    lr.created_at,
    lr.updated_at
  from public.erp_hr_leave_requests lr
  join public.erp_employees e
    on e.id = lr.employee_id
  join public.erp_hr_leave_types lt
    on lt.id = lr.leave_type_id
  where lr.company_id = v_company_id
    and e.manager_employee_id = v_employee_id
    and lr.status in ('pending', 'approved', 'rejected')
  order by lr.date_from desc, lr.created_at desc;
end;
$$;

revoke all on function public.erp_hr_leave_requests_list_team() from public;
grant execute on function public.erp_hr_leave_requests_list_team() to authenticated;

create or replace function public.erp_hr_leave_request_decide(
  p_request_id uuid,
  p_decision text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid := public.erp_hr_my_employee_id();
  v_request public.erp_hr_leave_requests;
  v_is_hr_admin boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select *
    into v_request
    from public.erp_hr_leave_requests lr
   where lr.id = p_request_id
     and lr.company_id = v_company_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  v_is_hr_admin := public.erp_is_hr_admin(v_actor);

  if not v_is_hr_admin then
    if v_request.status <> 'pending' then
      raise exception 'Only pending requests can be decided by managers';
    end if;

    if not exists (
      select 1
        from public.erp_employees e
       where e.id = v_request.employee_id
         and e.company_id = v_company_id
         and e.manager_employee_id = v_employee_id
    ) then
      raise exception 'Not authorized to decide this request';
    end if;
  end if;

  update public.erp_hr_leave_requests
     set status = p_decision,
         approver_user_id = v_actor,
         decided_at = now(),
         decision_note = p_note,
         updated_at = now()
   where id = p_request_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_leave_request_decide(uuid, text, text) from public;
grant execute on function public.erp_hr_leave_request_decide(uuid, text, text) to authenticated;

create or replace function public.erp_hr_attendance_list_my(
  p_from date default (current_date - 30),
  p_to date default current_date
) returns table (
  day date,
  status text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  notes text,
  source text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
begin
  if p_from is null or p_to is null then
    raise exception 'Date range is required';
  end if;

  if p_from > p_to then
    raise exception 'Invalid date range';
  end if;

  return query
  select
    ad.day,
    ad.status,
    ad.check_in_at,
    ad.check_out_at,
    ad.notes,
    ad.source,
    ad.created_at,
    ad.updated_at
  from public.erp_hr_attendance_days ad
  where ad.company_id = v_company_id
    and ad.employee_id = v_employee_id
    and ad.day between p_from and p_to
  order by ad.day desc;
end;
$$;

revoke all on function public.erp_hr_attendance_list_my(date, date) from public;
grant execute on function public.erp_hr_attendance_list_my(date, date) to authenticated;

create or replace function public.erp_hr_attendance_check_in()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
  v_now timestamptz := now();
begin
  insert into public.erp_hr_attendance_days (
    company_id,
    employee_id,
    day,
    status,
    check_in_at,
    source
  ) values (
    v_company_id,
    v_employee_id,
    current_date,
    'present',
    v_now,
    'manual'
  )
  on conflict (company_id, employee_id, day) do update
    set status = 'present',
        check_in_at = coalesce(public.erp_hr_attendance_days.check_in_at, excluded.check_in_at),
        updated_at = now();
end;
$$;

revoke all on function public.erp_hr_attendance_check_in() from public;
grant execute on function public.erp_hr_attendance_check_in() to authenticated;

create or replace function public.erp_hr_attendance_check_out()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid := public.erp_hr_my_employee_id();
  v_now timestamptz := now();
begin
  insert into public.erp_hr_attendance_days (
    company_id,
    employee_id,
    day,
    status,
    check_out_at,
    source
  ) values (
    v_company_id,
    v_employee_id,
    current_date,
    'present',
    v_now,
    'manual'
  )
  on conflict (company_id, employee_id, day) do update
    set status = 'present',
        check_out_at = excluded.check_out_at,
        updated_at = now();
end;
$$;

revoke all on function public.erp_hr_attendance_check_out() from public;
grant execute on function public.erp_hr_attendance_check_out() to authenticated;

create or replace function public.erp_hr_attendance_set_day(
  p_employee_id uuid,
  p_day date,
  p_status text,
  p_check_in timestamptz default null,
  p_check_out timestamptz default null,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_status text := lower(coalesce(p_status, ''));
begin
  if auth.role() <> 'service_role' then
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    if not public.erp_is_hr_admin(v_actor) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  if p_day is null then
    raise exception 'Day is required';
  end if;

  if v_status not in ('present', 'absent', 'weekly_off', 'holiday', 'leave') then
    raise exception 'Invalid attendance status';
  end if;

  if not exists (
    select 1
      from public.erp_employees e
     where e.id = p_employee_id
       and e.company_id = v_company_id
  ) then
    raise exception 'Employee not found';
  end if;

  insert into public.erp_hr_attendance_days (
    company_id,
    employee_id,
    day,
    status,
    check_in_at,
    check_out_at,
    notes,
    source
  ) values (
    v_company_id,
    p_employee_id,
    p_day,
    v_status,
    p_check_in,
    p_check_out,
    p_notes,
    'manual'
  )
  on conflict (company_id, employee_id, day) do update
    set status = excluded.status,
        check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        notes = excluded.notes,
        source = excluded.source,
        updated_at = now();
end;
$$;

revoke all on function public.erp_hr_attendance_set_day(uuid, date, text, timestamptz, timestamptz, text) from public;
grant execute on function public.erp_hr_attendance_set_day(uuid, date, text, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
