begin;

alter table public.erp_expenses
  add column if not exists applies_to_type text null,
  add column if not exists applies_to_id uuid null,
  add column if not exists is_capitalizable boolean not null default false,
  add column if not exists allocation_method text null,
  add column if not exists allocation_fixed_total numeric null,
  add column if not exists applied_to_inventory_at timestamptz null,
  add column if not exists applied_inventory_ref text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_expenses_applies_to_type_check'
      and conrelid = 'public.erp_expenses'::regclass
  ) then
    alter table public.erp_expenses
      add constraint erp_expenses_applies_to_type_check
      check (
        applies_to_type is null
        or applies_to_type in ('period', 'grn', 'stock_transfer', 'order')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_expenses_allocation_method_check'
      and conrelid = 'public.erp_expenses'::regclass
  ) then
    alter table public.erp_expenses
      add constraint erp_expenses_allocation_method_check
      check (
        allocation_method is null
        or allocation_method in ('by_qty', 'by_value', 'fixed', 'none')
      );
  end if;
end $$;

create or replace function public.erp_expense_link_update(
  p_expense_id uuid,
  p_applies_to_type text,
  p_applies_to_id uuid,
  p_is_capitalizable boolean,
  p_allocation_method text,
  p_allocation_fixed_total numeric
)
returns public.erp_expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_expense public.erp_expenses%rowtype;
  v_applies_to_type text := nullif(btrim(p_applies_to_type), '');
  v_allocation_method text := nullif(btrim(p_allocation_method), '');
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_expense_id is null then
    raise exception 'expense_id is required';
  end if;

  if v_applies_to_type is not null
    and v_applies_to_type not in ('period', 'grn', 'stock_transfer', 'order') then
    raise exception 'Invalid applies_to_type';
  end if;

  if v_applies_to_type is not null
    and v_applies_to_type <> 'period'
    and p_applies_to_id is null then
    raise exception 'applies_to_id is required for this applies_to_type';
  end if;

  if v_applies_to_type = 'order' and coalesce(p_is_capitalizable, false) then
    raise exception 'Order expenses cannot be capitalized in phase 1';
  end if;

  if v_allocation_method is not null
    and v_allocation_method not in ('by_qty', 'by_value', 'fixed', 'none') then
    raise exception 'Invalid allocation_method';
  end if;

  update public.erp_expenses
     set applies_to_type = v_applies_to_type,
         applies_to_id = case
           when v_applies_to_type is null or v_applies_to_type = 'period' then null
           else p_applies_to_id
         end,
         is_capitalizable = coalesce(p_is_capitalizable, false),
         allocation_method = v_allocation_method,
         allocation_fixed_total = p_allocation_fixed_total,
         updated_at = now()
   where id = p_expense_id
     and company_id = v_company_id
  returning * into v_expense;

  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  return v_expense;
end;
$$;

revoke all on function public.erp_expense_link_update(
  uuid, text, uuid, boolean, text, numeric
) from public;
grant execute on function public.erp_expense_link_update(
  uuid, text, uuid, boolean, text, numeric
) to authenticated;

create or replace function public.erp_expense_apply_to_inventory(
  p_expense_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_expense public.erp_expenses%rowtype;
  v_method text;
  v_total_amount numeric;
  v_total_basis numeric := 0;
  v_allocated numeric := 0;
  v_line_count int := 0;
  v_index int := 0;
  v_posted_lines int := 0;
  v_warnings text[] := array[]::text[];
  v_missing_costs int := 0;
  v_line record;
  v_unit_cost numeric;
  v_line_amount numeric;
  v_basis numeric;
  v_warehouse_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_expense_id is null then
    raise exception 'expense_id is required';
  end if;

  select *
    into v_expense
    from public.erp_expenses e
   where e.id = p_expense_id
     and e.company_id = v_company_id
   for update;

  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  if v_expense.is_capitalizable is distinct from true then
    raise exception 'Expense is not marked as capitalizable';
  end if;

  if v_expense.applies_to_type not in ('grn', 'stock_transfer') then
    raise exception 'Expense is not linked to a GRN or stock transfer';
  end if;

  if v_expense.applied_to_inventory_at is not null then
    raise exception 'Expense already applied to inventory';
  end if;

  v_method := coalesce(nullif(btrim(v_expense.allocation_method), ''), 'by_qty');
  if v_method = 'none' then
    v_warnings := array_append(v_warnings, 'allocation_method=none defaulted to by_qty');
    v_method := 'by_qty';
  end if;

  v_total_amount := case
    when v_method = 'fixed' then coalesce(v_expense.allocation_fixed_total, v_expense.amount)
    else v_expense.amount
  end;

  if v_total_amount is null then
    raise exception 'Expense amount missing';
  end if;

  if v_expense.applies_to_type = 'grn' then
    select
      count(*),
      sum(
        case
          when v_method = 'by_value' and gl.unit_cost is not null then gl.received_qty * gl.unit_cost
          else gl.received_qty
        end
      )
    into v_line_count, v_total_basis
    from public.erp_grn_lines gl
    where gl.grn_id = v_expense.applies_to_id
      and gl.company_id = v_company_id;

    if v_line_count = 0 then
      raise exception 'No GRN lines found';
    end if;

    if v_method = 'by_value' then
      select count(*)
        into v_missing_costs
        from public.erp_grn_lines gl
       where gl.grn_id = v_expense.applies_to_id
         and gl.company_id = v_company_id
         and gl.unit_cost is null;

      if v_missing_costs > 0 then
        v_warnings := array_append(v_warnings, 'Missing unit_cost on GRN lines; used qty for allocation');
      end if;
    end if;

    if v_total_basis is null or v_total_basis <= 0 then
      raise exception 'Allocation basis total is zero';
    end if;

    v_index := 0;
    v_allocated := 0;

    for v_line in
      select
        gl.id as line_id,
        gl.variant_id,
        gl.received_qty as qty,
        gl.warehouse_id,
        gl.unit_cost
      from public.erp_grn_lines gl
      where gl.grn_id = v_expense.applies_to_id
        and gl.company_id = v_company_id
      order by gl.id
    loop
      v_index := v_index + 1;
      v_basis := case
        when v_method = 'by_value' and v_line.unit_cost is not null then v_line.qty * v_line.unit_cost
        else v_line.qty
      end;

      if v_index = v_line_count then
        v_line_amount := v_total_amount - v_allocated;
      else
        v_line_amount := (v_total_amount * v_basis / v_total_basis);
      end if;

      v_unit_cost := case when v_line.qty > 0 then v_line_amount / v_line.qty else 0 end;

      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        unit_cost,
        line_value,
        currency,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        qty,
        type,
        reason,
        ref,
        created_by,
        created_at
      )
      values (
        v_company_id,
        v_line.warehouse_id,
        v_line.variant_id,
        0,
        0,
        v_unit_cost,
        v_line_amount,
        coalesce(v_expense.currency, 'INR'),
        'adjustment',
        'EXP/' || p_expense_id::text,
        'expense',
        p_expense_id,
        v_line.line_id,
        0,
        'adjustment',
        'Landed cost expense',
        'EXP/' || p_expense_id::text,
        v_actor,
        now()
      );

      v_allocated := v_allocated + v_line_amount;
      v_posted_lines := v_posted_lines + 1;
    end loop;
  else
    select
      count(*),
      sum(l.qty)
    into v_line_count, v_total_basis
    from public.erp_stock_transfer_lines l
    where l.transfer_id = v_expense.applies_to_id
      and l.company_id = v_company_id;

    if v_line_count = 0 then
      raise exception 'No transfer lines found';
    end if;

    if v_method = 'by_value' then
      v_warnings := array_append(v_warnings, 'Transfer lines lack unit_cost; used qty for allocation');
    end if;

    if v_total_basis is null or v_total_basis <= 0 then
      raise exception 'Allocation basis total is zero';
    end if;

    select t.to_warehouse_id
      into v_warehouse_id
      from public.erp_stock_transfers t
     where t.id = v_expense.applies_to_id
       and t.company_id = v_company_id;

    if v_warehouse_id is null then
      raise exception 'Transfer header not found';
    end if;

    v_index := 0;
    v_allocated := 0;

    for v_line in
      select
        l.id as line_id,
        l.variant_id,
        l.qty
      from public.erp_stock_transfer_lines l
      where l.transfer_id = v_expense.applies_to_id
        and l.company_id = v_company_id
      order by l.id
    loop
      v_index := v_index + 1;

      if v_index = v_line_count then
        v_line_amount := v_total_amount - v_allocated;
      else
        v_line_amount := (v_total_amount * v_line.qty / v_total_basis);
      end if;

      v_unit_cost := case when v_line.qty > 0 then v_line_amount / v_line.qty else 0 end;

      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        unit_cost,
        line_value,
        currency,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        qty,
        type,
        reason,
        ref,
        created_by,
        created_at
      )
      values (
        v_company_id,
        v_warehouse_id,
        v_line.variant_id,
        0,
        0,
        v_unit_cost,
        v_line_amount,
        coalesce(v_expense.currency, 'INR'),
        'adjustment',
        'EXP/' || p_expense_id::text,
        'expense',
        p_expense_id,
        v_line.line_id,
        0,
        'adjustment',
        'Landed cost expense',
        'EXP/' || p_expense_id::text,
        v_actor,
        now()
      );

      v_allocated := v_allocated + v_line_amount;
      v_posted_lines := v_posted_lines + 1;
    end loop;
  end if;

  update public.erp_expenses
     set applied_to_inventory_at = now(),
         applied_inventory_ref = 'EXP/' || p_expense_id::text,
         updated_at = now()
   where id = p_expense_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok',
    true,
    'posted_lines',
    v_posted_lines,
    'total_allocated',
    v_total_amount,
    'warnings',
    v_warnings
  );
end;
$$;

revoke all on function public.erp_expense_apply_to_inventory(uuid) from public;
grant execute on function public.erp_expense_apply_to_inventory(uuid) to authenticated;

commit;
