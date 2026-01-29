-- Attendance month effective totals (stored final values)

create table if not exists public.erp_attendance_month_effective (
  company_id uuid not null,
  month date not null,
  employee_id uuid not null,
  present_days numeric(5, 2) not null default 0,
  absent_days numeric(5, 2) not null default 0,
  paid_leave_days numeric(5, 2) not null default 0,
  ot_minutes int not null default 0,
  source text not null default 'computed',
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid,
  constraint erp_attendance_month_effective_company_month_employee_unique
    unique (company_id, month, employee_id)
);

create index if not exists erp_attendance_month_effective_company_month_idx
  on public.erp_attendance_month_effective (company_id, month);

drop trigger if exists erp_attendance_month_effective_set_updated_at
  on public.erp_attendance_month_effective;
create trigger erp_attendance_month_effective_set_updated_at
before update on public.erp_attendance_month_effective
for each row execute function public.erp_set_updated_at();

alter table public.erp_attendance_month_effective enable row level security;
alter table public.erp_attendance_month_effective force row level security;

do $$
begin
  drop policy if exists erp_attendance_month_effective_select
    on public.erp_attendance_month_effective;
  drop policy if exists erp_attendance_month_effective_write
    on public.erp_attendance_month_effective;

  create policy erp_attendance_month_effective_select
    on public.erp_attendance_month_effective
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_attendance_month_effective_write
    on public.erp_attendance_month_effective
    for all
    using (false)
    with check (false);
end
$$;

create or replace function public.erp_attendance_month_effective_recompute(
  p_month date,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
  v_present_days numeric(5, 2) := 0;
  v_absent_days numeric(5, 2) := 0;
  v_paid_leave_days numeric(5, 2) := 0;
  v_ot_minutes int := 0;
begin
  if p_month is null or p_employee_id is null then
    raise exception 'Month and employee are required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  select
    coalesce(s.present_days, 0)::numeric(5, 2),
    coalesce(s.absent_days, 0)::numeric(5, 2),
    coalesce(s.leave_paid_days, 0)::numeric(5, 2)
    into v_present_days, v_absent_days, v_paid_leave_days
    from public.erp_attendance_payroll_month_summary_v s
   where s.company_id = v_company_id
     and s.employee_id = p_employee_id
     and s.month = v_month;

  select
    sum(case when ad.status = 'present' then coalesce(ad.ot_minutes, 0) else 0 end)::int
    into v_ot_minutes
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day >= v_month
     and ad.day < (v_month + interval '1 month');

  v_ot_minutes := coalesce(v_ot_minutes, 0);

  insert into public.erp_attendance_month_effective (
    company_id,
    month,
    employee_id,
    present_days,
    absent_days,
    paid_leave_days,
    ot_minutes,
    source,
    updated_at,
    updated_by_user_id
  ) values (
    v_company_id,
    v_month,
    p_employee_id,
    v_present_days,
    v_absent_days,
    v_paid_leave_days,
    v_ot_minutes,
    'computed',
    now(),
    auth.uid()
  )
  on conflict (company_id, month, employee_id) do update
    set present_days = excluded.present_days,
        absent_days = excluded.absent_days,
        paid_leave_days = excluded.paid_leave_days,
        ot_minutes = excluded.ot_minutes,
        source = 'computed',
        updated_at = now(),
        updated_by_user_id = auth.uid();
end;
$$;

revoke all on function public.erp_attendance_month_effective_recompute(date, uuid) from public;
grant execute on function public.erp_attendance_month_effective_recompute(date, uuid) to authenticated;

create or replace function public.erp_attendance_month_override_upsert(
  p_month date,
  p_employee_id uuid,
  p_present_days numeric default null,
  p_absent_days numeric default null,
  p_paid_leave_days numeric default null,
  p_ot_minutes int default null,
  p_use_override boolean default true,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
  v_id uuid;
  v_present_days numeric(5, 2) := 0;
  v_absent_days numeric(5, 2) := 0;
  v_paid_leave_days numeric(5, 2) := 0;
  v_ot_minutes int := 0;
  v_use_override boolean := coalesce(p_use_override, true);
  v_effective_present numeric(5, 2) := 0;
  v_effective_absent numeric(5, 2) := 0;
  v_effective_paid_leave numeric(5, 2) := 0;
  v_effective_ot int := 0;
  v_source text := 'computed';
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  insert into public.erp_attendance_month_overrides (
    company_id,
    month,
    employee_id,
    present_days_override,
    absent_days_override,
    paid_leave_days_override,
    ot_minutes_override,
    use_override,
    notes,
    created_at,
    updated_at,
    updated_by_user_id
  ) values (
    v_company_id,
    v_month,
    p_employee_id,
    p_present_days,
    p_absent_days,
    p_paid_leave_days,
    p_ot_minutes,
    v_use_override,
    p_notes,
    now(),
    now(),
    auth.uid()
  )
  on conflict (company_id, month, employee_id) do update
    set present_days_override = excluded.present_days_override,
        absent_days_override = excluded.absent_days_override,
        paid_leave_days_override = excluded.paid_leave_days_override,
        ot_minutes_override = excluded.ot_minutes_override,
        use_override = excluded.use_override,
        notes = excluded.notes,
        updated_at = now(),
        updated_by_user_id = auth.uid()
  returning id into v_id;

  select
    coalesce(s.present_days, 0)::numeric(5, 2),
    coalesce(s.absent_days, 0)::numeric(5, 2),
    coalesce(s.leave_paid_days, 0)::numeric(5, 2)
    into v_present_days, v_absent_days, v_paid_leave_days
    from public.erp_attendance_payroll_month_summary_v s
   where s.company_id = v_company_id
     and s.employee_id = p_employee_id
     and s.month = v_month;

  select
    sum(case when ad.status = 'present' then coalesce(ad.ot_minutes, 0) else 0 end)::int
    into v_ot_minutes
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day >= v_month
     and ad.day < (v_month + interval '1 month');

  v_ot_minutes := coalesce(v_ot_minutes, 0);

  if v_use_override then
    v_effective_present := coalesce(p_present_days, v_present_days);
    v_effective_absent := coalesce(p_absent_days, v_absent_days);
    v_effective_paid_leave := coalesce(p_paid_leave_days, v_paid_leave_days);
    v_effective_ot := coalesce(p_ot_minutes, v_ot_minutes);
    v_source := 'override';
  else
    v_effective_present := v_present_days;
    v_effective_absent := v_absent_days;
    v_effective_paid_leave := v_paid_leave_days;
    v_effective_ot := v_ot_minutes;
    v_source := 'computed';
  end if;

  insert into public.erp_attendance_month_effective (
    company_id,
    month,
    employee_id,
    present_days,
    absent_days,
    paid_leave_days,
    ot_minutes,
    source,
    updated_at,
    updated_by_user_id
  ) values (
    v_company_id,
    v_month,
    p_employee_id,
    v_effective_present,
    v_effective_absent,
    v_effective_paid_leave,
    v_effective_ot,
    v_source,
    now(),
    auth.uid()
  )
  on conflict (company_id, month, employee_id) do update
    set present_days = excluded.present_days,
        absent_days = excluded.absent_days,
        paid_leave_days = excluded.paid_leave_days,
        ot_minutes = excluded.ot_minutes,
        source = excluded.source,
        updated_at = now(),
        updated_by_user_id = auth.uid();

  return v_id;
end;
$$;

revoke all on function public.erp_attendance_month_override_upsert(date, uuid, numeric, numeric, numeric, int, boolean, text) from public;
grant execute on function public.erp_attendance_month_override_upsert(date, uuid, numeric, numeric, numeric, int, boolean, text) to authenticated;

create or replace function public.erp_attendance_month_override_clear(
  p_month date,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
begin
  perform public.erp_require_hr_writer();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  delete from public.erp_attendance_month_overrides o
   where o.company_id = v_company_id
     and o.employee_id = p_employee_id
     and o.month = v_month;

  perform public.erp_attendance_month_effective_recompute(v_month, p_employee_id);
end;
$$;

revoke all on function public.erp_attendance_month_override_clear(date, uuid) from public;
grant execute on function public.erp_attendance_month_override_clear(date, uuid) to authenticated;

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
  v_month date;
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

  v_month := date_trunc('month', p_day)::date;
  perform public.erp_attendance_month_effective_recompute(v_month, p_employee_id);
end;
$$;

revoke all on function public.erp_attendance_upsert_check_times(uuid, date, timestamptz, timestamptz, text, text) from public;
grant execute on function public.erp_attendance_upsert_check_times(uuid, date, timestamptz, timestamptz, text, text) to authenticated;

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
  v_month date;
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

  v_month := date_trunc('month', p_day)::date;
  perform public.erp_attendance_month_effective_recompute(v_month, p_employee_id);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

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
  v_employee_id uuid;
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

  foreach v_employee_id in array v_employee_ids
  loop
    perform public.erp_attendance_month_effective_recompute(v_month_start, v_employee_id);
  end loop;

  return v_updated;
end;
$$;

create or replace function public.erp_payroll_run_attach_attendance(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_year int;
  v_month int;
  v_month_start date;
  v_attendance_status text;
  v_updated_count integer := 0;
begin
  perform public.erp_require_hr_writer();

  select r.company_id, r.year, r.month
    into v_company_id, v_year, v_month
    from public.erp_payroll_runs r
   where r.id = p_run_id;

  if v_company_id is null then
    raise exception 'Payroll run not found';
  end if;

  v_month_start := make_date(v_year, v_month, 1);

  select ap.status
    into v_attendance_status
    from public.erp_hr_attendance_periods ap
   where ap.company_id = v_company_id
     and ap.month = v_month_start;

  with summary as (
    select
      e.employee_id,
      e.present_days as present_days,
      e.paid_leave_days as paid_leave_days,
      e.absent_days as absent_days,
      e.ot_minutes as ot_minutes,
      coalesce(ms.leave_unpaid_days, 0)::numeric as leave_unpaid_days,
      coalesce(ms.holiday_days, 0)::numeric as holiday_days,
      coalesce(ms.weekly_off_days, 0)::numeric as weekly_off_days
    from public.erp_attendance_month_effective e
    left join public.erp_attendance_payroll_month_summary_v ms
      on ms.company_id = v_company_id
     and ms.employee_id = e.employee_id
     and ms.month = v_month_start
   where e.company_id = v_company_id
     and e.month = v_month_start
  )
  update public.erp_payroll_items pi
     set payable_days_suggested = (
           coalesce(summary.present_days, 0)
           + coalesce(summary.paid_leave_days, 0)
           + coalesce(summary.holiday_days, 0)
           + coalesce(summary.weekly_off_days, 0)
         )::numeric(6,2),
         lop_days_suggested = (
           coalesce(summary.absent_days, 0)
           + coalesce(summary.leave_unpaid_days, 0)
         )::numeric(6,2),
         present_days_suggested = coalesce(summary.present_days, 0)::numeric(6,2),
         paid_leave_days_suggested = coalesce(summary.paid_leave_days, 0)::numeric(6,2),
         unpaid_leave_days_suggested = coalesce(summary.leave_unpaid_days, 0)::numeric(6,2),
         attendance_source = 'attendance_v2'
    from summary
   where pi.company_id = v_company_id
     and pi.payroll_run_id = p_run_id
     and summary.employee_id = pi.employee_id;

  get diagnostics v_updated_count = row_count;

  update public.erp_payroll_runs r
     set attendance_month = v_month_start,
         attendance_period_status = v_attendance_status,
         attendance_snapshot_at = now(),
         attendance_snapshot_by = auth.uid()
   where r.id = p_run_id;

  return v_updated_count;
end;
$$;

notify pgrst, 'reload schema';
