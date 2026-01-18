-- Fix stock transfer/return ledger postings to align with inventory ledger qty rules

create or replace function public.erp_stock_transfer_post(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_transfer record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
  v_insufficient record;
  v_sku text;
  v_warehouse_name text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_transfer
    from public.erp_stock_transfers
   where id = p_transfer_id
     and company_id = v_company_id
   for update;

  if v_transfer.id is null then
    raise exception 'Transfer not found';
  end if;

  if v_transfer.status <> 'draft' then
    raise exception 'Only draft transfers can be posted';
  end if;

  if v_transfer.from_warehouse_id = v_transfer.to_warehouse_id then
    raise exception 'Source and destination warehouses must be different';
  end if;

  select count(*) into v_total_lines
    from public.erp_stock_transfer_lines
   where transfer_id = p_transfer_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Transfer has no lines to post';
  end if;

  for v_insufficient in
    select
      l.variant_id,
      sum(l.qty) as transfer_qty,
      coalesce(sum(il.qty), 0) as on_hand
    from public.erp_stock_transfer_lines l
    left join public.erp_inventory_ledger il
      on il.company_id = v_company_id
     and il.warehouse_id = v_transfer.from_warehouse_id
     and il.variant_id = l.variant_id
    where l.transfer_id = p_transfer_id
      and l.company_id = v_company_id
    group by l.variant_id
    having coalesce(sum(il.qty), 0) < sum(l.qty)
  loop
    select sku into v_sku
      from public.erp_variants
     where id = v_insufficient.variant_id;

    select name into v_warehouse_name
      from public.erp_warehouses
     where id = v_transfer.from_warehouse_id;

    raise exception 'Insufficient stock for SKU % in %', coalesce(v_sku, v_insufficient.variant_id::text), coalesce(v_warehouse_name, 'warehouse');
  end loop;

  v_ref := 'TRANSFER:' || p_transfer_id::text;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_transfer.from_warehouse_id,
    l.variant_id,
    -abs(l.qty)::integer,
    'transfer_out',
    coalesce(nullif(trim(v_transfer.reference), ''), 'Stock transfer'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_stock_transfer_lines l
  where l.transfer_id = p_transfer_id
    and l.company_id = v_company_id;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_transfer.to_warehouse_id,
    l.variant_id,
    abs(l.qty)::integer,
    'transfer_in',
    coalesce(nullif(trim(v_transfer.reference), ''), 'Stock transfer'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_stock_transfer_lines l
  where l.transfer_id = p_transfer_id
    and l.company_id = v_company_id;

  update public.erp_stock_transfers
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_stock_transfer_lines
   where transfer_id = p_transfer_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_stock_transfer_post(uuid) from public;
grant execute on function public.erp_stock_transfer_post(uuid) to authenticated;

create or replace function public.erp_return_receipt_post(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_receipt record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
  v_type text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_receipt
    from public.erp_return_receipts
   where id = p_receipt_id
     and company_id = v_company_id
   for update;

  if v_receipt.id is null then
    raise exception 'Return receipt not found';
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'Only draft receipts can be posted';
  end if;

  select count(*) into v_total_lines
    from public.erp_return_receipt_lines
   where receipt_id = p_receipt_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Receipt has no lines to post';
  end if;

  v_type := case when v_receipt.receipt_type = 'rto' then 'rto_in' else 'return_in' end;
  v_ref := upper(v_type) || ':' || p_receipt_id::text;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_receipt.warehouse_id,
    l.variant_id,
    abs(l.qty)::integer,
    v_type,
    coalesce(nullif(trim(v_receipt.reference), ''), 'Return receipt'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_return_receipt_lines l
  where l.receipt_id = p_receipt_id
    and l.company_id = v_company_id;

  update public.erp_return_receipts
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_receipt_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_return_receipt_lines
   where receipt_id = p_receipt_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_return_receipt_post(uuid) from public;
grant execute on function public.erp_return_receipt_post(uuid) to authenticated;
