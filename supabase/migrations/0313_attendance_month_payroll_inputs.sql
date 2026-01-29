create table if not exists public.erp_attendance_month_payroll_inputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  month date not null,
  employee_id uuid not null,
  present_days numeric(6,2) not null default 0,
  absent_days numeric(6,2) not null default 0,
  paid_leave_days numeric(6,2) not null default 0,
  ot_hours numeric(6,2) not null default 0,
  source text not null default 'grid',
  notes text null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  constraint erp_attendance_month_payroll_inputs_company_month_employee_unique
    unique (company_id, month, employee_id)
);

create index if not exists erp_attendance_month_payroll_inputs_company_month_idx
  on public.erp_attendance_month_payroll_inputs (company_id, month);

alter table public.erp_attendance_month_payroll_inputs enable row level security;
alter table public.erp_attendance_month_payroll_inputs force row level security;

do $$
begin
  drop policy if exists erp_attendance_month_payroll_inputs_select
    on public.erp_attendance_month_payroll_inputs;
  drop policy if exists erp_attendance_month_payroll_inputs_write
    on public.erp_attendance_month_payroll_inputs;

  create policy erp_attendance_month_payroll_inputs_select
    on public.erp_attendance_month_payroll_inputs
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
      )
    );

  create policy erp_attendance_month_payroll_inputs_write
    on public.erp_attendance_month_payroll_inputs
    for all
    using (false)
    with check (false);
end
$$;

create or replace function public.erp_attendance_month_payroll_inputs_get(
  p_month date,
  p_employee_ids uuid[] default null
)
returns table (
  employee_id uuid,
  present_days numeric,
  absent_days numeric,
  paid_leave_days numeric,
  ot_hours numeric,
  source text,
  notes text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  v_month := date_trunc('month', p_month)::date;

  return query
  select
    i.employee_id,
    i.present_days,
    i.absent_days,
    i.paid_leave_days,
    i.ot_hours,
    i.source,
    i.notes,
    i.updated_at
  from public.erp_attendance_month_payroll_inputs i
  where i.company_id = v_company_id
    and i.month = v_month
    and (p_employee_ids is null or i.employee_id = any(p_employee_ids))
  order by i.employee_id;
end;
$$;

revoke all on function public.erp_attendance_month_payroll_inputs_get(date, uuid[]) from public;
grant execute on function public.erp_attendance_month_payroll_inputs_get(date, uuid[]) to authenticated;

create or replace function public.erp_attendance_month_payroll_inputs_recompute_from_grid(
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
  v_present_days numeric(6,2) := 0;
  v_absent_days numeric(6,2) := 0;
  v_paid_leave_days numeric(6,2) := 0;
  v_ot_hours numeric(6,2) := 0;
  v_override_active boolean := false;
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

  select coalesce(o.use_override, false)
    into v_override_active
    from public.erp_attendance_month_overrides o
   where o.company_id = v_company_id
     and o.month = v_month
     and o.employee_id = p_employee_id;

  if v_override_active then
    return;
  end if;

  select
    count(*) filter (where ad.status = 'present')::numeric(6,2),
    count(*) filter (where ad.status = 'absent')::numeric(6,2),
    count(*) filter (where ad.status = 'leave')::numeric(6,2)
    into v_present_days, v_absent_days, v_paid_leave_days
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day >= v_month
     and ad.day < (v_month + interval '1 month');

  select coalesce(i.ot_hours, 0)
    into v_ot_hours
    from public.erp_attendance_month_payroll_inputs i
   where i.company_id = v_company_id
     and i.month = v_month
     and i.employee_id = p_employee_id;

  insert into public.erp_attendance_month_payroll_inputs (
    company_id,
    month,
    employee_id,
    present_days,
    absent_days,
    paid_leave_days,
    ot_hours,
    source,
    notes,
    updated_at,
    updated_by_user_id
  ) values (
    v_company_id,
    v_month,
    p_employee_id,
    coalesce(v_present_days, 0),
    coalesce(v_absent_days, 0),
    coalesce(v_paid_leave_days, 0),
    coalesce(v_ot_hours, 0),
    'grid',
    null,
    now(),
    auth.uid()
  )
  on conflict (company_id, month, employee_id) do update
    set present_days = excluded.present_days,
        absent_days = excluded.absent_days,
        paid_leave_days = excluded.paid_leave_days,
        ot_hours = excluded.ot_hours,
        source = excluded.source,
        notes = excluded.notes,
        updated_at = now(),
        updated_by_user_id = auth.uid();
end;
$$;

revoke all on function public.erp_attendance_month_payroll_inputs_recompute_from_grid(date, uuid) from public;
grant execute on function public.erp_attendance_month_payroll_inputs_recompute_from_grid(date, uuid) to authenticated;

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
  v_present_days numeric(6,2) := 0;
  v_absent_days numeric(6,2) := 0;
  v_paid_leave_days numeric(6,2) := 0;
  v_use_override boolean := coalesce(p_use_override, true);
  v_effective_present numeric(6,2) := 0;
  v_effective_absent numeric(6,2) := 0;
  v_effective_paid_leave numeric(6,2) := 0;
  v_ot_hours_input numeric(6,2) := null;
  v_existing_ot_hours numeric(6,2) := 0;
  v_effective_ot_hours numeric(6,2) := 0;
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

  if p_ot_minutes is not null then
    v_ot_hours_input := round((p_ot_minutes::numeric / 60), 2);
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
    count(*) filter (where ad.status = 'present')::numeric(6,2),
    count(*) filter (where ad.status = 'absent')::numeric(6,2),
    count(*) filter (where ad.status = 'leave')::numeric(6,2)
    into v_present_days, v_absent_days, v_paid_leave_days
    from public.erp_hr_attendance_days ad
   where ad.company_id = v_company_id
     and ad.employee_id = p_employee_id
     and ad.day >= v_month
     and ad.day < (v_month + interval '1 month');

  if v_use_override then
    v_effective_present := coalesce(p_present_days, v_present_days);
    v_effective_absent := coalesce(p_absent_days, v_absent_days);
    v_effective_paid_leave := coalesce(p_paid_leave_days, v_paid_leave_days);
    select coalesce(i.ot_hours, 0)
      into v_existing_ot_hours
      from public.erp_attendance_month_payroll_inputs i
     where i.company_id = v_company_id
       and i.month = v_month
       and i.employee_id = p_employee_id;

    v_effective_ot_hours := coalesce(v_ot_hours_input, v_existing_ot_hours, 0);

    insert into public.erp_attendance_month_payroll_inputs (
      company_id,
      month,
      employee_id,
      present_days,
      absent_days,
      paid_leave_days,
      ot_hours,
      source,
      notes,
      updated_at,
      updated_by_user_id
    ) values (
      v_company_id,
      v_month,
      p_employee_id,
      v_effective_present,
      v_effective_absent,
      v_effective_paid_leave,
      v_effective_ot_hours,
      'override',
      p_notes,
      now(),
      auth.uid()
    )
    on conflict (company_id, month, employee_id) do update
      set present_days = excluded.present_days,
          absent_days = excluded.absent_days,
          paid_leave_days = excluded.paid_leave_days,
          ot_hours = excluded.ot_hours,
          source = excluded.source,
          notes = excluded.notes,
          updated_at = now(),
          updated_by_user_id = auth.uid();
  else
    if v_ot_hours_input is not null then
      insert into public.erp_attendance_month_payroll_inputs (
        company_id,
        month,
        employee_id,
        ot_hours,
        source,
        updated_at,
        updated_by_user_id
      ) values (
        v_company_id,
        v_month,
        p_employee_id,
        v_ot_hours_input,
        'grid',
        now(),
        auth.uid()
      )
      on conflict (company_id, month, employee_id) do update
        set ot_hours = excluded.ot_hours,
            updated_at = now(),
            updated_by_user_id = auth.uid();
    end if;

    perform public.erp_attendance_month_payroll_inputs_recompute_from_grid(v_month, p_employee_id);
  end if;

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

  perform public.erp_attendance_month_payroll_inputs_recompute_from_grid(v_month, p_employee_id);
end;
$$;

revoke all on function public.erp_attendance_month_override_clear(date, uuid) from public;
grant execute on function public.erp_attendance_month_override_clear(date, uuid) to authenticated;

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
      i.employee_id,
      i.present_days,
      i.paid_leave_days,
      i.absent_days
    from public.erp_attendance_month_payroll_inputs i
   where i.company_id = v_company_id
     and i.month = v_month_start
  )
  update public.erp_payroll_items pi
     set payable_days_suggested = (
           coalesce(summary.present_days, 0)
           + coalesce(summary.paid_leave_days, 0)
         )::numeric(6,2),
         lop_days_suggested = coalesce(summary.absent_days, 0)::numeric(6,2),
         present_days_suggested = coalesce(summary.present_days, 0)::numeric(6,2),
         paid_leave_days_suggested = coalesce(summary.paid_leave_days, 0)::numeric(6,2),
         unpaid_leave_days_suggested = 0::numeric(6,2),
         attendance_source = 'attendance_v3'
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
