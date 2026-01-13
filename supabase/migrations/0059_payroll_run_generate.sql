-- Payroll run item generation

alter table public.erp_salary_structures
  add column if not exists basic numeric(14, 2),
  add column if not exists hra numeric(14, 2),
  add column if not exists allowances numeric(14, 2),
  add column if not exists deductions numeric(14, 2);

create or replace function public.erp_payroll_run_generate(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_year int;
  v_month int;
  v_period_start date;
  v_period_end date;
  v_employee record;
  v_comp record;
  v_basic numeric(14, 2);
  v_hra numeric(14, 2);
  v_allowances numeric(14, 2);
  v_deductions numeric(14, 2);
  v_gross numeric(14, 2);
  v_net numeric(14, 2);
begin
  perform public.erp_require_hr_writer();

  select r.company_id, r.year, r.month
    into v_company_id, v_year, v_month
    from public.erp_payroll_runs r
   where r.id = p_run_id;

  if v_company_id is null then
    raise exception 'Payroll run not found';
  end if;

  v_period_start := make_date(v_year, v_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;

  for v_employee in
    select e.id
      from public.erp_employees e
     where e.company_id = v_company_id
       and e.lifecycle_status = 'active'
  loop
    select c.*
      into v_comp
      from public.erp_employee_current_compensation c
     where c.employee_id = v_employee.id
       and c.company_id = v_company_id;

    v_basic := null;
    v_hra := null;
    v_allowances := null;
    v_deductions := null;

    if v_comp.id is not null and v_comp.salary_structure_id is not null then
      select
        coalesce(
          max(case when sc.code = 'BASIC' then coalesce(ecc.amount, sc.default_amount) end),
          s.basic
        ),
        coalesce(
          max(case when sc.code = 'HRA' then coalesce(ecc.amount, sc.default_amount) end),
          s.hra
        ),
        coalesce(
          sum(case when sc.code in ('ALLOW', 'ALLOWANCE', 'ALW') then coalesce(ecc.amount, sc.default_amount) end),
          s.allowances
        ),
        s.deductions
        into v_basic, v_hra, v_allowances, v_deductions
        from public.erp_salary_structures s
        left join public.erp_salary_components sc
          on sc.structure_id = s.id
         and sc.company_id = v_company_id
        left join public.erp_employee_compensation_components ecc
          on ecc.component_id = sc.id
         and ecc.employee_compensation_id = v_comp.id
         and ecc.company_id = v_company_id
       where s.id = v_comp.salary_structure_id
         and s.company_id = v_company_id
       group by s.basic, s.hra, s.allowances, s.deductions;
    end if;

    v_basic := coalesce(v_basic, 0);
    v_hra := coalesce(v_hra, 0);
    v_allowances := coalesce(v_allowances, 0);
    v_deductions := coalesce(v_deductions, 0);
    v_gross := v_basic + v_hra + v_allowances;
    v_net := v_gross - v_deductions;

    insert into public.erp_payroll_items (
      company_id,
      payroll_run_id,
      employee_id,
      basic,
      hra,
      allowances,
      gross,
      deductions,
      net_pay
    ) values (
      v_company_id,
      p_run_id,
      v_employee.id,
      v_basic,
      v_hra,
      v_allowances,
      v_gross,
      v_deductions,
      v_net
    )
    on conflict (company_id, payroll_run_id, employee_id)
    do update set
      basic = excluded.basic,
      hra = excluded.hra,
      allowances = excluded.allowances,
      gross = excluded.gross,
      deductions = excluded.deductions,
      net_pay = excluded.net_pay;
  end loop;
end;
$$;

revoke all on function public.erp_payroll_run_generate(uuid) from public;
grant execute on function public.erp_payroll_run_generate(uuid) to authenticated;

notify pgrst, 'reload schema';
