-- Update payroll generate to include LOP deductions for unpaid leave

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
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_lop_days numeric := 0;
  v_lop_deduction numeric := 0;
  v_daily_rate numeric := 0;
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
    select *
      into v_structure
    from public.erp_salary_structures
    where company_id = v_company_id
      and employee_id = v_employee.id
      and effective_from <= v_period_end
      and (effective_to is null or effective_to >= v_period_start)
    order by effective_from desc
    limit 1;

    v_basic := coalesce(v_structure.basic, 0);
    v_hra := coalesce(v_structure.hra, 0);
    v_allowances := coalesce(v_structure.allowances, 0);
    v_deductions := coalesce(v_structure.deductions, 0);

    v_gross := v_basic + v_hra + v_allowances;
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
      case when v_structure.id is null then 'No salary structure' else null end
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

notify pgrst, 'reload schema';
