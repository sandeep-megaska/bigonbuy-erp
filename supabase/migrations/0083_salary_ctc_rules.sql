-- Phase-2.2 salary structure CTC rules + payroll computation

begin;

alter table public.erp_salary_structures
  add column if not exists basic_pct numeric not null default 50,
  add column if not exists hra_pct_of_basic numeric not null default 40,
  add column if not exists allowances_mode text not null default 'remainder';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_salary_structures_allowances_mode_check'
      and conrelid = 'public.erp_salary_structures'::regclass
  ) then
    alter table public.erp_salary_structures
      add constraint erp_salary_structures_allowances_mode_check
      check (allowances_mode in ('remainder'));
  end if;
end
$$;

alter table public.erp_employee_salary_assignments
  add column if not exists ctc_monthly numeric not null default 0;

-- Update salary structure upsert to accept percent rules

drop function if exists public.erp_salary_structure_upsert(text, boolean, text, uuid);

create or replace function public.erp_salary_structure_upsert(
  p_name text,
  p_is_active boolean default true,
  p_notes text default null,
  p_basic_pct numeric default 50,
  p_hra_pct_of_basic numeric default 40,
  p_allowances_mode text default 'remainder',
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_allowances_mode text := coalesce(nullif(lower(btrim(coalesce(p_allowances_mode, ''))), ''), 'remainder');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if v_allowances_mode not in ('remainder') then
    raise exception 'allowances_mode must be remainder';
  end if;

  if p_id is null then
    insert into public.erp_salary_structures (
      company_id,
      name,
      is_active,
      notes,
      basic_pct,
      hra_pct_of_basic,
      allowances_mode,
      created_at,
      created_by
    )
    values (
      v_company_id,
      trim(p_name),
      coalesce(p_is_active, true),
      p_notes,
      coalesce(p_basic_pct, 50),
      coalesce(p_hra_pct_of_basic, 40),
      v_allowances_mode,
      now(),
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_salary_structures s
    set name = trim(p_name),
        is_active = coalesce(p_is_active, true),
        notes = p_notes,
        basic_pct = coalesce(p_basic_pct, s.basic_pct),
        hra_pct_of_basic = coalesce(p_hra_pct_of_basic, s.hra_pct_of_basic),
        allowances_mode = v_allowances_mode,
        updated_at = now(),
        updated_by = v_actor
    where s.company_id = v_company_id
      and s.id = p_id
    returning s.id into v_id;

    if v_id is null then
      raise exception 'Salary structure not found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, uuid) from public;
grant execute on function public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, uuid) to authenticated;

-- Update employee salary assignment to include CTC

drop function if exists public.erp_employee_salary_assign(uuid, uuid, date, text);

create or replace function public.erp_employee_salary_assign(
  p_employee_id uuid,
  p_salary_structure_id uuid,
  p_effective_from date,
  p_ctc_monthly numeric,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_effective_from date := coalesce(p_effective_from, current_date);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null or p_salary_structure_id is null then
    raise exception 'employee_id and salary_structure_id are required';
  end if;

  if p_ctc_monthly is null or p_ctc_monthly <= 0 then
    raise exception 'ctc_monthly is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Employee not found';
  end if;

  if not exists (
    select 1
    from public.erp_salary_structures s
    where s.id = p_salary_structure_id
      and s.company_id = v_company_id
  ) then
    raise exception 'Salary structure not found';
  end if;

  update public.erp_employee_salary_assignments a
     set effective_to = (v_effective_from - interval '1 day')::date
   where a.company_id = v_company_id
     and a.employee_id = p_employee_id
     and a.effective_to is null
     and a.effective_from <= v_effective_from;

  insert into public.erp_employee_salary_assignments (
    company_id,
    employee_id,
    salary_structure_id,
    effective_from,
    effective_to,
    ctc_monthly,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    p_salary_structure_id,
    v_effective_from,
    null,
    p_ctc_monthly,
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_employee_salary_assign(uuid, uuid, date, numeric, text) from public;
grant execute on function public.erp_employee_salary_assign(uuid, uuid, date, numeric, text) to authenticated;

-- Extend salary current RPC with CTC + structure rule info

create or replace function public.erp_employee_salary_current(
  p_employee_id uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_assignment record;
  v_can_read boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  v_can_read := exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  )
  or exists (
    select 1
    from public.erp_employees e
    where e.company_id = v_company_id
      and e.id = p_employee_id
      and e.user_id = v_actor
  );

  if not v_can_read then
    raise exception 'Not authorized';
  end if;

  select a.id,
         a.employee_id,
         a.salary_structure_id,
         a.ctc_monthly,
         s.name as structure_name,
         s.basic_pct,
         s.hra_pct_of_basic,
         s.allowances_mode,
         a.effective_from,
         a.effective_to,
         a.notes
    into v_assignment
    from public.erp_employee_salary_assignments a
    join public.erp_salary_structures s
      on s.id = a.salary_structure_id
     and s.company_id = v_company_id
   where a.company_id = v_company_id
     and a.employee_id = p_employee_id
     and a.effective_from <= current_date
     and (a.effective_to is null or a.effective_to >= current_date)
   order by a.effective_from desc
   limit 1;

  return json_build_object(
    'current', case when v_assignment.id is null then null else json_build_object(
      'id', v_assignment.id,
      'employee_id', v_assignment.employee_id,
      'salary_structure_id', v_assignment.salary_structure_id,
      'structure_name', v_assignment.structure_name,
      'ctc_monthly', v_assignment.ctc_monthly,
      'basic_pct', v_assignment.basic_pct,
      'hra_pct_of_basic', v_assignment.hra_pct_of_basic,
      'allowances_mode', v_assignment.allowances_mode,
      'effective_from', v_assignment.effective_from,
      'effective_to', v_assignment.effective_to,
      'notes', v_assignment.notes
    ) end,
    'history', coalesce((
      select json_agg(json_build_object(
        'id', a.id,
        'salary_structure_id', a.salary_structure_id,
        'structure_name', s.name,
        'ctc_monthly', a.ctc_monthly,
        'effective_from', a.effective_from,
        'effective_to', a.effective_to,
        'notes', a.notes
      ) order by a.effective_from desc)
      from public.erp_employee_salary_assignments a
      join public.erp_salary_structures s
        on s.id = a.salary_structure_id
       and s.company_id = v_company_id
      where a.company_id = v_company_id
        and a.employee_id = p_employee_id
    ), '[]'::json),
    'ot_rules', coalesce((
      select json_agg(json_build_object(
        'ot_type', r.ot_type,
        'multiplier', r.multiplier,
        'base', r.base,
        'hours_per_day', r.hours_per_day,
        'is_active', r.is_active
      ) order by r.ot_type)
      from public.erp_salary_structure_ot_rules r
      where r.company_id = v_company_id
        and r.structure_id = v_assignment.salary_structure_id
    ), '[]'::json),
    'components', coalesce((
      select json_agg(json_build_object(
        'code', c.code,
        'name', c.name,
        'component_type', c.component_type,
        'calc_mode', c.calc_mode,
        'value', c.value,
        'is_active', c.is_active
      ) order by c.code)
      from public.erp_salary_structure_components c
      where c.company_id = v_company_id
        and c.structure_id = v_assignment.salary_structure_id
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.erp_employee_salary_current(uuid) from public;
grant execute on function public.erp_employee_salary_current(uuid) to authenticated;

-- Recalculate payroll items based on CTC assignments

create or replace function public.erp_payroll_item_recalculate(p_payroll_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_ot numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_payroll_run_id uuid;
  v_employee_id uuid;
  v_year int;
  v_month int;
  v_period_start date;
  v_period_end date;
  v_assignment record;
  v_structure record;
  v_notes text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_item_id is null then
    raise exception 'payroll_item_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  select payroll_run_id,
         employee_id,
         coalesce(deductions, 0),
         notes
    into v_payroll_run_id, v_employee_id, v_deductions, v_notes
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  if not found then
    raise exception 'Payroll item not found';
  end if;

  select year, month
    into v_year, v_month
  from public.erp_payroll_runs
  where id = v_payroll_run_id
    and company_id = v_company_id;

  if v_year is null then
    raise exception 'Payroll run not found';
  end if;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;

  select a.salary_structure_id,
         a.ctc_monthly
    into v_assignment
    from public.erp_employee_salary_assignments a
   where a.company_id = v_company_id
     and a.employee_id = v_employee_id
     and a.effective_from <= v_period_end
     and (a.effective_to is null or a.effective_to >= v_period_start)
   order by a.effective_from desc
   limit 1;

  select *
    into v_structure
  from public.erp_salary_structures
  where company_id = v_company_id
    and id = v_assignment.salary_structure_id;

  if v_structure.id is not null and coalesce(v_assignment.ctc_monthly, 0) > 0 then
    v_basic := round((v_assignment.ctc_monthly * v_structure.basic_pct) / 100, 2);
    v_hra := round((v_basic * v_structure.hra_pct_of_basic) / 100, 2);
    v_allowances := greatest(round(v_assignment.ctc_monthly - v_basic - v_hra, 2), 0);
    v_notes := null;
  else
    v_basic := 0;
    v_hra := 0;
    v_allowances := 0;
    v_notes := coalesce(v_notes, 'No salary assigned');
  end if;

  select coalesce(sum(amount), 0)
    into v_ot
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY');

  v_gross := v_basic + v_hra + v_allowances + v_ot;

  update public.erp_payroll_items
    set salary_basic = v_basic,
        salary_hra = v_hra,
        salary_allowances = v_allowances,
        gross = v_gross,
        net_pay = v_gross - v_deductions,
        notes = v_notes
  where company_id = v_company_id
    and id = p_payroll_item_id;
end;
$$;

-- Payroll run generate uses CTC assignments

drop function if exists public.erp_payroll_run_generate(uuid);

create function public.erp_payroll_run_generate(
  p_payroll_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_year int;
  v_month int;
  v_status text;
  v_period_start date;
  v_period_end date;
  v_days_in_month int;
  v_employee record;
  v_structure record;
  v_assignment record;
  v_existing record;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_lop_days numeric := 0;
  v_lop_deduction numeric := 0;
  v_daily_rate numeric := 0;
  v_notes text;
  v_ot numeric := 0;
begin
  perform public.erp_require_payroll_writer();

  select year, month, status
    into v_year, v_month, v_status
  from public.erp_payroll_runs
  where id = p_payroll_run_id
    and company_id = v_company_id;

  if v_year is null then
    raise exception 'Payroll run not found';
  end if;

  if v_status = 'finalized' then
    raise exception 'Payroll run already finalized';
  end if;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  v_days_in_month := extract(day from (v_period_start + interval '1 month - 1 day'));

  for v_employee in
    select id
    from public.erp_employees
    where company_id = v_company_id
      and lifecycle_status = 'active'
  loop
    select a.salary_structure_id,
           a.ctc_monthly
      into v_assignment
      from public.erp_employee_salary_assignments a
     where a.company_id = v_company_id
       and a.employee_id = v_employee.id
       and a.effective_from <= v_period_end
       and (a.effective_to is null or a.effective_to >= v_period_start)
     order by a.effective_from desc
     limit 1;

    select *
      into v_structure
    from public.erp_salary_structures
    where company_id = v_company_id
      and id = v_assignment.salary_structure_id;

    select id,
           salary_basic,
           salary_hra,
           salary_allowances,
           deductions,
           notes
      into v_existing
    from public.erp_payroll_items
    where company_id = v_company_id
      and payroll_run_id = p_payroll_run_id
      and employee_id = v_employee.id;

    if v_structure.id is not null and coalesce(v_assignment.ctc_monthly, 0) > 0 then
      v_basic := round((v_assignment.ctc_monthly * v_structure.basic_pct) / 100, 2);
      v_hra := round((v_basic * v_structure.hra_pct_of_basic) / 100, 2);
      v_allowances := greatest(round(v_assignment.ctc_monthly - v_basic - v_hra, 2), 0);
      v_deductions := coalesce(v_existing.deductions, 0);
      v_notes := null;
    else
      v_basic := 0;
      v_hra := 0;
      v_allowances := 0;
      v_deductions := coalesce(v_existing.deductions, 0);
      v_notes := coalesce(v_existing.notes, 'No salary assigned');
    end if;

    if v_existing.id is not null then
      select coalesce(sum(amount), 0)
        into v_ot
      from public.erp_payroll_item_lines
      where company_id = v_company_id
        and payroll_item_id = v_existing.id
        and code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY');
    else
      v_ot := 0;
    end if;

    v_gross := v_basic + v_hra + v_allowances + v_ot;
    v_net := v_gross - v_deductions;

    select coalesce(sum(
      (least(lr.end_date, v_period_end) - greatest(lr.start_date, v_period_start) + 1)
    ), 0)
      into v_lop_days
    from public.erp_leave_requests lr
    join public.erp_leave_types lt
      on lt.company_id = lr.company_id
     and lt.code = lr.leave_type_code
    where lr.company_id = v_company_id
      and lr.employee_id = v_employee.id
      and lr.status = 'approved'
      and lt.is_paid = false
      and lt.is_active = true
      and lr.start_date <= v_period_end
      and lr.end_date >= v_period_start;

    v_daily_rate := case
      when v_days_in_month > 0 then (v_basic + v_hra + v_allowances) / v_days_in_month
      else 0
    end;
    v_lop_deduction := v_daily_rate * coalesce(v_lop_days, 0);
    v_deductions := coalesce(v_deductions, 0) + coalesce(v_lop_deduction, 0);
    v_net := v_gross - v_deductions;

    insert into public.erp_payroll_items (
      company_id,
      payroll_run_id,
      employee_id,
      salary_basic,
      salary_hra,
      salary_allowances,
      gross,
      deductions,
      net_pay,
      created_at,
      notes
    ) values (
      v_company_id,
      p_payroll_run_id,
      v_employee.id,
      v_basic,
      v_hra,
      v_allowances,
      v_gross,
      v_deductions,
      v_net,
      now(),
      v_notes
    )
    on conflict (company_id, payroll_run_id, employee_id)
    do update set
      salary_basic = excluded.salary_basic,
      salary_hra = excluded.salary_hra,
      salary_allowances = excluded.salary_allowances,
      gross = excluded.gross,
      deductions = excluded.deductions,
      net_pay = excluded.net_pay,
      notes = excluded.notes;
  end loop;
end;
$$;

revoke all on function public.erp_payroll_run_generate(uuid) from public;
grant execute on function public.erp_payroll_run_generate(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
