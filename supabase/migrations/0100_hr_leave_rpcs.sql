-- Sprint-2C: leave request RPCs

create or replace function public.erp_leave_request_preview(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_date_from date,
  p_date_to date,
  p_start_session text default 'full',
  p_end_session text default 'full'
)
returns table(
  leave_date date,
  day_fraction numeric(3,2),
  is_weekly_off boolean,
  is_holiday boolean,
  counted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_is_authorized boolean := false;
  v_leave_type record;
  v_day date;
  v_is_holiday boolean;
  v_is_weekly_off boolean;
  v_day_fraction numeric(3,2);
  v_counted boolean;
begin
  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Invalid date range';
  end if;

  if p_start_session not in ('full', 'half_am', 'half_pm') then
    raise exception 'Invalid start session';
  end if;

  if p_end_session not in ('full', 'half_am', 'half_pm') then
    raise exception 'Invalid end session';
  end if;

  if v_company_id is null then
    raise exception 'Company not found';
  end if;

  if auth.role() = 'service_role' then
    v_is_authorized := true;
  else
    if v_actor is null then
      raise exception 'Not authenticated';
    end if;

    v_is_authorized := public.erp_is_hr_reader(v_actor);

    if not v_is_authorized then
      v_is_authorized := exists (
        select 1
        from public.erp_employees e
        where e.company_id = v_company_id
          and e.id = p_employee_id
          and e.user_id = v_actor
      )
      or exists (
        select 1
        from public.erp_employee_users eu
        where eu.company_id = v_company_id
          and eu.employee_id = p_employee_id
          and eu.user_id = v_actor
          and coalesce(eu.is_active, true)
      );
    end if;
  end if;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  select *
    into v_leave_type
    from public.erp_hr_leave_types lt
   where lt.id = p_leave_type_id
     and lt.company_id = v_company_id
     and lt.is_active;

  if not found then
    raise exception 'Leave type not found';
  end if;

  for v_day in
    select generate_series(p_date_from, p_date_to, interval '1 day')::date
  loop
    select coalesce(h.is_holiday, false)
      into v_is_holiday
      from public.erp_is_holiday(p_employee_id, v_day) h;

    select coalesce(w.is_weekly_off, false)
      into v_is_weekly_off
      from public.erp_is_weekly_off(p_employee_id, v_day) w;

    v_day_fraction := 1.0;

    if p_date_from = p_date_to then
      if p_start_session <> 'full' or p_end_session <> 'full' then
        v_day_fraction := 0.5;
      end if;
    else
      if v_day = p_date_from and p_start_session <> 'full' then
        v_day_fraction := 0.5;
      elsif v_day = p_date_to and p_end_session <> 'full' then
        v_day_fraction := 0.5;
      end if;
    end if;

    v_counted := true;

    if v_is_holiday and not v_leave_type.counts_holiday then
      v_counted := false;
    end if;

    if v_is_weekly_off and not v_leave_type.counts_weekly_off then
      v_counted := false;
    end if;

    leave_date := v_day;
    day_fraction := v_day_fraction;
    is_weekly_off := v_is_weekly_off;
    is_holiday := v_is_holiday;
    counted := v_counted;
    return next;
  end loop;
end;
$$;

revoke all on function public.erp_leave_request_preview(uuid, uuid, date, date, text, text) from public;
grant execute on function public.erp_leave_request_preview(uuid, uuid, date, date, text, text) to authenticated;

create or replace function public.erp_leave_request_submit(
  p_request_id uuid
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

  if v_request.status <> 'draft' then
    raise exception 'Only draft requests can be submitted';
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
      raise exception 'Not authorized to submit this request';
    end if;
  end if;

  update public.erp_hr_leave_requests
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now(),
         updated_by = v_actor
   where id = p_request_id
     and company_id = v_company_id
     and status = 'draft';
end;
$$;

revoke all on function public.erp_leave_request_submit(uuid) from public;
grant execute on function public.erp_leave_request_submit(uuid) to authenticated;

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

  delete from public.erp_hr_leave_request_days
   where company_id = v_company_id
     and leave_request_id = p_request_id;
end;
$$;

revoke all on function public.erp_leave_request_cancel(uuid, text) from public;
grant execute on function public.erp_leave_request_cancel(uuid, text) to authenticated;

-- Preview tests (manual)
-- select *
-- from public.erp_leave_request_preview(
--   '00000000-0000-0000-0000-000000000000',
--   '00000000-0000-0000-0000-000000000000',
--   current_date,
--   current_date + 2,
--   'half_am',
--   'full'
-- );
--
-- Approve flow (manual)
-- select public.erp_leave_request_submit('00000000-0000-0000-0000-000000000000');
-- select public.erp_leave_request_decide('00000000-0000-0000-0000-000000000000', 'approved', 'ok');
-- select *
-- from public.erp_hr_leave_request_days
-- where leave_request_id = '00000000-0000-0000-0000-000000000000'
-- order by leave_date;
