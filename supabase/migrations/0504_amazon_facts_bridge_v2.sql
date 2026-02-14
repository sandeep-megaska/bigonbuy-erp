-- 0504_amazon_facts_bridge_v2.sql
-- OMS -> Facts bridge, service-role safe by passing company_id explicitly.

create or replace function public.erp_amazon_order_facts_upsert_from_oms_v2(
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

  -- Derived refresh allowed
  delete from public.erp_amazon_order_facts f
  where f.company_id = p_company_id
    and (p_marketplace_id is null or f.marketplace_id = p_marketplace_id)
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to;

  insert into public.erp_amazon_order_facts (
    id,
    company_id,
    marketplace_id,
    amazon_order_id,
    order_status,
    purchase_date,
    currency,
    order_total,
    buyer_email,
    ship_state,
    ship_city,
    ship_postal_code,
    source_run_id,
    payload,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  select
    gen_random_uuid(),
    o.company_id,
    o.marketplace_id,
    o.amazon_order_id,
    o.order_status,
    o.purchase_date,
    o.currency,
    o.order_total,
    o.buyer_email,
    o.ship_state,
    o.ship_city,
    o.ship_postal_code,
    o.source_run_id,
    coalesce(o.payload, '{}'::jsonb),
    now(),
    null::uuid,
    now(),
    null::uuid
  from public.erp_amazon_orders o
  where o.company_id = p_company_id
    and (p_marketplace_id is null or o.marketplace_id = p_marketplace_id)
    and o.purchase_date::date >= v_from
    and o.purchase_date::date <= v_to;

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

-- Acceptance SQL (run after push)
-- select public.erp_amazon_order_facts_upsert_from_oms_v2(public.erp_current_company_id(), current_date - 30, current_date, 'A21TJRUUN4KGV');
-- select max(purchase_date::date) as max_facts from public.erp_amazon_order_facts where company_id = public.erp_current_company_id();
