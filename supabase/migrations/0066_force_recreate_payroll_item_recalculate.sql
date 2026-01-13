drop function if exists public.erp_payroll_item_recalculate(uuid);

create function public.erp_payroll_item_recalculate(p_payroll_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_variable_earnings numeric := 0;
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
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.erp_payroll_items
    where company_id = v_company_id and id = p_payroll_item_id
  ) then
    raise exception 'Payroll item not found';
  end if;

  select
    coalesce(salary_basic, 0),
    coalesce(salary_hra, 0),
    coalesce(salary_allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  select coalesce(sum(amount), 0)
    into v_variable_earnings
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT');

  v_gross := v_basic + v_hra + v_allowances + v_variable_earnings;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;
end;
$$;

revoke all on function public.erp_payroll_item_recalculate(uuid) from public;
grant execute on function public.erp_payroll_item_recalculate(uuid) to authenticated;

notify pgrst, 'reload schema';
