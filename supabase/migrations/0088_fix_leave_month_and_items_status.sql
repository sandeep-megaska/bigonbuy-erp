-- Fix leave request joins to use leave_type_id and refresh payroll run item status RPC

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
     and lt.id = lr.leave_type_id
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

drop function if exists public.erp_leave_request_submit(uuid,text,date,date,text);
drop function if exists public.erp_leave_request_submit(uuid,text,date,date);
drop function if exists public.erp_leave_request_submit(uuid,uuid,date,date,text);

create or replace function public.erp_leave_request_submit(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_request_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_leave_type_id is null then
    raise exception 'leave_type_id is required';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'start_date and end_date are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'start_date cannot be after end_date';
  end if;

  if not (
    exists (
      select 1
      from public.erp_employees e
      where e.company_id = v_company_id
        and e.id = p_employee_id
        and e.user_id = v_actor
    )
    or exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = v_actor
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner','admin','hr','payroll')
    )
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_leave_types lt
    where lt.company_id = v_company_id
      and lt.id = p_leave_type_id
      and lt.is_active = true
  ) then
    raise exception 'Leave type not found or inactive';
  end if;

  insert into public.erp_leave_requests(
    company_id, employee_id, leave_type_id, start_date, end_date, reason, status
  ) values (
    v_company_id, p_employee_id, p_leave_type_id, p_start_date, p_end_date, p_reason, 'submitted'
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

revoke all on function public.erp_leave_request_submit(uuid,uuid,date,date,text) from public;
grant execute on function public.erp_leave_request_submit(uuid,uuid,date,date,text) to authenticated;

drop function if exists public.erp_payroll_run_items_status(uuid);

create function public.erp_payroll_run_items_status(p_payroll_run_id uuid)
returns table (
  payroll_item_id uuid,
  employee_id uuid,
  has_salary_assignment boolean,
  assignment_effective_from date,
  ctc_monthly numeric,
  structure_name text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_year int;
  v_month int;
  v_month_start date;
  v_month_end date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_run_id is null then
    raise exception 'payroll_run_id is required';
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

  select pr.year, pr.month
    into v_year, v_month
  from public.erp_payroll_runs pr
  where pr.company_id = v_company_id
    and pr.id = p_payroll_run_id;

  if not found then
    raise exception 'Payroll run not found';
  end if;

  v_month_start := make_date(v_year, v_month, 1);
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  return query
  select pi.id,
         pi.employee_id,
         (a.id is not null) as has_salary_assignment,
         a.effective_from,
         a.ctc_monthly,
         ss.name
  from public.erp_payroll_items pi
  left join lateral (
    select a.*
    from public.erp_employee_salary_assignments a
    where a.company_id = v_company_id
      and a.employee_id = pi.employee_id
      and a.effective_from <= v_month_end
      and (a.effective_to is null or a.effective_to >= v_month_start)
    order by a.effective_from desc
    limit 1
  ) a on true
  left join public.erp_salary_structures ss
    on ss.id = a.salary_structure_id
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_payroll_run_id;
end;
$function$;

revoke all on function public.erp_payroll_run_items_status(uuid) from public;
grant execute on function public.erp_payroll_run_items_status(uuid) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then null;
end $$;
