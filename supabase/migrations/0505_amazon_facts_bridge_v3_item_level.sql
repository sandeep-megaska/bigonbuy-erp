-- 0505_amazon_facts_bridge_v3_item_level.sql
-- Bridge: OMS -> Facts (item-level), service-role safe.

create or replace function public.erp_amazon_order_facts_upsert_from_oms_v3(
  p_company_id uuid,
  p_from date default null,
  p_to date default null,
  p_marketplace_id text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
  v_rows int := 0;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  v_to := coalesce(p_to, current_date);
  v_from := coalesce(p_from, (v_to - 60));

  -- Delete window (facts are derived)
  delete from public.erp_amazon_order_facts f
  where f.company_id = p_company_id
    and (p_marketplace_id is null or f.marketplace_id = p_marketplace_id)
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to;

  -- Insert item-level facts from OMS items + orders
  -- IMPORTANT: We only write columns that MUST exist for your unique constraint + common fields.
  insert into public.erp_amazon_order_facts (
    id,
    company_id,
    marketplace_id,
    amazon_order_id,
    order_item_id,
    purchase_date,
    order_status,
    currency,
    asin,
    external_sku,
    quantity,
    item_amount,
    item_tax,
    shipping_amount,
    shipping_tax,
    promo_discount,
    buyer_email,
    ship_state,
    ship_city,
    ship_postal_code,
    mapped_variant_id,
    erp_sku,
    style_code,
    size,
    color,
    source_run_id,
    payload,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  select
    gen_random_uuid(),
    i.company_id,
    i.marketplace_id,
    i.amazon_order_id,
    i.order_item_id,
    i.purchase_date,
    i.order_status,
    coalesce(i.currency, o.currency),
    i.asin,
    i.external_sku,
    coalesce(i.quantity,0),
    coalesce(i.item_amount,0),
    coalesce(i.item_tax,0),
    coalesce(i.shipping_amount,0),
    coalesce(i.shipping_tax,0),
    coalesce(i.promo_discount,0),
    coalesce(i.buyer_email, o.buyer_email),
    coalesce(i.ship_state, o.ship_state),
    coalesce(i.ship_city, o.ship_city),
    coalesce(i.ship_postal_code, o.ship_postal_code),
    i.mapped_variant_id,
    i.erp_sku,
    i.style_code,
    i.size,
    i.color,
    i.source_run_id,
    coalesce(i.payload, '{}'::jsonb),
    now(),
    null::uuid,
    now(),
    null::uuid
  from public.erp_amazon_order_items i
  left join public.erp_amazon_orders o
    on o.company_id = i.company_id
   and o.marketplace_id = i.marketplace_id
   and o.amazon_order_id = i.amazon_order_id
  where i.company_id = p_company_id
    and (p_marketplace_id is null or i.marketplace_id = p_marketplace_id)
    and i.purchase_date::date >= v_from
    and i.purchase_date::date <= v_to;

  get diagnostics v_rows = row_count;

  return json_build_object(
    'ok', true,
    'company_id', p_company_id,
    'from', v_from,
    'to', v_to,
    'marketplace_id', p_marketplace_id,
    'facts_rows_inserted', v_rows
  );
end;
$$;

-- Acceptance
-- select public.erp_amazon_order_facts_upsert_from_oms_v3(public.erp_current_company_id(), current_date - 45, current_date, 'A21TJRUUN4KGV');
-- select max(purchase_date::date) as max_facts from public.erp_amazon_order_facts where company_id = public.erp_current_company_id();
