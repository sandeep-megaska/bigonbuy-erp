-- 0072_fix_payroll_recalc_no_is_deduction.sql
-- Recalc must not reference erp_payroll_item_lines.is_deduction (column doesn't exist)
-- Keep it OT-safe: gross = salary_* + OT; net = gross - deductions

begin;

-- Drop ALL overloads and recreate canonical
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname='erp_payroll_item_recalculate'
  loop
    execute 'drop function if exists ' || r.sig || ';';
  end loop;
end $$;

create or replace function public.erp_payroll_item_recalculate(p_payroll_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_ot numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
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

  -- Base pay from salary_* (0067 keeps legacy columns synced)
  select
    coalesce(salary_basic, 0),
    coalesce(salary_hra, 0),
    coalesce(salary_allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  if not found then
    raise exception 'Payroll item not found';
  end if;

  -- OT lines only (no is_deduction assumption)
  select coalesce(sum(amount), 0)
    into v_ot
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code = 'OT';

  v_gross := v_basic + v_hra + v_allowances + v_ot;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;
end;
$function$;

commit;
