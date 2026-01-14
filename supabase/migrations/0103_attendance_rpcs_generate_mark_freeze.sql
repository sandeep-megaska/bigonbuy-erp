-- Sprint-2D: attendance generation, bulk marking, and freeze controls

create table if not exists public.erp_hr_attendance_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  month_start date not null,
  status text not null default 'open',
  frozen_at timestamptz null,
  frozen_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_attendance_periods_status_check
    check (status in ('open', 'frozen')),
  constraint erp_hr_attendance_periods_company_month_unique
    unique (company_id, month_start)
);

create index if not exists erp_hr_attendance_periods_company_month_idx
  on public.erp_hr_attendance_periods (company_id, month);


drop trigger if exists erp_hr_attendance_periods_set_updated_at on public.erp_hr_attendance_periods;
create trigger erp_hr_attendance_periods_set_updated_at
before update on public.erp_hr_attendance_periods
for each row execute function public.erp_set_updated_at();

do $$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(c.oid)
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.erp_hr_attendance_days'::regclass
     and c.contype = 'c'
     and c.conname = 'erp_hr_attendance_days_status_check';

  if v_constraint is null then
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'weekly_off', 'holiday', 'leave', 'unmarked'));
  elsif v_constraint not ilike '%unmarked%' then
    alter table public.erp_hr_attendance_days
      drop constraint erp_hr_attendance_days_status_check;
    alter table public.erp_hr_attendance_days
      add constraint erp_hr_attendance_days_status_check
      check (status in ('present', 'absent', 'weekly_off', 'holiday', 'leave', 'unmarked'));
  end if;
end
$$;

create or replace function public.erp_attendance_generate_month(
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
    month_start,
    status,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_month_start,
    'open',
    now(),
    now()
  ) on conflict (company_id, month_start) do nothing;

  if exists (
    select 1
      from public.erp_hr_attendance_periods p
     where p.company_id = v_company_id
       and p.month_start = v_month_start
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
$$;

revoke all on function public.erp_attendance_generate_month(date, uuid[]) from public;
grant execute on function public.erp_attendance_generate_month(date, uuid[]) to authenticated;

create or replace function public.erp_attendance_mark_bulk(
  p_month date,
  p_employee_ids uuid[],
  p_action text,
  p_days date[] default null,
  p_note text default null
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
  v_target_days date[];
  v_only_unmarked boolean := false;
  v_updated integer := 0;
begin
  if p_month is null then
    raise exception 'Month is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_ids is null or array_length(p_employee_ids, 1) is null then
    raise exception 'Employee list is required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_action not in ('mark_present_weekdays', 'mark_absent', 'set_unmarked', 'set_present') then
    raise exception 'Invalid action %', p_action;
  end if;

  v_month_start := date_trunc('month', p_month)::date;
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  insert into public.erp_hr_attendance_periods (
    company_id,
    month_start,
    status,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_month_start,
    'open',
    now(),
    now()
  ) on conflict (company_id, month_start) do nothing;

  if exists (
    select 1
      from public.erp_hr_attendance_periods p
     where p.company_id = v_company_id
       and p.month_start = v_month_start
       and p.status = 'frozen'
  ) then
    raise exception 'Attendance period is frozen';
  end if;

  if p_days is null then
    v_only_unmarked := true;
    if p_action = 'mark_present_weekdays' then
      select array_agg(d.day order by d.day)
        into v_target_days
        from generate_series(v_month_start, v_month_end, interval '1 day') as d(day)
       where extract(isodow from d.day) between 1 and 5;
    else
      select array_agg(d.day order by d.day)
        into v_target_days
        from generate_series(v_month_start, v_month_end, interval '1 day') as d(day);
    end if;
  else
    select array_agg(d)
      into v_target_days
      from unnest(p_days) as d
     where d between v_month_start and v_month_end;
  end if;

  if v_target_days is null or array_length(v_target_days, 1) is null then
    return 0;
  end if;

  if p_action = 'mark_present_weekdays' then
    update public.erp_hr_attendance_days ad
       set status = 'present',
           source = 'manual',
           notes = coalesce(p_note, ad.notes),
           updated_at = now()
     where ad.company_id = v_company_id
       and ad.employee_id = any(p_employee_ids)
       and ad.day = any(v_target_days)
       and ad.status = 'unmarked'
       and ad.source <> 'leave';
  elsif p_action = 'mark_absent' then
    update public.erp_hr_attendance_days ad
       set status = 'absent',
           source = 'manual',
           notes = coalesce(p_note, ad.notes),
           updated_at = now()
     where ad.company_id = v_company_id
       and ad.employee_id = any(p_employee_ids)
       and ad.day = any(v_target_days)
       and ad.status = 'unmarked'
       and ad.source <> 'leave';
  elsif p_action = 'set_unmarked' then
    update public.erp_hr_attendance_days ad
       set status = 'unmarked',
           source = 'manual',
           notes = coalesce(p_note, ad.notes),
           updated_at = now()
     where ad.company_id = v_company_id
       and ad.employee_id = any(p_employee_ids)
       and ad.day = any(v_target_days)
       and (
         (v_only_unmarked and ad.status = 'unmarked')
         or (not v_only_unmarked and ad.status in ('present', 'absent', 'unmarked'))
       )
       and ad.source <> 'leave';
  elsif p_action = 'set_present' then
    update public.erp_hr_attendance_days ad
       set status = 'present',
           source = 'manual',
           notes = coalesce(p_note, ad.notes),
           updated_at = now()
     where ad.company_id = v_company_id
       and ad.employee_id = any(p_employee_ids)
       and ad.day = any(v_target_days)
       and (
         (v_only_unmarked and ad.status = 'unmarked')
         or (not v_only_unmarked and ad.status in ('unmarked', 'absent', 'present'))
       )
       and ad.source <> 'leave'
       and ad.status not in ('holiday', 'weekly_off');
  end if;

  get diagnostics v_updated = row_count;

  return v_updated;
end;
$$;

revoke all on function public.erp_attendance_mark_bulk(date, uuid[], text, date[], text) from public;
grant execute on function public.erp_attendance_mark_bulk(date, uuid[], text, date[], text) to authenticated;

create or replace function public.erp_attendance_freeze_month(
  p_month date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month_start date;
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

  insert into public.erp_hr_attendance_periods (
    company_id,
    month_start,
    status,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_month_start,
    'open',
    now(),
    now()
  ) on conflict (company_id, month_start) do nothing;

  update public.erp_hr_attendance_periods
     set status = 'frozen',
         frozen_at = now(),
         frozen_by = v_actor,
         updated_at = now()
   where company_id = v_company_id
     and month_start = v_month_start;
end;
$$;

revoke all on function public.erp_attendance_freeze_month(date) from public;
grant execute on function public.erp_attendance_freeze_month(date) to authenticated;

create or replace function public.erp_attendance_unfreeze_month(
  p_month date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_month_start date;
begin
  if p_month is null then
    raise exception 'Month is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
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

  v_month_start := date_trunc('month', p_month)::date;

  insert into public.erp_hr_attendance_periods (
    company_id,
    month_start,
    status,
    created_at,
    updated_at
  ) values (
    v_company_id,
    v_month_start,
    'open',
    now(),
    now()
  ) on conflict (company_id, month_start) do nothing;

  update public.erp_hr_attendance_periods
     set status = 'open',
         frozen_at = null,
         frozen_by = null,
         updated_at = now()
   where company_id = v_company_id
     and month_start = v_month_start;
end;
$$;

revoke all on function public.erp_attendance_unfreeze_month(date) from public;
grant execute on function public.erp_attendance_unfreeze_month(date) to authenticated;

create or replace view public.erp_hr_attendance_monthly_summary_v
with (security_invoker = true) as
select
  ad.company_id,
  ad.employee_id,
  date_trunc('month', ad.day)::date as month,
  sum(case when ad.status = 'present' then 1 else 0 end)::numeric as present_days,
  sum(case when ad.status = 'leave' then 1 else 0 end)::numeric as leave_days,
  sum(case when ad.status = 'absent' then 1 else 0 end)::numeric as lop_days,
  sum(case when ad.status = 'holiday' then 1 else 0 end)::numeric as holiday_days,
  sum(case when ad.status = 'weekly_off' then 1 else 0 end)::numeric as weekly_off_days,
  sum(case when ad.status = 'unmarked' then 1 else 0 end)::numeric as unmarked_days
from public.erp_hr_attendance_days ad
group by
  ad.company_id,
  ad.employee_id,
  date_trunc('month', ad.day)::date;

-- Tests (manual)
-- select public.erp_attendance_generate_month(current_date, null);
-- select public.erp_attendance_mark_bulk(current_date, array['00000000-0000-0000-0000-000000000000']::uuid[], 'mark_present_weekdays', null, 'bulk mark');
-- select public.erp_attendance_freeze_month(current_date);
-- select public.erp_attendance_unfreeze_month(current_date);
-- select * from public.erp_hr_attendance_monthly_summary_v
-- order by month desc, employee_id;
