-- Sprint-2B: attendance non-working day RPC

create or replace function public.erp_non_working_day(
  p_employee_id uuid,
  p_on_date date
)
returns table(
  is_non_working boolean,
  reason text,
  holiday_name text,
  matched_rule_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holiday record;
  v_weekly_off record;
begin
  select *
    into v_holiday
  from public.erp_is_holiday(p_employee_id, p_on_date)
  limit 1;

  if v_holiday.is_holiday then
    return query
    select true,
           'holiday'::text,
           v_holiday.holiday_name,
           null::uuid;
    return;
  end if;

  select *
    into v_weekly_off
  from public.erp_is_weekly_off(p_employee_id, p_on_date)
  limit 1;

  if v_weekly_off.is_weekly_off then
    return query
    select true,
           'weekly_off'::text,
           null::text,
           v_weekly_off.matched_rule_id;
    return;
  end if;

  return query
  select false,
         null::text,
         null::text,
         null::uuid;
end;
$$;

revoke all on function public.erp_non_working_day(uuid, date) from public;
grant execute on function public.erp_non_working_day(uuid, date) to authenticated;

-- Tests (manual)
-- select *
-- from public.erp_non_working_day('00000000-0000-0000-0000-000000000000', current_date);
--
-- select *
-- from public.erp_non_working_day('00000000-0000-0000-0000-000000000000', '2026-01-04');
