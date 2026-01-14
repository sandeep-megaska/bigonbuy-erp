-- Sprint-2E: attendance time metrics RPCs

create or replace function public.erp_attendance_resolve_shift(
  p_employee_id uuid,
  p_day date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_shift_id uuid;
  v_location_id uuid;
  v_actor uuid := auth.uid();
  v_is_authorized boolean := false;
begin
  if p_employee_id is null or p_day is null then
    return null;
  end if;

  if v_company_id is null then
    return null;
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
      ) or exists (
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

  select es.shift_id
    into v_shift_id
    from public.erp_hr_employee_shifts es
   where es.company_id = v_company_id
     and es.employee_id = p_employee_id
     and es.effective_from <= p_day
     and (es.effective_to is null or es.effective_to >= p_day)
   order by es.is_default desc, es.effective_from desc, es.created_at desc
   limit 1;

  if v_shift_id is not null then
    return v_shift_id;
  end if;

  v_location_id := public.erp_employee_location_id(p_employee_id, p_day);

  if v_location_id is null then
    return null;
  end if;

  select ls.shift_id
    into v_shift_id
    from public.erp_hr_location_shifts ls
   where ls.company_id = v_company_id
     and ls.location_id = v_location_id
     and ls.is_default
     and ls.effective_from <= p_day
     and (ls.effective_to is null or ls.effective_to >= p_day)
   order by ls.effective_from desc, ls.created_at desc
   limit 1;

  return v_shift_id;
end;
$$;

revoke all on function public.erp_attendance_resolve_shift(uuid, date) from public;
grant execute on function public.erp_attendance_resolve_shift(uuid, date) to authenticated;

create or replace function public.erp_attendance_compute_day_metrics(
  p_employee_id uuid,
  p_day date
)
returns table(
  work_minutes int,
  late_minutes int,
  early_leave_minutes int,
  ot_minutes int,
  day_fraction numeric(3, 2),
  shift_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_attendance record;
  v_shift record;
  v_shift_id uuid;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_work_minutes int;
  v_late_minutes int;
  v_early_leave_minutes int;
  v_ot_minutes int;
  v_day_fraction numeric(3, 2);
  v_grace interval;
  v_actor uuid := auth.uid();
  v_is_authorized boolean := false;
begin
  if p_employee_id is null or p_day is null then
    return;
  end if;

  if v_company_id is null then
    return;
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
      ) or exists (
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

  if public.erp_attendance_period_is_frozen(p_day) then
    raise exception 'Attendance period is frozen';
  end if;

  select *
    into v_attendance
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day = p_day;

  if not found then
    return;
  end if;

  if v_attendance.status in ('holiday', 'weekly_off')
     and (v_attendance.check_in_at is null or v_attendance.check_out_at is null) then
    return query
    select 0, 0, 0, 0, null::numeric(3, 2), v_attendance.shift_id;
    return;
  end if;

  if v_attendance.status = 'leave' or v_attendance.source = 'leave' then
    return query
    select null::int,
           null::int,
           null::int,
           null::int,
           coalesce(v_attendance.day_fraction, 1.0),
           v_attendance.shift_id;
    return;
  end if;

  v_shift_id := public.erp_attendance_resolve_shift(p_employee_id, p_day);

  if v_shift_id is not null then
    select *
      into v_shift
      from public.erp_hr_shifts s
     where s.company_id = v_company_id
       and s.id = v_shift_id;
    if not found then
      v_shift_id := null;
    end if;
  end if;

  if v_attendance.check_in_at is null or v_attendance.check_out_at is null then
    return query
    select null::int,
           null::int,
           null::int,
           null::int,
           null::numeric(3, 2),
           v_shift_id;
    return;
  end if;

  v_work_minutes := floor(extract(epoch from (v_attendance.check_out_at - v_attendance.check_in_at)) / 60)::int;
  v_work_minutes := greatest(0, v_work_minutes - coalesce(v_shift.break_minutes, 0));

  if v_shift_id is null then
    return query
    select v_work_minutes,
           null::int,
           null::int,
           null::int,
           null::numeric(3, 2),
           null::uuid;
    return;
  end if;

  v_start_ts := (p_day::timestamp + v_shift.start_time)::timestamptz;
  v_end_ts := (p_day::timestamp + v_shift.end_time)::timestamptz;

  if v_shift.is_night_shift or v_shift.end_time < v_shift.start_time then
    v_end_ts := (p_day::timestamp + v_shift.end_time + interval '1 day')::timestamptz;
  end if;

  v_grace := make_interval(mins => v_shift.grace_minutes);
  v_late_minutes := greatest(
    0,
    floor(extract(epoch from (v_attendance.check_in_at - (v_start_ts + v_grace))) / 60)::int
  );
  v_early_leave_minutes := greatest(
    0,
    floor(extract(epoch from (v_end_ts - v_attendance.check_out_at)) / 60)::int
  );

  if v_shift.ot_after_minutes is not null then
    v_ot_minutes := greatest(0, v_work_minutes - v_shift.ot_after_minutes);
  else
    v_ot_minutes := greatest(
      0,
      floor(extract(epoch from (v_attendance.check_out_at - v_end_ts)) / 60)::int
    )
    + greatest(
      0,
      floor(extract(epoch from (v_start_ts - v_attendance.check_in_at)) / 60)::int
    );
  end if;

  if v_work_minutes >= v_shift.min_full_day_minutes then
    v_day_fraction := 1.0;
  elsif v_work_minutes >= v_shift.min_half_day_minutes then
    v_day_fraction := 0.5;
  else
    v_day_fraction := null;
  end if;

  return query
  select v_work_minutes,
         v_late_minutes,
         v_early_leave_minutes,
         v_ot_minutes,
         v_day_fraction,
         v_shift_id;
end;
$$;

revoke all on function public.erp_attendance_compute_day_metrics(uuid, date) from public;
grant execute on function public.erp_attendance_compute_day_metrics(uuid, date) to authenticated;

create or replace function public.erp_attendance_upsert_check_times(
  p_employee_id uuid,
  p_day date,
  p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null,
  p_source text default 'manual',
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing record;
  v_notes text;
  v_metrics record;
  v_is_authorized boolean := false;
begin
  if p_employee_id is null or p_day is null then
    raise exception 'Employee and day are required';
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

    v_is_authorized := public.erp_is_hr_admin(v_actor);

    if not v_is_authorized then
      v_is_authorized := exists (
        select 1
          from public.erp_employees e
         where e.company_id = v_company_id
           and e.id = p_employee_id
           and e.user_id = v_actor
      ) or exists (
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

  if public.erp_attendance_period_is_frozen(p_day) then
    raise exception 'Attendance period is frozen';
  end if;

  select *
    into v_existing
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day = p_day
   for update;

  if found and (v_existing.status = 'leave' or v_existing.source = 'leave') then
    raise exception 'Attendance is marked as leave and cannot be updated';
  end if;

  if p_note is not null then
    v_notes := case
      when v_existing.notes is null or length(trim(v_existing.notes)) = 0 then p_note
      else v_existing.notes || E'\n' || p_note
    end;
  else
    v_notes := v_existing.notes;
  end if;

  insert into public.erp_hr_attendance_days (
    company_id,
    employee_id,
    day,
    status,
    check_in_at,
    check_out_at,
    notes,
    source,
    created_at,
    updated_at
  ) values (
    v_company_id,
    p_employee_id,
    p_day,
    'present',
    p_check_in_at,
    p_check_out_at,
    v_notes,
    coalesce(p_source, 'manual'),
    now(),
    now()
  )
  on conflict (company_id, employee_id, day)
  do update set
    check_in_at = excluded.check_in_at,
    check_out_at = excluded.check_out_at,
    source = excluded.source,
    notes = excluded.notes,
    status = case
      when public.erp_hr_attendance_days.status = 'unmarked' then 'present'
      else public.erp_hr_attendance_days.status
    end,
    updated_at = now();

  select *
    into v_metrics
    from public.erp_attendance_compute_day_metrics(p_employee_id, p_day);

  if found then
    update public.erp_hr_attendance_days ad
       set work_minutes = v_metrics.work_minutes,
           late_minutes = v_metrics.late_minutes,
           early_leave_minutes = v_metrics.early_leave_minutes,
           ot_minutes = v_metrics.ot_minutes,
           day_fraction = v_metrics.day_fraction,
           shift_id = v_metrics.shift_id,
           computed_at = now(),
           computed_by = v_actor
     where ad.company_id = v_company_id
       and ad.employee_id = p_employee_id
       and ad.day = p_day;
  end if;
end;
$$;

revoke all on function public.erp_attendance_upsert_check_times(uuid, date, timestamptz, timestamptz, text, text) from public;
grant execute on function public.erp_attendance_upsert_check_times(uuid, date, timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.erp_attendance_recompute_month(
  p_month date,
  p_employee_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month_start date;
  v_month_end date;
  v_employee_ids uuid[];
  v_row record;
  v_metrics record;
  v_updated integer := 0;
begin
  if p_month is null then
    raise exception 'Month is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  v_month_start := date_trunc('month', p_month)::date;
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  if p_employee_ids is null then
    select array_agg(e.id order by e.id)
      into v_employee_ids
      from public.erp_employees e
     where e.company_id = v_company_id;
  else
    select array_agg(e.id order by e.id)
      into v_employee_ids
      from public.erp_employees e
     where e.company_id = v_company_id
       and e.id = any(p_employee_ids);
  end if;

  if v_employee_ids is null or array_length(v_employee_ids, 1) is null then
    return 0;
  end if;

  for v_row in
    select ad.employee_id,
           ad.day
      from public.erp_hr_attendance_days ad
     where ad.company_id = v_company_id
       and ad.employee_id = any(v_employee_ids)
       and ad.day between v_month_start and v_month_end
       and ad.check_in_at is not null
       and ad.check_out_at is not null
       and not public.erp_attendance_period_is_frozen(ad.day)
  loop
    select *
      into v_metrics
      from public.erp_attendance_compute_day_metrics(v_row.employee_id, v_row.day);

    if found then
      update public.erp_hr_attendance_days ad
         set work_minutes = v_metrics.work_minutes,
             late_minutes = v_metrics.late_minutes,
             early_leave_minutes = v_metrics.early_leave_minutes,
             ot_minutes = v_metrics.ot_minutes,
             day_fraction = v_metrics.day_fraction,
             shift_id = v_metrics.shift_id,
             computed_at = now(),
             computed_by = v_actor
       where ad.company_id = v_company_id
         and ad.employee_id = v_row.employee_id
         and ad.day = v_row.day;

      v_updated := v_updated + 1;
    end if;
  end loop;

  return v_updated;
end;
$$;

revoke all on function public.erp_attendance_recompute_month(date, uuid[]) from public;
grant execute on function public.erp_attendance_recompute_month(date, uuid[]) to authenticated;

-- Tests (manual)
-- select public.erp_attendance_resolve_shift('00000000-0000-0000-0000-000000000000', current_date);
-- select *
--   from public.erp_attendance_compute_day_metrics('00000000-0000-0000-0000-000000000000', current_date);
-- select public.erp_attendance_upsert_check_times(
--   '00000000-0000-0000-0000-000000000000',
--   current_date,
--   now() - interval '8 hours',
--   now(),
--   'manual',
--   'manual check-in'
-- );
-- select public.erp_attendance_recompute_month(date_trunc('month', current_date)::date, null);
