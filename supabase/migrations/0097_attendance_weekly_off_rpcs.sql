-- Sprint-2B: attendance weekly off RPCs

create or replace function public.erp_employee_location_id(
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
  v_location_id uuid;
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

  select j.location_id
    into v_location_id
  from public.erp_employee_jobs j
  where j.company_id = v_company_id
    and j.employee_id = p_employee_id
    and j.effective_from <= p_on_date
    and (j.effective_to is null or j.effective_to >= p_on_date)
  order by j.effective_from desc, j.created_at desc
  limit 1;

  return v_location_id;
end;
$$;

revoke all on function public.erp_employee_location_id(uuid, date) from public;
grant execute on function public.erp_employee_location_id(uuid, date) to authenticated;

create or replace function public.erp_is_weekly_off(
  p_employee_id uuid,
  p_on_date date
)
returns table(
  is_weekly_off boolean,
  matched_rule_id uuid,
  matched_scope text,
  weekday int,
  week_of_month int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_weekday int := extract(dow from p_on_date)::int;
  v_week_of_month int := ((extract(day from p_on_date)::int - 1) / 7) + 1;
  v_rule record;
  v_location_id uuid;
  v_actor uuid := auth.uid();
  v_is_authorized boolean := false;
begin
  if v_company_id is null then
    return query
    select false, null::uuid, null::text, null::int, null::int;
    return;
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

  select r.id,
         r.weekday,
         r.week_of_month
    into v_rule
  from public.erp_weekly_off_rules r
  where r.company_id = v_company_id
    and r.scope_type = 'employee'
    and r.employee_id = p_employee_id
    and r.weekday = v_weekday
    and (r.week_of_month is null or r.week_of_month = v_week_of_month)
    and r.effective_from <= p_on_date
    and (r.effective_to is null or r.effective_to >= p_on_date)
  order by (case when r.week_of_month is null then 1 else 0 end),
           r.effective_from desc
  limit 1;

  if found then
    return query
    select true, v_rule.id, 'employee', v_rule.weekday, v_rule.week_of_month;
    return;
  end if;

  v_location_id := public.erp_employee_location_id(p_employee_id, p_on_date);

  if v_location_id is not null then
    select r.id,
           r.weekday,
           r.week_of_month
      into v_rule
    from public.erp_weekly_off_rules r
    where r.company_id = v_company_id
      and r.scope_type = 'location'
      and r.location_id = v_location_id
      and r.weekday = v_weekday
      and (r.week_of_month is null or r.week_of_month = v_week_of_month)
      and r.effective_from <= p_on_date
      and (r.effective_to is null or r.effective_to >= p_on_date)
    order by (case when r.week_of_month is null then 1 else 0 end),
             r.effective_from desc
    limit 1;

    if found then
      return query
      select true, v_rule.id, 'location', v_rule.weekday, v_rule.week_of_month;
      return;
    end if;
  end if;

  return query
  select false, null::uuid, null::text, null::int, null::int;
end;
$$;

revoke all on function public.erp_is_weekly_off(uuid, date) from public;
grant execute on function public.erp_is_weekly_off(uuid, date) to authenticated;

-- Tests (manual)
-- select *
-- from public.erp_is_weekly_off('00000000-0000-0000-0000-000000000000', '2026-01-04');
--
-- select *
-- from public.erp_is_weekly_off('00000000-0000-0000-0000-000000000000', '2026-02-14');
