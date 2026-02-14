begin;

-- =========================================================
-- 0497: Amazon order-level revenue fix
-- item_amount is repeated per order_item row; summing inflates revenue.
-- Fix by computing order_revenue = max(item_amount) - max(promo_discount) per order.
-- =========================================================

-- 1) Order-level daily base
drop view if exists public.erp_mkt_amazon_orders_daily_v1;

create view public.erp_mkt_amazon_orders_daily_v1 as
with base as (
  select
    f.company_id,
    f.purchase_date::date as dt,
    f.marketplace_id,
    f.amazon_order_id,
    coalesce(f.quantity,0)::int as quantity,
    coalesce(f.item_amount,0)::numeric as item_amount,
    coalesce(f.promo_discount,0)::numeric as promo_discount
  from public.erp_amazon_order_facts f
  where f.company_id = public.erp_current_company_id()
    and f.amazon_order_id is not null
),
order_rollup as (
  select
    company_id,
    dt,
    marketplace_id,
    amazon_order_id,
    sum(quantity)::int as order_units,
    greatest(max(item_amount) - max(promo_discount), 0)::numeric as order_revenue
  from base
  group by company_id, dt, marketplace_id, amazon_order_id
)
select
  company_id,
  dt,
  amazon_order_id,
  order_units,
  order_revenue
from order_rollup;

-- 2) Daily KPI (canonical)
-- Drop dependents first (they depend on kpi_daily)
drop view if exists public.erp_mkt_amazon_asin_dips_7d_v1;
drop view if exists public.erp_mkt_amazon_kpi_rolling_7d_v1;

-- Now drop and recreate KPI daily (avoid 42P16 column rename/type issues)
drop view if exists public.erp_mkt_amazon_kpi_daily_v1;

create view public.erp_mkt_amazon_kpi_daily_v1 as
select
  public.erp_current_company_id() as company_id,
  dt,
  count(*)::int as orders_count,                 -- one row per order in orders_daily
  coalesce(sum(order_units),0)::int as units_count,
  coalesce(sum(order_revenue),0)::numeric as revenue
from public.erp_mkt_amazon_orders_daily_v1
group by dt;


-- NOTE: rolling + dips views are updated in app repo by Codex per prompt
-- because type/order dependencies exist in your current schema.
-- This migration intentionally focuses on canonical bases; Codex will patch dependent
-- views/functions in same migration file in correct drop/create order.

-- =========================================================
-- Acceptance checks (manual)
-- =========================================================
-- 1) Daily KPI sanity:
--    select dt, orders_count, units_count, revenue
--    from public.erp_mkt_amazon_kpi_daily_v1
--    where dt between '2026-01-25' and '2026-01-31'
--    order by dt;
--
-- 2) Inflation removed sample day:
--    select
--      f.purchase_date::date dt,
--      sum(f.item_amount) as old_sum_rows,
--      k.revenue as new_order_level_revenue
--    from public.erp_amazon_order_facts f
--    join public.erp_mkt_amazon_kpi_daily_v1 k
--      on k.company_id = f.company_id and k.dt = f.purchase_date::date
--    where f.company_id = public.erp_current_company_id()
--      and f.purchase_date::date = '2026-01-27'
--    group by 1, k.revenue;

commit;
