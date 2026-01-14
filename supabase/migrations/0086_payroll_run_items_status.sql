create or replace function public.erp_payroll_run_items_status(p_payroll_run_id uuid)
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

drop function if exists public.erp_payroll_item_line_upsert(uuid,text,numeric,numeric,numeric,text);

create or replace function public.erp_payroll_item_line_upsert(
  p_payroll_item_id uuid,
  p_code text,
  p_units numeric,
  p_rate numeric,
  p_amount numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_ot numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
  v_amount numeric := coalesce(p_amount, coalesce(p_units, 0) * coalesce(p_rate, 0));
  v_rate numeric := p_rate;
  v_code text := upper(trim(p_code));
  v_ot_type text;
  v_multiplier numeric;
  v_base text;
  v_hours_per_day numeric;
  v_year int;
  v_month int;
  v_period_start date;
  v_period_end date;
  v_days_in_month int;
  v_employee_id uuid;
  v_structure_id uuid;
  v_base_amount numeric := 0;
  v_base_hourly numeric := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_item_id is null or p_code is null or length(trim(p_code)) = 0 then
    raise exception 'payroll_item_id and code are required';
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
    from public.erp_payroll_items pi
    where pi.id = p_payroll_item_id
      and pi.company_id = v_company_id
  ) then
    raise exception 'Payroll item not found';
  end if;

  v_ot_type := case
    when v_code in ('OT', 'OT_NORMAL') then 'normal'
    when v_code = 'OT_HOLIDAY' then 'holiday'
    else null
  end;

  if v_ot_type is not null then
    select pi.employee_id,
           pr.year,
           pr.month,
           coalesce(pi.salary_basic, 0),
           coalesce(pi.salary_hra, 0),
           coalesce(pi.salary_allowances, 0)
      into v_employee_id, v_year, v_month, v_basic, v_hra, v_allowances
      from public.erp_payroll_items pi
      join public.erp_payroll_runs pr
        on pr.id = pi.payroll_run_id
     where pi.id = p_payroll_item_id
       and pi.company_id = v_company_id;

    v_period_start := make_date(v_year, v_month, 1);
    v_period_end := (v_period_start + interval '1 month - 1 day')::date;
    v_days_in_month := extract(day from (v_period_start + interval '1 month - 1 day'));

    select a.salary_structure_id
      into v_structure_id
      from public.erp_employee_salary_assignments a
     where a.company_id = v_company_id
       and a.employee_id = v_employee_id
       and a.effective_from <= v_period_end
       and (a.effective_to is null or a.effective_to >= v_period_start)
     order by a.effective_from desc
     limit 1;

    if v_structure_id is null then
      raise exception 'Salary assignment missing for this employee for this payroll month';
    end if;

    select r.multiplier,
           r.base,
           r.hours_per_day
      into v_multiplier, v_base, v_hours_per_day
      from public.erp_salary_structure_ot_rules r
     where r.company_id = v_company_id
       and r.structure_id = v_structure_id
       and r.ot_type = v_ot_type
       and r.is_active = true
     order by r.created_at desc
     limit 1;

    if v_multiplier is not null then
      v_base_amount := case when v_base = 'gross_hourly'
        then v_basic + v_hra + v_allowances
        else v_basic
      end;
      v_hours_per_day := coalesce(nullif(v_hours_per_day, 0), 8);
      if v_days_in_month > 0 and v_hours_per_day > 0 then
        v_base_hourly := v_base_amount / v_days_in_month / v_hours_per_day;
      else
        v_base_hourly := 0;
      end if;
      v_rate := v_base_hourly * v_multiplier;
      v_amount := coalesce(p_units, 0) * v_rate;
    end if;
  end if;

  insert into public.erp_payroll_item_lines (
    company_id,
    payroll_item_id,
    code,
    name,
    units,
    rate,
    amount,
    notes,
    created_by
  ) values (
    v_company_id,
    p_payroll_item_id,
    v_code,
    null,
    p_units,
    v_rate,
    v_amount,
    p_notes,
    v_actor
  )
  on conflict (company_id, payroll_item_id, code)
  do update set
    units = excluded.units,
    rate = excluded.rate,
    amount = excluded.amount,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_line_id;

  -- OT total
  select coalesce(sum(amount), 0)
    into v_ot
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY');

  -- salary base from payroll_items
  select
    coalesce(salary_basic, 0),
    coalesce(salary_hra, 0),
    coalesce(salary_allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  v_gross := v_basic + v_hra + v_allowances + v_ot;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;

  return v_line_id;
end;
$function$;

revoke all on function public.erp_payroll_item_line_upsert(uuid, text, numeric, numeric, numeric, text) from public;
grant execute on function public.erp_payroll_item_line_upsert(uuid, text, numeric, numeric, numeric, text) to authenticated;
