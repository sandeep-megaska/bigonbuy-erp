-- Payroll LOP deduction based on unpaid leave requests

create or replace function public.erp_payroll_run_generate(p_run_id uuid)
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
  v_days_in_month numeric;
  v_employee record;
  v_structure record;
  v_basic numeric(14, 2);
  v_hra numeric(14, 2);
  v_allowances numeric(14, 2);
  v_deductions numeric(14, 2);
  v_gross numeric(14, 2);
  v_net numeric(14, 2);
  v_notes text;
  v_lop_days numeric(14, 2);
  v_daily_rate numeric(14, 6);
  v_lop_deduction numeric(14, 2);
begin
  perform public.erp_require_payroll_writer();

  select r.year, r.month, r.status
    into v_year, v_month, v_status
    from public.erp_payroll_runs r
   where r.id = p_run_id
     and r.company_id = v_company_id;

  if v_year is null then
    raise exception 'Payroll run not found';
  end if;

  if v_status = 'finalized' then
    raise exception 'Payroll run is finalized';
  end if;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  v_days_in_month := extract(day from v_period_end);

  for v_employee in
    select e.id
      from public.erp_employees e
     where e.company_id = v_company_id
       and e.lifecycle_status = 'active'
  loop
    select s.*
      into v_structure
      from public.erp_salary_structures s
     where s.company_id = v_company_id
       and s.employee_id = v_employee.id
       and s.effective_from <= v_period_end
       and (s.effective_to is null or s.effective_to >= v_period_end)
     order by s.effective_from desc
     limit 1;

    if v_structure.id is null then
      v_basic := 0;
      v_hra := 0;
      v_allowances := 0;
      v_deductions := 0;
      v_notes := 'No salary structure';
    else
      v_basic := coalesce(v_structure.basic, 0);
      v_hra := coalesce(v_structure.hra, 0);
      v_allowances := coalesce(v_structure.allowances, 0);
      v_deductions := coalesce(v_structure.deductions, 0);
      v_notes := null;
    end if;

    select coalesce(sum((least(lr.end_date, v_period_end) - greatest(lr.start_date, v_period_start) + 1)), 0)
      into v_lop_days
      from public.erp_leave_requests lr
      join public.erp_leave_types lt
        on lt.company_id = lr.company_id
       and lt.code = lr.leave_type_code
     where lr.company_id = v_company_id
       and lr.employee_id = v_employee.id
       and lr.status = 'approved'
       and lt.is_paid = false
       and lr.start_date <= v_period_end
       and lr.end_date >= v_period_start;

    v_daily_rate := 0;
    if v_days_in_month > 0 then
      v_daily_rate := (v_basic + v_hra + v_allowances) / v_days_in_month;
    end if;

    v_lop_deduction := coalesce(v_lop_days, 0) * v_daily_rate;
    v_deductions := v_deductions + coalesce(v_lop_deduction, 0);

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
      notes,
      created_at
    ) values (
      v_company_id,
      p_run_id,
      v_employee.id,
      v_basic,
      v_hra,
      v_allowances,
      v_gross,
      v_deductions,
      v_net,
      v_notes,
      now()
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
