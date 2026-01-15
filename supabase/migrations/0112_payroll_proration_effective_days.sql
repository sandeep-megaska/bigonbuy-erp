-- 0112_payroll_proration_effective_days.sql
-- Apply optional payroll proration based on suggested/override payable and LOP days

begin;

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
  v_days_in_month int;
  v_assignment record;
  v_structure record;
  v_notes text;
  v_payable_days_suggested numeric;
  v_lop_days_suggested numeric;
  v_payable_days_override numeric;
  v_lop_days_override numeric;
  v_payable_days_effective numeric;
  v_lop_days_effective numeric;
  v_proration_factor numeric := 1;
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
         notes,
         payable_days_suggested,
         lop_days_suggested,
         payable_days_override,
         lop_days_override
    into v_payroll_run_id,
         v_employee_id,
         v_deductions,
         v_notes,
         v_payable_days_suggested,
         v_lop_days_suggested,
         v_payable_days_override,
         v_lop_days_override
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
  v_days_in_month := extract(day from (v_period_start + interval '1 month - 1 day'));

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

  v_payable_days_effective := coalesce(v_payable_days_override, v_payable_days_suggested);
  v_lop_days_effective := coalesce(v_lop_days_override, v_lop_days_suggested);

  if v_payable_days_effective is null and v_lop_days_effective is not null then
    v_payable_days_effective := greatest(v_days_in_month - v_lop_days_effective, 0);
  end if;

  if v_payable_days_effective is not null and v_days_in_month > 0 then
    v_proration_factor := v_payable_days_effective / v_days_in_month;
    v_basic := round(v_basic * v_proration_factor, 2);
    v_hra := round(v_hra * v_proration_factor, 2);
    v_allowances := round(v_allowances * v_proration_factor, 2);
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

revoke all on function public.erp_payroll_item_recalculate(uuid) from public;
grant execute on function public.erp_payroll_item_recalculate(uuid) to authenticated;

create or replace function public.erp_payroll_run_generate(
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
  v_payable_days_effective numeric;
  v_lop_days_effective numeric;
  v_proration_factor numeric := 1;
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
           notes,
           payable_days_suggested,
           lop_days_suggested,
           payable_days_override,
           lop_days_override
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

    v_payable_days_effective := coalesce(v_existing.payable_days_override, v_existing.payable_days_suggested);
    v_lop_days_effective := coalesce(v_existing.lop_days_override, v_existing.lop_days_suggested);

    if v_payable_days_effective is null and v_lop_days_effective is not null then
      v_payable_days_effective := greatest(v_days_in_month - v_lop_days_effective, 0);
    end if;

    if v_payable_days_effective is not null and v_days_in_month > 0 then
      v_proration_factor := v_payable_days_effective / v_days_in_month;
      v_basic := round(v_basic * v_proration_factor, 2);
      v_hra := round(v_hra * v_proration_factor, 2);
      v_allowances := round(v_allowances * v_proration_factor, 2);
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

    if v_payable_days_effective is null then
      -- LOP days: approved leave requests where leave type code = 'LOP'
      select coalesce(sum(
        (least(lr.end_date, v_period_end) - greatest(lr.start_date, v_period_start) + 1)
      ), 0)
        into v_lop_days
      from public.erp_leave_requests lr
      join public.erp_leave_types lt
        on lt.company_id = lr.company_id
       and lt.id = lr.leave_type_id
      where lr.company_id = v_company_id
        and lr.employee_id = v_employee.id
        and lr.status = 'approved'
        and lt.is_active = true
        and lt.code = 'LOP'
        and lr.start_date <= v_period_end
        and lr.end_date >= v_period_start;

      v_daily_rate := case
        when v_days_in_month > 0 then (v_basic + v_hra + v_allowances) / v_days_in_month
        else 0
      end;
      v_lop_deduction := v_daily_rate * coalesce(v_lop_days, 0);
      v_deductions := coalesce(v_deductions, 0) + coalesce(v_lop_deduction, 0);
      v_net := v_gross - v_deductions;
    end if;

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
