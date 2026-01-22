-- 0180_rls_rpc_ui_writes.sql
-- Route ERP writes through RPCs for RLS-safe UI/API usage.

-- HR: Employee titles
create or replace function public.erp_hr_employee_title_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_sort_order int default 0,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_hr_employee_titles (
      company_id,
      code,
      name,
      sort_order,
      is_active
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true)
    ) returning id into v_id;
  else
    update public.erp_hr_employee_titles
       set code = trim(p_code),
           name = trim(p_name),
           sort_order = coalesce(p_sort_order, 0),
           is_active = coalesce(p_is_active, true)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Employee title not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_employee_title_set_active(
  p_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_employee_titles
     set is_active = coalesce(p_is_active, true)
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Employee title not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Employee genders
create or replace function public.erp_hr_employee_gender_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_sort_order int default 0,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_hr_employee_genders (
      company_id,
      code,
      name,
      sort_order,
      is_active
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true)
    ) returning id into v_id;
  else
    update public.erp_hr_employee_genders
       set code = trim(p_code),
           name = trim(p_name),
           sort_order = coalesce(p_sort_order, 0),
           is_active = coalesce(p_is_active, true)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Employee gender not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_employee_gender_set_active(
  p_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_employee_genders
     set is_active = coalesce(p_is_active, true)
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Employee gender not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Exit types
create or replace function public.erp_hr_employee_exit_type_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_sort_order int default 0,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_hr_employee_exit_types (
      company_id,
      code,
      name,
      sort_order,
      is_active
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true)
    ) returning id into v_id;
  else
    update public.erp_hr_employee_exit_types
       set code = trim(p_code),
           name = trim(p_name),
           sort_order = coalesce(p_sort_order, 0),
           is_active = coalesce(p_is_active, true)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Exit type not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_employee_exit_type_set_active(
  p_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_employee_exit_types
     set is_active = coalesce(p_is_active, true)
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Exit type not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Exit reasons
create or replace function public.erp_hr_employee_exit_reason_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_sort_order int default 0,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_hr_employee_exit_reasons (
      company_id,
      code,
      name,
      sort_order,
      is_active
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true)
    ) returning id into v_id;
  else
    update public.erp_hr_employee_exit_reasons
       set code = trim(p_code),
           name = trim(p_name),
           sort_order = coalesce(p_sort_order, 0),
           is_active = coalesce(p_is_active, true)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Exit reason not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_employee_exit_reason_set_active(
  p_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_employee_exit_reasons
     set is_active = coalesce(p_is_active, true)
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Exit reason not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Leave types
create or replace function public.erp_hr_leave_type_upsert(
  p_id uuid default null,
  p_key text,
  p_name text,
  p_is_paid boolean default true,
  p_is_active boolean default true,
  p_allows_half_day boolean default false,
  p_requires_approval boolean default true,
  p_counts_weekly_off boolean default false,
  p_counts_holiday boolean default false,
  p_display_order int default 100
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'key is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_hr_leave_types (
      company_id,
      key,
      name,
      is_paid,
      is_active,
      allows_half_day,
      requires_approval,
      counts_weekly_off,
      counts_holiday,
      display_order
    ) values (
      v_company_id,
      trim(p_key),
      trim(p_name),
      coalesce(p_is_paid, true),
      coalesce(p_is_active, true),
      coalesce(p_allows_half_day, false),
      coalesce(p_requires_approval, true),
      coalesce(p_counts_weekly_off, false),
      coalesce(p_counts_holiday, false),
      coalesce(p_display_order, 100)
    ) returning id into v_id;
  else
    update public.erp_hr_leave_types
       set key = trim(p_key),
           name = trim(p_name),
           is_paid = coalesce(p_is_paid, true),
           is_active = coalesce(p_is_active, true),
           allows_half_day = coalesce(p_allows_half_day, false),
           requires_approval = coalesce(p_requires_approval, true),
           counts_weekly_off = coalesce(p_counts_weekly_off, false),
           counts_holiday = coalesce(p_counts_holiday, false),
           display_order = coalesce(p_display_order, 100)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Leave type not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Shifts
create or replace function public.erp_hr_shift_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_break_minutes int default 0,
  p_grace_minutes int default 0,
  p_min_half_day_minutes int default 240,
  p_min_full_day_minutes int default 480,
  p_ot_after_minutes int default null,
  p_is_night_shift boolean default false,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;
  if p_start_time is null or p_end_time is null then
    raise exception 'start_time and end_time are required';
  end if;

  if p_id is null then
    insert into public.erp_hr_shifts (
      company_id,
      code,
      name,
      start_time,
      end_time,
      break_minutes,
      grace_minutes,
      min_half_day_minutes,
      min_full_day_minutes,
      ot_after_minutes,
      is_night_shift,
      is_active
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      p_start_time,
      p_end_time,
      coalesce(p_break_minutes, 0),
      coalesce(p_grace_minutes, 0),
      coalesce(p_min_half_day_minutes, 240),
      coalesce(p_min_full_day_minutes, 480),
      p_ot_after_minutes,
      coalesce(p_is_night_shift, false),
      coalesce(p_is_active, true)
    ) returning id into v_id;
  else
    update public.erp_hr_shifts
       set code = trim(p_code),
           name = trim(p_name),
           start_time = p_start_time,
           end_time = p_end_time,
           break_minutes = coalesce(p_break_minutes, 0),
           grace_minutes = coalesce(p_grace_minutes, 0),
           min_half_day_minutes = coalesce(p_min_half_day_minutes, 240),
           min_full_day_minutes = coalesce(p_min_full_day_minutes, 480),
           ot_after_minutes = p_ot_after_minutes,
           is_night_shift = coalesce(p_is_night_shift, false),
           is_active = coalesce(p_is_active, true)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Shift not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Location shifts
create or replace function public.erp_hr_location_shift_create(
  p_location_id uuid,
  p_shift_id uuid,
  p_effective_from date,
  p_effective_to date default null,
  p_is_default boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_hr_location_shifts (
    company_id,
    location_id,
    shift_id,
    effective_from,
    effective_to,
    is_default
  ) values (
    v_company_id,
    p_location_id,
    p_shift_id,
    p_effective_from,
    p_effective_to,
    coalesce(p_is_default, true)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Weekly off rules
create or replace function public.erp_hr_weekly_off_rule_create(
  p_scope_type text,
  p_employee_id uuid default null,
  p_location_id uuid default null,
  p_weekday int,
  p_week_of_month int default null,
  p_is_off boolean default true,
  p_effective_from date,
  p_effective_to date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_weekly_off_rules (
    company_id,
    scope_type,
    employee_id,
    location_id,
    weekday,
    week_of_month,
    is_off,
    effective_from,
    effective_to
  ) values (
    v_company_id,
    p_scope_type,
    p_employee_id,
    p_location_id,
    p_weekday,
    p_week_of_month,
    coalesce(p_is_off, true),
    p_effective_from,
    p_effective_to
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_weekly_off_rule_delete(
  p_rule_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  delete from public.erp_weekly_off_rules
   where id = p_rule_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Weekly off rule not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Leave request draft upsert
create or replace function public.erp_hr_leave_request_draft_upsert(
  p_id uuid default null,
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_date_from date,
  p_date_to date,
  p_reason text default null,
  p_start_session text default 'full',
  p_end_session text default 'full'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_leave_type_id is null then
    raise exception 'leave_type_id is required';
  end if;

  if p_date_from is null or p_date_to is null then
    raise exception 'date range is required';
  end if;

  if p_date_from > p_date_to then
    raise exception 'Invalid date range';
  end if;

  if p_id is null then
    insert into public.erp_hr_leave_requests (
      company_id,
      employee_id,
      leave_type_id,
      date_from,
      date_to,
      reason,
      status,
      start_session,
      end_session,
      updated_by
    ) values (
      v_company_id,
      p_employee_id,
      p_leave_type_id,
      p_date_from,
      p_date_to,
      p_reason,
      'draft',
      p_start_session,
      p_end_session,
      v_actor
    ) returning id into v_id;
  else
    update public.erp_hr_leave_requests
       set employee_id = p_employee_id,
           leave_type_id = p_leave_type_id,
           date_from = p_date_from,
           date_to = p_date_to,
           reason = p_reason,
           status = 'draft',
           start_session = p_start_session,
           end_session = p_end_session,
           updated_by = v_actor
     where id = p_id
       and company_id = v_company_id
       and status = 'draft'
    returning id into v_id;

    if v_id is null then
      raise exception 'Leave request not found or not editable';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Employee profile update (joining date/title/gender)
create or replace function public.erp_hr_employee_profile_update(
  p_employee_id uuid,
  p_joining_date date default null,
  p_title_id uuid default null,
  p_gender_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_employees
     set joining_date = p_joining_date,
         title_id = p_title_id,
         gender_id = p_gender_id
   where id = p_employee_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Employee not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Attendance day status update
create or replace function public.erp_hr_attendance_day_status_update(
  p_employee_id uuid,
  p_day date,
  p_status text,
  p_source text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_attendance_days
     set status = p_status,
         source = coalesce(p_source, 'manual')
   where employee_id = p_employee_id
     and day = p_day
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Attendance day not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- HR: Calendars
create or replace function public.erp_hr_calendar_upsert(
  p_id uuid default null,
  p_code text,
  p_name text,
  p_timezone text,
  p_is_default boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_calendars (
      company_id,
      code,
      name,
      timezone,
      is_default
    ) values (
      v_company_id,
      trim(p_code),
      trim(p_name),
      nullif(trim(coalesce(p_timezone, '')), ''),
      coalesce(p_is_default, false)
    ) returning id into v_id;
  else
    update public.erp_calendars
       set code = trim(p_code),
           name = trim(p_name),
           timezone = nullif(trim(coalesce(p_timezone, '')), ''),
           is_default = coalesce(p_is_default, false)
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Calendar not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_calendar_set_default(
  p_calendar_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_calendars
     set is_default = false
   where company_id = v_company_id;

  update public.erp_calendars
     set is_default = true
   where id = p_calendar_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Calendar not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_calendar_holiday_create(
  p_calendar_id uuid,
  p_holiday_date date,
  p_name text,
  p_holiday_type text default 'public',
  p_is_optional boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_calendar_holidays (
    company_id,
    calendar_id,
    holiday_date,
    name,
    holiday_type,
    is_optional
  ) values (
    v_company_id,
    p_calendar_id,
    p_holiday_date,
    p_name,
    coalesce(p_holiday_type, 'public'),
    coalesce(p_is_optional, false)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_calendar_holiday_delete(
  p_holiday_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  delete from public.erp_calendar_holidays
   where id = p_holiday_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Holiday not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_calendar_location_add(
  p_calendar_id uuid,
  p_work_location_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_calendar_locations (
    company_id,
    calendar_id,
    work_location_id
  ) values (
    v_company_id,
    p_calendar_id,
    p_work_location_id
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_calendar_location_delete(
  p_calendar_location_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  delete from public.erp_calendar_locations
   where id = p_calendar_location_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Calendar location not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Ledger insert
create or replace function public.erp_inventory_ledger_insert(
  p_entries jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_actor uuid := auth.uid();
  v_entry record;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be an array';
  end if;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by
  )
  select
    v_company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    coalesce(created_by, v_actor)
  from jsonb_to_recordset(p_entries) as x(
    warehouse_id uuid,
    variant_id uuid,
    qty int,
    type text,
    reason text,
    ref text,
    created_by uuid
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

-- Inventory: Products
create or replace function public.erp_inventory_product_create(
  p_title text,
  p_style_code text,
  p_hsn_code text default null,
  p_status text default 'draft'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required';
  end if;
  if p_style_code is null or length(trim(p_style_code)) = 0 then
    raise exception 'style_code is required';
  end if;

  insert into public.erp_products (
    company_id,
    title,
    style_code,
    hsn_code,
    status
  ) values (
    v_company_id,
    trim(p_title),
    trim(p_style_code),
    nullif(trim(coalesce(p_hsn_code, '')), ''),
    coalesce(p_status, 'draft')
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_product_update(
  p_id uuid,
  p_title text,
  p_style_code text,
  p_hsn_code text default null,
  p_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_products
     set title = trim(p_title),
         style_code = trim(p_style_code),
         hsn_code = nullif(trim(coalesce(p_hsn_code, '')), ''),
         status = coalesce(p_status, status)
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Product not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_product_update_status(
  p_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_products
     set status = p_status
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Product not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_product_set_image(
  p_id uuid,
  p_image_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_products
     set image_url = p_image_url
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Product not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_product_delete(
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  delete from public.erp_products
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Product not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Variants
create or replace function public.erp_inventory_variant_upsert(
  p_id uuid default null,
  p_product_id uuid,
  p_sku text,
  p_size text default null,
  p_color text default null,
  p_cost_price numeric default null,
  p_selling_price numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_product_id is null then
    raise exception 'product_id is required';
  end if;
  if p_sku is null or length(trim(p_sku)) = 0 then
    raise exception 'sku is required';
  end if;

  if p_id is null then
    insert into public.erp_variants (
      company_id,
      product_id,
      sku,
      size,
      color,
      cost_price,
      selling_price
    ) values (
      v_company_id,
      p_product_id,
      trim(p_sku),
      nullif(trim(coalesce(p_size, '')), ''),
      nullif(trim(coalesce(p_color, '')), ''),
      p_cost_price,
      p_selling_price
    ) returning id into v_id;
  else
    update public.erp_variants
       set product_id = p_product_id,
           sku = trim(p_sku),
           size = nullif(trim(coalesce(p_size, '')), ''),
           color = nullif(trim(coalesce(p_color, '')), ''),
           cost_price = p_cost_price,
           selling_price = p_selling_price
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Variant not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_variant_set_image(
  p_id uuid,
  p_image_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_variants
     set image_url = p_image_url
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Variant not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_variant_delete(
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  delete from public.erp_variants
   where id = p_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Variant not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Warehouses
create or replace function public.erp_inventory_warehouse_upsert(
  p_id uuid default null,
  p_name text,
  p_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_warehouses (
      company_id,
      name,
      code
    ) values (
      v_company_id,
      trim(p_name),
      nullif(trim(coalesce(p_code, '')), '')
    ) returning id into v_id;
  else
    update public.erp_warehouses
       set name = trim(p_name),
           code = nullif(trim(coalesce(p_code, '')), '')
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Warehouse not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Vendors
create or replace function public.erp_inventory_vendor_upsert(
  p_id uuid default null,
  p_vendor_type text,
  p_legal_name text,
  p_gstin text default null,
  p_contact_person text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_pincode text default null,
  p_country text default null,
  p_payment_terms_days int default 0,
  p_notes text default null,
  p_is_active boolean default true,
  p_updated_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_vendor_type is null or length(trim(p_vendor_type)) = 0 then
    raise exception 'vendor_type is required';
  end if;

  if p_legal_name is null or length(trim(p_legal_name)) = 0 then
    raise exception 'legal_name is required';
  end if;

  if p_id is null then
    insert into public.erp_vendors (
      company_id,
      vendor_type,
      legal_name,
      gstin,
      contact_person,
      phone,
      email,
      address,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      country,
      payment_terms_days,
      notes,
      is_active,
      updated_by
    ) values (
      v_company_id,
      trim(p_vendor_type),
      trim(p_legal_name),
      nullif(trim(coalesce(p_gstin, '')), ''),
      nullif(trim(coalesce(p_contact_person, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_address_line1, '')), ''),
      nullif(trim(coalesce(p_address_line2, '')), ''),
      nullif(trim(coalesce(p_city, '')), ''),
      nullif(trim(coalesce(p_state, '')), ''),
      nullif(trim(coalesce(p_pincode, '')), ''),
      nullif(trim(coalesce(p_country, '')), ''),
      coalesce(p_payment_terms_days, 0),
      nullif(trim(coalesce(p_notes, '')), ''),
      coalesce(p_is_active, true),
      coalesce(p_updated_by, auth.uid())
    ) returning id into v_id;
  else
    update public.erp_vendors
       set vendor_type = trim(p_vendor_type),
           legal_name = trim(p_legal_name),
           gstin = nullif(trim(coalesce(p_gstin, '')), ''),
           contact_person = nullif(trim(coalesce(p_contact_person, '')), ''),
           phone = nullif(trim(coalesce(p_phone, '')), ''),
           email = nullif(trim(coalesce(p_email, '')), ''),
           address = nullif(trim(coalesce(p_address, '')), ''),
           address_line1 = nullif(trim(coalesce(p_address_line1, '')), ''),
           address_line2 = nullif(trim(coalesce(p_address_line2, '')), ''),
           city = nullif(trim(coalesce(p_city, '')), ''),
           state = nullif(trim(coalesce(p_state, '')), ''),
           pincode = nullif(trim(coalesce(p_pincode, '')), ''),
           country = nullif(trim(coalesce(p_country, '')), ''),
           payment_terms_days = coalesce(p_payment_terms_days, payment_terms_days),
           notes = nullif(trim(coalesce(p_notes, '')), ''),
           is_active = coalesce(p_is_active, is_active),
           updated_by = coalesce(p_updated_by, auth.uid())
     where id = p_id
       and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Vendor not found';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: RFQs
create or replace function public.erp_inventory_rfq_create(
  p_vendor_id uuid,
  p_requested_on date,
  p_needed_by date default null,
  p_deliver_to_warehouse_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  insert into public.erp_rfq (
    company_id,
    vendor_id,
    requested_on,
    needed_by,
    deliver_to_warehouse_id,
    notes
  ) values (
    v_company_id,
    p_vendor_id,
    p_requested_on,
    p_needed_by,
    p_deliver_to_warehouse_id,
    p_notes
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_rfq_update(
  p_rfq_id uuid,
  p_vendor_id uuid,
  p_requested_on date,
  p_needed_by date default null,
  p_deliver_to_warehouse_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_rfq
     set vendor_id = p_vendor_id,
         requested_on = p_requested_on,
         needed_by = p_needed_by,
         deliver_to_warehouse_id = p_deliver_to_warehouse_id,
         notes = p_notes
   where id = p_rfq_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'RFQ not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_rfq_mark_sent(
  p_rfq_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_rfq
     set status = 'sent'
   where id = p_rfq_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'RFQ not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_rfq_lines_replace(
  p_rfq_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  delete from public.erp_rfq_lines
   where rfq_id = p_rfq_id
     and company_id = v_company_id;

  insert into public.erp_rfq_lines (
    company_id,
    rfq_id,
    variant_id,
    qty,
    notes
  )
  select
    v_company_id,
    p_rfq_id,
    variant_id,
    qty,
    notes
  from jsonb_to_recordset(p_lines) as x(
    variant_id uuid,
    qty numeric,
    notes text
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

-- Inventory: Vendor quotes
create or replace function public.erp_inventory_vendor_quote_create(
  p_rfq_id uuid,
  p_vendor_id uuid,
  p_received_on date,
  p_validity_until date default null,
  p_lead_time_days int default null,
  p_payment_terms_days int default null,
  p_status text default 'received',
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  insert into public.erp_vendor_quotes (
    company_id,
    rfq_id,
    vendor_id,
    received_on,
    validity_until,
    lead_time_days,
    payment_terms_days,
    status,
    notes
  ) values (
    v_company_id,
    p_rfq_id,
    p_vendor_id,
    p_received_on,
    p_validity_until,
    p_lead_time_days,
    p_payment_terms_days,
    coalesce(p_status, 'received'),
    p_notes
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_vendor_quote_lines_insert(
  p_quote_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  insert into public.erp_vendor_quote_lines (
    company_id,
    quote_id,
    variant_id,
    qty,
    unit_rate,
    gst_note,
    notes
  )
  select
    v_company_id,
    p_quote_id,
    variant_id,
    qty,
    unit_rate,
    gst_note,
    notes
  from jsonb_to_recordset(p_lines) as x(
    variant_id uuid,
    qty numeric,
    unit_rate numeric,
    gst_note text,
    notes text
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

create or replace function public.erp_inventory_vendor_quote_update_status(
  p_quote_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_vendor_quotes
     set status = p_status
   where id = p_quote_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Vendor quote not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Purchase orders
create or replace function public.erp_inventory_purchase_order_update(
  p_purchase_order_id uuid,
  p_vendor_id uuid,
  p_order_date date default null,
  p_expected_delivery_date date default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_purchase_orders
     set vendor_id = p_vendor_id,
         order_date = p_order_date,
         expected_delivery_date = p_expected_delivery_date,
         notes = p_notes
   where id = p_purchase_order_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Purchase order not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_purchase_order_lines_insert(
  p_purchase_order_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  insert into public.erp_purchase_order_lines (
    company_id,
    purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  )
  select
    v_company_id,
    p_purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  from jsonb_to_recordset(p_lines) as x(
    variant_id uuid,
    ordered_qty numeric,
    unit_cost numeric
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

create or replace function public.erp_inventory_purchase_order_lines_replace(
  p_purchase_order_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  delete from public.erp_purchase_order_lines
   where purchase_order_id = p_purchase_order_id
     and company_id = v_company_id;

  insert into public.erp_purchase_order_lines (
    company_id,
    purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  )
  select
    v_company_id,
    p_purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  from jsonb_to_recordset(p_lines) as x(
    variant_id uuid,
    ordered_qty numeric,
    unit_cost numeric
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

-- Inventory: GRNs
create or replace function public.erp_inventory_grn_create(
  p_purchase_order_id uuid,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_grn_no text;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  insert into public.erp_grns (
    company_id,
    purchase_order_id,
    notes
  ) values (
    v_company_id,
    p_purchase_order_id,
    p_notes
  ) returning id, grn_no into v_id, v_grn_no;

  return jsonb_build_object('ok', true, 'id', v_id, 'grn_no', v_grn_no);
end;
$$;

create or replace function public.erp_inventory_grn_lines_insert(
  p_grn_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_count int := 0;
  v_rows int;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  insert into public.erp_grn_lines (
    company_id,
    grn_id,
    purchase_order_line_id,
    variant_id,
    warehouse_id,
    received_qty,
    unit_cost
  )
  select
    v_company_id,
    p_grn_id,
    purchase_order_line_id,
    variant_id,
    warehouse_id,
    received_qty,
    unit_cost
  from jsonb_to_recordset(p_lines) as x(
    purchase_order_line_id uuid,
    variant_id uuid,
    warehouse_id uuid,
    received_qty numeric,
    unit_cost numeric
  );

  get diagnostics v_rows = row_count;
  v_count := coalesce(v_rows, 0);

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

-- Finance: Marketplace cost overrides
create or replace function public.erp_marketplace_sku_cost_override_create(
  p_sku text,
  p_unit_cost numeric,
  p_effective_from date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_marketplace_writer();
  end if;

  insert into public.erp_sku_cost_overrides (
    company_id,
    sku,
    unit_cost,
    effective_from
  ) values (
    v_company_id,
    trim(p_sku),
    p_unit_cost,
    p_effective_from
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Finance: Recurring expense templates
create or replace function public.erp_recurring_expense_template_set_active(
  p_template_id uuid,
  p_is_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  update public.erp_recurring_expense_templates
     set is_active = coalesce(p_is_active, true),
         updated_at = now()
   where id = p_template_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Recurring expense template not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Admin: Company profile update
create or replace function public.erp_company_update_profile(
  p_company_id uuid,
  p_name text,
  p_legal_name text default null,
  p_brand_name text default null,
  p_country_code text default null,
  p_currency_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_company is null then
    raise exception 'company_id is required';
  end if;

  if p_company_id is null or p_company_id <> v_company then
    raise exception 'Invalid company';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized';
  end if;

  update public.erp_companies
     set legal_name = p_legal_name,
         brand_name = p_brand_name,
         country_code = p_country_code,
         currency_code = p_currency_code,
         name = coalesce(nullif(trim(p_name), ''), name)
   where id = p_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Company not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Admin: Company settings update
create or replace function public.erp_company_settings_update(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_row public.erp_company_settings;
  v_legal_name text;
  v_gstin text;
  v_address_text text;
  v_po_terms_text text;
  v_po_footer_address_text text;
  v_bigonbuy_logo_path text;
  v_megaska_logo_path text;
  v_setup_completed boolean;
  v_setup_completed_at timestamptz;
  v_updated_by uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized';
  end if;

  v_legal_name := nullif(trim(coalesce(p_payload->>'legal_name', '')), '');
  v_gstin := nullif(trim(coalesce(p_payload->>'gstin', '')), '');
  v_address_text := nullif(trim(coalesce(p_payload->>'address_text', '')), '');
  v_po_terms_text := nullif(trim(coalesce(p_payload->>'po_terms_text', '')), '');
  v_po_footer_address_text := nullif(trim(coalesce(p_payload->>'po_footer_address_text', '')), '');
  v_bigonbuy_logo_path := nullif(trim(coalesce(p_payload->>'bigonbuy_logo_path', '')), '');
  v_megaska_logo_path := nullif(trim(coalesce(p_payload->>'megaska_logo_path', '')), '');
  v_setup_completed := (p_payload->>'setup_completed')::boolean;
  v_setup_completed_at := nullif(p_payload->>'setup_completed_at', '')::timestamptz;
  v_updated_by := coalesce((p_payload->>'updated_by')::uuid, v_actor);

  update public.erp_company_settings
     set legal_name = coalesce(v_legal_name, legal_name),
         gstin = coalesce(v_gstin, gstin),
         address_text = coalesce(v_address_text, address_text),
         po_terms_text = coalesce(v_po_terms_text, po_terms_text),
         po_footer_address_text = coalesce(v_po_footer_address_text, po_footer_address_text),
         bigonbuy_logo_path = coalesce(v_bigonbuy_logo_path, bigonbuy_logo_path),
         megaska_logo_path = coalesce(v_megaska_logo_path, megaska_logo_path),
         setup_completed = coalesce(v_setup_completed, setup_completed),
         setup_completed_at = coalesce(v_setup_completed_at, setup_completed_at),
         updated_by = v_updated_by
   where company_id = v_company_id
  returning * into v_row;

  if v_row.company_id is null then
    raise exception 'Company settings not found';
  end if;

  return jsonb_build_object('ok', true, 'company_id', v_row.company_id);
end;
$$;

-- HR: Roles
create or replace function public.erp_hr_role_create(
  p_key text,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_roles (key, name)
  values (trim(p_key), trim(p_name))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_role_update(
  p_key text,
  p_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_roles
     set name = trim(p_name)
   where key = trim(p_key)
  returning id into v_id;

  if v_id is null then
    raise exception 'Role not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_hr_role_delete(
  p_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  delete from public.erp_roles
   where key = trim(p_key)
  returning id into v_id;

  if v_id is null then
    raise exception 'Role not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- OMS: Channel jobs/logs/items
create or replace function public.erp_oms_channel_job_update(
  p_job_id uuid,
  p_status text,
  p_started_at timestamptz default null,
  p_finished_at timestamptz default null,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_channel_jobs
     set status = p_status,
         started_at = coalesce(p_started_at, started_at),
         finished_at = coalesce(p_finished_at, finished_at),
         error = p_error
   where id = p_job_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Channel job not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_oms_channel_job_log_create(
  p_job_id uuid,
  p_level text,
  p_message text,
  p_context jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  insert into public.erp_channel_job_logs (
    company_id,
    job_id,
    level,
    message,
    context
  ) values (
    v_company_id,
    p_job_id,
    p_level,
    p_message,
    p_context
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_oms_channel_job_item_update(
  p_item_id uuid,
  p_status text,
  p_last_error text default null,
  p_attempt_count int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_channel_job_items
     set status = p_status,
         last_error = p_last_error,
         attempt_count = coalesce(p_attempt_count, attempt_count)
   where id = p_item_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Channel job item not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Integrations: External inventory batches/rows
create or replace function public.erp_inventory_external_batch_create(
  p_channel_key text,
  p_marketplace_id text,
  p_type text,
  p_status text,
  p_report_type text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  insert into public.erp_external_inventory_batches (
    company_id,
    channel_key,
    marketplace_id,
    type,
    status,
    report_type
  ) values (
    v_company_id,
    p_channel_key,
    p_marketplace_id,
    p_type,
    p_status,
    p_report_type
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_external_batch_update(
  p_batch_id uuid,
  p_status text default null,
  p_error text default null,
  p_report_id text default null,
  p_report_type text default null,
  p_external_report_id text default null,
  p_report_document_id text default null,
  p_pulled_at timestamptz default null,
  p_rows_total int default null,
  p_matched_count int default null,
  p_unmatched_count int default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_external_inventory_batches
     set status = coalesce(p_status, status),
         error = p_error,
         report_id = coalesce(p_report_id, report_id),
         report_type = coalesce(p_report_type, report_type),
         external_report_id = coalesce(p_external_report_id, external_report_id),
         report_document_id = coalesce(p_report_document_id, report_document_id),
         pulled_at = coalesce(p_pulled_at, pulled_at),
         rows_total = coalesce(p_rows_total, rows_total),
         matched_count = coalesce(p_matched_count, matched_count),
         unmatched_count = coalesce(p_unmatched_count, unmatched_count)
   where id = p_batch_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Batch not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.erp_inventory_external_rows_upsert(
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_rows int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array';
  end if;

  insert into public.erp_external_inventory_rows (
    company_id,
    batch_id,
    channel_key,
    marketplace_id,
    external_sku,
    external_sku_norm,
    asin,
    fnsku,
    condition,
    qty_available,
    qty_reserved,
    qty_inbound_working,
    qty_inbound_shipped,
    qty_inbound_receiving,
    available_qty,
    reserved_qty,
    inbound_qty,
    location,
    external_location_code,
    erp_variant_id,
    matched_variant_id,
    erp_warehouse_id,
    match_status,
    raw
  )
  select
    v_company_id,
    batch_id,
    channel_key,
    marketplace_id,
    external_sku,
    external_sku_norm,
    asin,
    fnsku,
    condition,
    qty_available,
    qty_reserved,
    qty_inbound_working,
    qty_inbound_shipped,
    qty_inbound_receiving,
    available_qty,
    reserved_qty,
    inbound_qty,
    location,
    external_location_code,
    erp_variant_id,
    matched_variant_id,
    erp_warehouse_id,
    match_status,
    raw
  from jsonb_to_recordset(p_rows) as x(
    batch_id uuid,
    channel_key text,
    marketplace_id text,
    external_sku text,
    external_sku_norm text,
    asin text,
    fnsku text,
    condition text,
    qty_available int,
    qty_reserved int,
    qty_inbound_working int,
    qty_inbound_shipped int,
    qty_inbound_receiving int,
    available_qty int,
    reserved_qty int,
    inbound_qty int,
    location text,
    external_location_code text,
    erp_variant_id uuid,
    matched_variant_id uuid,
    erp_warehouse_id uuid,
    match_status text,
    raw jsonb
  )
  on conflict do nothing;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'inserted', coalesce(v_rows, 0));
end;
$$;

-- Payroll: item overrides
create or replace function public.erp_payroll_item_override_update(
  p_item_id uuid,
  p_payable_days_override numeric default null,
  p_lop_days_override numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_payroll_writer();
  end if;

  update public.erp_payroll_items
     set payable_days_override = p_payable_days_override,
         lop_days_override = p_lop_days_override
   where id = p_item_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Payroll item not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Inventory: Stocktake header update
create or replace function public.erp_inventory_stocktake_update_header(
  p_stocktake_id uuid,
  p_warehouse_id uuid,
  p_stocktake_date date,
  p_reference text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_stocktakes
     set warehouse_id = p_warehouse_id,
         stocktake_date = p_stocktake_date,
         reference = p_reference,
         notes = p_notes,
         updated_at = now()
   where id = p_stocktake_id
     and company_id = v_company_id
     and status = 'draft'
  returning id into v_id;

  if v_id is null then
    raise exception 'Stocktake not found or not editable';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
