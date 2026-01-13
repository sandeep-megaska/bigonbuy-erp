-- Payroll run create + generate updates

create unique index if not exists erp_payroll_runs_company_year_month_key
  on public.erp_payroll_runs (company_id, year, month);

create unique index if not exists erp_payroll_items_company_run_employee_key
  on public.erp_payroll_items (company_id, payroll_run_id, employee_id);

alter table public.erp_payroll_items
  add column if not exists salary_basic numeric(14, 2),
  add column if not exists salary_hra numeric(14, 2),
  add column if not exists salary_allowances numeric(14, 2);

create or replace function public.erp_require_payroll_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_payroll_writer() from public;
grant execute on function public.erp_require_payroll_writer() to authenticated;

create or replace function public.erp_payroll_run_create(
  p_year int,
  p_month int,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_run_id uuid;
begin
  perform public.erp_require_payroll_writer();

  if p_year is null or p_month is null then
    raise exception 'year and month are required';
  end if;

  if exists (
    select 1
    from public.erp_payroll_runs r
    where r.company_id = v_company_id
      and r.year = p_year
      and r.month = p_month
  ) then
    raise exception 'Payroll run already exists for this period';
  end if;

  insert into public.erp_payroll_runs (
    company_id,
    year,
    month,
    status,
    notes,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_year,
    p_month,
    'draft',
    p_notes,
    v_actor,
    v_actor
  ) returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.erp_payroll_run_create(int, int, text) from public;
grant execute on function public.erp_payroll_run_create(int, int, text) to authenticated;

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
  v_employee record;
  v_structure record;
  v_basic numeric(14, 2);
  v_hra numeric(14, 2);
  v_allowances numeric(14, 2);
  v_deductions numeric(14, 2);
  v_gross numeric(14, 2);
  v_net numeric(14, 2);
  v_notes text;
  v_actor uuid := auth.uid();
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

    v_gross := v_basic + v_hra + v_allowances;
    v_net := v_gross - v_deductions;

    insert into public.erp_payroll_items (
      company_id,
      payroll_run_id,
      employee_id,
      salary_basic,
      salary_hra,
      salary_allowances,
      basic,
      hra,
      allowances,
      gross,
      deductions,
      net_pay,
      notes,
      updated_by
    ) values (
      v_company_id,
      p_payroll_run_id,
      v_employee.id,
      v_basic,
      v_hra,
      v_allowances,
      v_basic,
      v_hra,
      v_allowances,
      v_gross,
      v_deductions,
      v_net,
      v_notes,
      v_actor
    )
    on conflict (company_id, payroll_run_id, employee_id)
    do update set
      salary_basic = excluded.salary_basic,
      salary_hra = excluded.salary_hra,
      salary_allowances = excluded.salary_allowances,
      basic = excluded.basic,
      hra = excluded.hra,
      allowances = excluded.allowances,
      gross = excluded.gross,
      deductions = excluded.deductions,
      net_pay = excluded.net_pay,
      notes = excluded.notes,
      updated_by = excluded.updated_by;
  end loop;
end;
$$;

revoke all on function public.erp_payroll_run_generate(uuid) from public;
grant execute on function public.erp_payroll_run_generate(uuid) to authenticated;

notify pgrst, 'reload schema';
