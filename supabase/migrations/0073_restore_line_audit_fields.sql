-- 0073_restore_line_audit_fields.sql
-- Restore updated_at/updated_by updates on payroll_item_lines (these columns exist)
-- Keep payroll_items updates clean (no updated_at/updated_by)

begin;

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
    trim(p_code),
    null,
    p_units,
    p_rate,
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
    and code = 'OT';

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

commit;
