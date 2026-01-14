-- 0105_fix_attendance_period_column_month.sql
-- Fix attendance period column name: use "month" (not month_start)

create or replace function public.erp_attendance_generate_month(
  p_month date,
  p_employee_ids uuid[] default null::uuid[]
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month_start date;
  v_month_end date;
  v_employee_ids uuid[];
  v_inserted integer := 0;
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

  insert into public.erp_hr_attendance_periods (
    company_id,
    month,
    status,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_month_start,
    'open',
    now(),
    now()
  )
  on conflict (company_id, month) do nothing;

  if exists (
    select 1
      from public.erp_hr_attendance_periods p
     where p.company_id = v_company_id
       and p.month = v_month_start
       and p.status = 'frozen'
  ) then
    raise exception 'Attendance period is frozen';
  end if;

  if p_employee_ids is null then
    select array_agg(e.id order by e.id)
      into v_employee_ids
      from public.erp_employees e
     where e.company_id = v_company_id
       and e.lifecycle_status = 'active';
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

  with dates as (
    select generate_series(v_month_start, v_month_end, interval '1 day')::date as day
  ),
  target_employees as (
    select unnest(v_employee_ids) as employee_id
  )
  insert into public.erp_hr_attendance_days (
    company_id,
    employee_id,
    day,
    status,
    source,
    created_at,
    updated_at
  )
  select
    v_company_id,
    te.employee_id,
    d.day,
    case
      when nwd.reason = 'holiday' then 'holiday'
      when nwd.reason = 'weekly_off' then 'weekly_off'
      else 'unmarked'
    end,
    'system',
    now(),
    now()
  from target_employees te
  cross join dates d
  left join lateral public.erp_non_working_day(te.employee_id, d.day) nwd on true
  left join public.erp_hr_attendance_days ad
    on ad.company_id = v_company_id
   and ad.employee_id = te.employee_id
   and ad.day = d.day
  where ad.id is null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;
create or replace function public.erp_attendance_period_is_frozen(p_day date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.erp_hr_attendance_periods p
    where p.company_id = public.erp_current_company_id()
      and p.month = date_trunc('month', p_day)::date
      and p.status = 'frozen'
  );
$$;
create or replace function public.erp_attendance_freeze_month(p_month date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month date := date_trunc('month', p_month)::date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_hr_attendance_periods (company_id, month, status, created_at, updated_at)
  values (v_company_id, v_month, 'open', now(), now())
  on conflict (company_id, month) do nothing;

  update public.erp_hr_attendance_periods
     set status = 'frozen',
         frozen_at = now(),
         frozen_by = v_actor,
         updated_at = now()
   where company_id = v_company_id
     and month = v_month;
end;
$$;

create or replace function public.erp_attendance_unfreeze_month(p_month date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month date := date_trunc('month', p_month)::date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Keep this stricter if you want (owner/admin). For now mirror freeze gate.
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  update public.erp_hr_attendance_periods
     set status = 'open',
         frozen_at = null,
         frozen_by = null,
         updated_at = now()
   where company_id = v_company_id
     and month = v_month;
end;
$$;
