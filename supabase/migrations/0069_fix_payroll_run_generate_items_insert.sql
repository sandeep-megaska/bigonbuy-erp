-- Fix payroll run generate insert for payroll_items without created_by/updated_by columns

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
  v_employee record;
  v_structure record;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_net numeric := 0;
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
