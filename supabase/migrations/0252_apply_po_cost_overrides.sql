-- Apply PO unit costs into SKU cost overrides
create or replace function public.erp_sku_cost_overrides_apply_from_po(
  p_po_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_effective_from date;
  v_doc_no text;
  v_updated int := 0;
  v_applied_at timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  select
    po.order_date,
    coalesce(po.doc_no, po.po_no, po.id::text)
  into
    v_effective_from,
    v_doc_no
  from public.erp_purchase_orders po
  where po.id = p_po_id
    and po.company_id = v_company_id;

  if not found then
    raise exception 'Purchase order not found.';
  end if;

  if v_effective_from is null then
    v_effective_from := current_date;
  end if;

  with line_items as (
    select distinct
      v.sku,
      pol.unit_cost
    from public.erp_purchase_order_lines pol
    join public.erp_variants v
      on v.id = pol.variant_id
      and v.company_id = v_company_id
    where pol.purchase_order_id = p_po_id
      and pol.company_id = v_company_id
      and pol.unit_cost is not null
  ), upserted as (
    insert into public.erp_sku_cost_overrides (
      company_id,
      sku,
      unit_cost,
      effective_from,
      notes
    )
    select
      v_company_id,
      upper(trim(line_items.sku)),
      line_items.unit_cost,
      v_effective_from,
      concat('Source: PO ', v_doc_no)
    from line_items
    on conflict (company_id, sku, effective_from)
    do update set
      unit_cost = excluded.unit_cost,
      notes = excluded.notes
    returning sku
  )
  select count(*) into v_updated from upserted;

  return jsonb_build_object(
    'ok', true,
    'updated', coalesce(v_updated, 0),
    'applied_at', v_applied_at,
    'effective_from', v_effective_from
  );
end;
$$;

revoke all on function public.erp_sku_cost_overrides_apply_from_po(uuid) from public;
grant execute on function public.erp_sku_cost_overrides_apply_from_po(uuid) to authenticated;
