-- Sprint-2C: leave to attendance integration

do $$
declare
  v_constraint text;
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_attendance_days_company_employee_day_unique'
       and conrelid = 'public.erp_hr_attendance_days'::regclass
  ) then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_company_employee_day_unique
      unique (company_id, employee_id, day);
  end if;

  select pg_get_constraintdef(c.oid)
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.erp_hr_attendance_days'::regclass
     and c.contype = 'c'
     and c.conname = 'erp_hr_attendance_days_status_check';

  if v_constraint is null then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'weekly_off', 'holiday', 'leave'));
  elsif v_constraint not ilike '%leave%' then
    alter table public.erp_hr_attendance_days
      drop constraint erp_hr_attendance_days_status_check;
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'weekly_off', 'holiday', 'leave'));
  end if;
end
$$;

create or replace function public.erp_attendance_upsert_leave_day(
  p_employee_id uuid,
  p_day date,
  p_leave_request_id uuid,
  p_leave_type_id uuid,
  p_fraction numeric default 1.0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_existing record;
  v_leave_type_key text;
  v_notes text;
begin
  if p_employee_id is null or p_day is null then
    raise exception 'Employee and day are required';
  end if;

  if v_company_id is null then
    raise exception 'Company not found';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  select lt.key
    into v_leave_type_key
    from public.erp_hr_leave_types lt
   where lt.id = p_leave_type_id
     and lt.company_id = v_company_id;

  if v_leave_type_key is null then
    raise exception 'Leave type not found';
  end if;

  v_notes := format(
    'Leave: %s (req %s) fraction %s',
    v_leave_type_key,
    p_leave_request_id,
    coalesce(p_fraction, 1.0)
  );

  select *
    into v_existing
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day = p_day
   for update;

  if found then
    if v_existing.source = 'manual'
       and v_existing.status = 'present'
       and (v_existing.check_in_at is not null or v_existing.check_out_at is not null) then
      raise exception 'Attendance conflict for employee % on % (request %). Manual attendance exists.',
        p_employee_id,
        p_day,
        p_leave_request_id;
    end if;

    if v_existing.source = 'leave'
       or v_existing.status in ('absent', 'present', 'holiday', 'weekly_off') then
      update public.erp_hr_attendance_days
         set status = 'leave',
             source = 'leave',
             notes = v_notes,
             check_in_at = null,
             check_out_at = null,
             updated_at = now()
       where id = v_existing.id;
    end if;
  else
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
      'leave',
      null,
      null,
      v_notes,
      'leave'
    );
  end if;
end;
$$;

revoke all on function public.erp_attendance_upsert_leave_day(uuid, date, uuid, uuid, numeric) from public;
grant execute on function public.erp_attendance_upsert_leave_day(uuid, date, uuid, uuid, numeric) to authenticated;

create or replace function public.erp_attendance_clear_leave_days(
  p_leave_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if p_leave_request_id is null then
    raise exception 'Leave request is required';
  end if;

  if v_company_id is null then
    raise exception 'Company not found';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  delete from public.erp_hr_attendance_days ad
   using public.erp_hr_leave_request_days lrd
   join public.erp_hr_leave_requests lr
     on lr.id = lrd.leave_request_id
    and lr.company_id = v_company_id
   where lrd.leave_request_id = p_leave_request_id
     and lrd.company_id = v_company_id
     and ad.company_id = v_company_id
     and ad.employee_id = lr.employee_id
     and ad.day = lrd.leave_date
     and ad.source = 'leave'
     and ad.notes is not null
     and position(p_leave_request_id::text in ad.notes) > 0;
end;
$$;

revoke all on function public.erp_attendance_clear_leave_days(uuid) from public;
grant execute on function public.erp_attendance_clear_leave_days(uuid) to authenticated;

create or replace function public.erp_leave_request_decide(
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
  v_request record;
  v_actor_employee_id uuid;
  v_is_hr_admin boolean;
  v_is_manager boolean := false;
  v_start_session text;
  v_end_session text;
  v_day record;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select lr.*
    into v_request
    from public.erp_hr_leave_requests lr
   where lr.id = p_request_id
     and lr.company_id = v_company_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  if v_request.status <> 'submitted' then
    raise exception 'Only submitted requests can be decided';
  end if;

  v_is_hr_admin := public.erp_is_hr_admin(v_actor);

  if not v_is_hr_admin then
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

    if not v_is_manager then
      raise exception 'Not authorized to decide this request';
    end if;
  end if;

  update public.erp_hr_leave_requests
     set status = p_decision,
         decided_at = now(),
         decision_note = p_note,
         approver_user_id = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_request_id
     and company_id = v_company_id;

  if p_decision = 'approved' then
    v_start_session := coalesce(v_request.start_session, 'full');
    v_end_session := coalesce(v_request.end_session, 'full');

    delete from public.erp_hr_leave_request_days
     where company_id = v_company_id
       and leave_request_id = p_request_id;

    insert into public.erp_hr_leave_request_days (
      company_id,
      leave_request_id,
      leave_date,
      day_fraction,
      is_weekly_off,
      is_holiday
    )
    select v_company_id,
           p_request_id,
           preview.leave_date,
           preview.day_fraction,
           preview.is_weekly_off,
           preview.is_holiday
      from public.erp_leave_request_preview(
        v_request.employee_id,
        v_request.leave_type_id,
        v_request.date_from,
        v_request.date_to,
        v_start_session,
        v_end_session
      ) preview
     where preview.counted;

    for v_day in
      select lrd.leave_date,
             lrd.day_fraction
        from public.erp_hr_leave_request_days lrd
       where lrd.company_id = v_company_id
         and lrd.leave_request_id = p_request_id
    loop
      perform public.erp_attendance_upsert_leave_day(
        v_request.employee_id,
        v_day.leave_date,
        p_request_id,
        v_request.leave_type_id,
        v_day.day_fraction
      );
    end loop;
  else
    delete from public.erp_hr_leave_request_days
     where company_id = v_company_id
       and leave_request_id = p_request_id;
  end if;
end;
$$;

revoke all on function public.erp_leave_request_decide(uuid, text, text) from public;
grant execute on function public.erp_leave_request_decide(uuid, text, text) to authenticated;

create or replace function public.erp_leave_request_cancel(
  p_request_id uuid,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_request record;
  v_is_hr_admin boolean;
  v_is_employee boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_request
    from public.erp_hr_leave_requests lr
   where lr.id = p_request_id
     and lr.company_id = v_company_id;

  if not found then
    raise exception 'Leave request not found';
  end if;

  if v_request.status not in ('draft', 'submitted', 'approved') then
    raise exception 'Only draft, submitted, or approved requests can be cancelled';
  end if;

  v_is_hr_admin := public.erp_is_hr_admin(v_actor);

  if not v_is_hr_admin then
    v_is_employee := exists (
      select 1
      from public.erp_employees e
      where e.company_id = v_company_id
        and e.id = v_request.employee_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_employee_users eu
      where eu.company_id = v_company_id
        and eu.employee_id = v_request.employee_id
        and eu.user_id = v_actor
        and coalesce(eu.is_active, true)
    );

    if not v_is_employee then
      raise exception 'Not authorized to cancel this request';
    end if;
  end if;

  update public.erp_hr_leave_requests
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_note = p_note,
         updated_at = now(),
         updated_by = v_actor
   where id = p_request_id
     and company_id = v_company_id;

  perform public.erp_attendance_clear_leave_days(p_request_id);

  delete from public.erp_hr_leave_request_days
   where company_id = v_company_id
     and leave_request_id = p_request_id;
end;
$$;

revoke all on function public.erp_leave_request_cancel(uuid, text) from public;
grant execute on function public.erp_leave_request_cancel(uuid, text) to authenticated;

-- Manual tests
-- approve a request and verify attendance_days created with status='leave' and source='leave'
-- select public.erp_leave_request_decide('00000000-0000-0000-0000-000000000000', 'approved', 'ok');
-- select * from public.erp_hr_attendance_days
--  where employee_id = '00000000-0000-0000-0000-000000000000'
--  order by day;
--
-- cancel request and verify leave-created attendance rows removed
-- select public.erp_leave_request_cancel('00000000-0000-0000-0000-000000000000', 'cancel');
-- select * from public.erp_hr_attendance_days
--  where source = 'leave'
--  order by day;
