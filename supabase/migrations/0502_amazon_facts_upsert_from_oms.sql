-- 0502_amazon_facts_upsert_from_oms.sql
-- Bridge: OMS (erp_amazon_orders) -> Analytics Facts (erp_amazon_order_facts)
-- Facts table is ORDER-LEVEL in this schema.

create or replace function public.erp_amazon_order_facts_upsert_from_oms_v1(
  p_from date default null,
  p_to date default null,
  p_marketplace_id text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_from date;
  v_to date;
  v_rows int := 0;
begin
  v_company_id := public.erp_current_company_id();
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  -- Default window: last 60 days
  v_to := coalesce(p_to, current_date);
  v_from := coalesce(p_from, (v_to - 60));

  -- Derived table refresh is allowed
  delete from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
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
    gen_random_uuid() as id,
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
    coalesce(o.payload, '{}'::jsonb) as payload,
    now() as created_at,
    null::uuid as created_by,
    now() as updated_at,
    null::uuid as updated_by
  from public.erp_amazon_orders o
  where o.company_id = v_company_id
    and (p_marketplace_id is null or o.marketplace_id = p_marketplace_id)
    and o.purchase_date::date >= v_from
    and o.purchase_date::date <= v_to;

  get diagnostics v_rows = row_count;

  return json_build_object(
    'ok', true,
    'company_id', v_company_id,
    'from', v_from,
    'to', v_to,
    'marketplace_id', p_marketplace_id,
    'facts_rows_inserted', v_rows
  );
end;
$$;

-- Acceptance SQL (run after migration)
-- 1) Facts should track OMS max date
-- select max(purchase_date::date) as oms_max from public.erp_amazon_orders where company_id = public.erp_current_company_id();
-- select max(purchase_date::date) as facts_max from public.erp_amazon_order_facts where company_id = public.erp_current_company_id();

-- 2) Counts within window should be close (facts == orders, unless you have filters elsewhere)
-- select count(*) from public.erp_amazon_orders where company_id = public.erp_current_company_id() and purchase_date::date >= current_date - 30;
-- select count(*) from public.erp_amazon_order_facts where company_id = public.erp_current_company_id() and purchase_date::date >= current_date - 30;
