-- Sprint-2A: attendance calendar RPCs

create or replace function public.erp_calendar_for_employee(
  p_employee_id uuid,
  p_on_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_calendar_id uuid;
  v_actor uuid := auth.uid();
  v_is_authorized boolean := false;
begin
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

    if not v_is_authorized and p_employee_id is not null then
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

  -- TODO: derive employee work location once work-location mapping exists.
  select c.id
    into v_calendar_id
  from public.erp_calendars c
  where c.company_id = v_company_id
    and c.is_default = true
  limit 1;

  return v_calendar_id;
end;
$$;

revoke all on function public.erp_calendar_for_employee(uuid, date) from public;
grant execute on function public.erp_calendar_for_employee(uuid, date) to authenticated;

create or replace function public.erp_is_holiday(
  p_employee_id uuid,
  p_on_date date
)
returns table(
  is_holiday boolean,
  holiday_id uuid,
  holiday_name text,
  holiday_type text,
  is_optional boolean,
  calendar_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calendar_id uuid;
begin
  v_calendar_id := public.erp_calendar_for_employee(p_employee_id, p_on_date);

  if v_calendar_id is null then
    return query
    select false, null::uuid, null::text, null::text, null::boolean, null::uuid;
    return;
  end if;

  return query
  select true,
         h.id,
         h.name,
         h.holiday_type,
         h.is_optional,
         h.calendar_id
    from public.erp_calendar_holidays h
   where h.company_id = public.erp_current_company_id()
     and h.calendar_id = v_calendar_id
     and h.holiday_date = p_on_date
   limit 1;

  if not found then
    return query
    select false, null::uuid, null::text, null::text, null::boolean, null::uuid;
  end if;
end;
$$;

revoke all on function public.erp_is_holiday(uuid, date) from public;
grant execute on function public.erp_is_holiday(uuid, date) to authenticated;

-- Tests (manual)
-- insert into public.erp_calendars (code, name, timezone, is_default)
-- values ('std', 'Standard Calendar', 'UTC', true)
-- returning id;
--
-- insert into public.erp_calendar_holidays (calendar_id, holiday_date, name, holiday_type)
-- values ('00000000-0000-0000-0000-000000000000', current_date, 'Holiday', 'public');
--
-- select *
-- from public.erp_is_holiday('00000000-0000-0000-0000-000000000000', current_date);
