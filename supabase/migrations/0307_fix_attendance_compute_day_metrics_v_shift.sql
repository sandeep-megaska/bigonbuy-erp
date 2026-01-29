begin;

-- 0307_fix_attendance_compute_day_metrics_v_shift.sql
-- Fix: v_shift record referenced before assignment when shift_id is null or invalid

drop function if exists public.erp_attendance_compute_day_metrics(uuid, date);

create function public.erp_attendance_compute_day_metrics(p_employee_id uuid, p_day date)
returns table(
  work_minutes integer,
  late_minutes integer,
  early_leave_minutes integer,
  ot_minutes integer,
  day_fraction numeric,
  shift_id uuid
)
language plpgsql
security definer
set search_path = public
as $function$
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

  -- NEW: use scalars so we never read v_shift.* unless assigned
  v_break_minutes int := 0;
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

  v_shift_id := v_attendance.shift_id;

  if v_shift_id is null then
    v_shift_id := public.erp_attendance_resolve_shift(p_employee_id, p_day);
  end if;

  if v_attendance.status in ('holiday', 'weekly_off')
     and (v_attendance.check_in_at is null or v_attendance.check_out_at is null) then
    return query
    select 0, 0, 0, 0, null::numeric(3, 2), v_shift_id;
    return;
  end if;

  if v_attendance.status = 'leave' or v_attendance.source = 'leave' then
    return query
    select null::int,
           null::int,
           null::int,
           null::int,
           coalesce(v_attendance.day_fraction, 1.0),
           v_shift_id;
    return;
  end if;

  -- Load shift row if we have a shift_id; otherwise keep break=0 and shift fields unused
  if v_shift_id is not null then
    select *
      into v_shift
      from public.erp_hr_shifts s
     where s.company_id = v_company_id
       and s.id = v_shift_id;

    if not found then
      v_shift_id := null;
      v_break_minutes := 0;
    else
      v_break_minutes := coalesce(v_shift.break_minutes, 0);
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
  v_work_minutes := greatest(0, v_work_minutes - v_break_minutes);

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

  -- From here onward, shift exists and v_shift is assigned (because v_shift_id != null implies found)
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
$function$;

revoke all on function public.erp_attendance_compute_day_metrics from public;
grant execute on function public.erp_attendance_compute_day_metrics to authenticated;

commit;
