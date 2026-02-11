-- 0479_mkt_channel_revenue_builder.sql
-- Purpose:
-- Build daily revenue facts for marketing intelligence.
-- This RPC expects upstream ERP sales posting queries to be plugged into
-- the "source_query" CTE (Shopify / Amazon / other channels).

create or replace function public.erp_mkt_channel_revenue_daily_refresh_v1(
  p_company_id uuid,
  p_from_date date,
  p_to_date date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_rows int := 0;
begin

  /*
    Replace the source_query logic to match your canonical ERP posting tables.
    Example structure expected:

      channel   text
      dt        date
      orders    int
      units     int
      revenue   numeric
  */

  with source_query as (

      /* ===== SHOPIFY ===== */
      select
        company_id,
        'shopify'::text as channel,
        order_date::date as dt,
        count(*) as orders_count,
        sum(quantity) as units_count,
        sum(net_revenue) as net_revenue
      from public.erp_sales_orders_posted   -- <-- adjust later
      where company_id = p_company_id
        and order_date between p_from_date and p_to_date
        and sales_channel = 'shopify'
      group by company_id, dt

      union all

      /* ===== AMAZON ===== */
      select
        company_id,
        'amazon'::text as channel,
        settlement_date::date as dt,
        count(distinct settlement_id) as orders_count,
        null::int as units_count,
        sum(net_amount) as net_revenue
      from public.erp_marketplace_settlement_posts   -- <-- adjust later
      where company_id = p_company_id
        and settlement_date between p_from_date and p_to_date
        and marketplace = 'amazon'
      group by company_id, dt

  )
  insert into public.erp_mkt_channel_revenue_daily(
    company_id,
    rev_date,
    channel,
    orders_count,
    units_count,
    net_revenue,
    updated_at
  )
  select
    company_id,
    dt,
    channel,
    orders_count,
    units_count,
    net_revenue,
    now()
  from source_query
  on conflict (company_id, rev_date, channel)
  do update set
    orders_count = excluded.orders_count,
    units_count  = excluded.units_count,
    net_revenue  = excluded.net_revenue,
    updated_at   = now();

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'status','ok',
    'rows_upserted', v_rows
  );
end;
$$;
