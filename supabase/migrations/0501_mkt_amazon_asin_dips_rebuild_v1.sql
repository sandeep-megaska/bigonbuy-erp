begin;

drop view if exists public.erp_mkt_amazon_asin_dips_7d_v1;

create view public.erp_mkt_amazon_asin_dips_7d_v1 as
with r as (
  select *
  from public.erp_mkt_amazon_kpi_rolling_7d_v1
),
facts as (
  select
    f.company_id,
    f.purchase_date::date as dt,
    nullif(trim(f.asin), '') as asin,
    nullif(trim(coalesce(f.erp_sku, f.external_sku)), '') as sku,
    f.amazon_order_id,
    coalesce(f.quantity,0)::int as qty,
    coalesce(f.item_amount,0)::numeric as item_amount,
    coalesce(f.promo_discount,0)::numeric as promo_discount
  from public.erp_amazon_order_facts f
  where f.company_id = public.erp_current_company_id()
    and f.amazon_order_id is not null
    and f.purchase_date::date between (select prev7_from from r) and (select last7_to from r)
),
order_totals as (
  select
    company_id,
    dt,
    amazon_order_id,
    greatest(max(item_amount) - max(promo_discount), 0)::numeric as order_revenue,
    greatest(sum(qty), 0)::int as order_qty
  from facts
  group by company_id, dt, amazon_order_id
),
lines as (
  select
    f.company_id,
    f.dt,
    coalesce(f.asin, 'UNKNOWN') as asin,
    coalesce(f.sku,  'UNKNOWN') as sku,
    f.amazon_order_id,
    f.qty,
    ot.order_revenue,
    ot.order_qty,
    case
      when ot.order_qty <= 0 then 0::numeric
      else (ot.order_revenue * (f.qty::numeric / ot.order_qty::numeric))
    end as line_revenue
  from facts f
  join order_totals ot
    on ot.company_id = f.company_id
   and ot.dt = f.dt
   and ot.amazon_order_id = f.amazon_order_id
),
agg as (
  select
    l.asin,
    l.sku,

    count(distinct l.amazon_order_id) filter (where l.dt between (select last7_from from r) and (select last7_to from r))::int as last7_orders,
    count(distinct l.amazon_order_id) filter (where l.dt between (select prev7_from from r) and (select prev7_to from r))::int as prev7_orders,

    coalesce(sum(l.line_revenue) filter (where l.dt between (select last7_from from r) and (select last7_to from r)), 0)::numeric as last7_revenue,
    coalesce(sum(l.line_revenue) filter (where l.dt between (select prev7_from from r) and (select prev7_to from r)), 0)::numeric as prev7_revenue
  from lines l
  group by l.asin, l.sku
),
scored as (
  select
    public.erp_current_company_id() as company_id,
    (select last7_from from r) as last7_from,
    (select last7_to from r) as last7_to,
    (select prev7_from from r) as prev7_from,
    (select prev7_to from r) as prev7_to,

    asin,
    sku,

    last7_orders,
    prev7_orders,
    (last7_orders - prev7_orders) as orders_delta,
    case when prev7_orders = 0 then null
         else (last7_orders - prev7_orders)::numeric / nullif(prev7_orders,0)
    end as orders_delta_pct,

    last7_revenue,
    prev7_revenue,
    (last7_revenue - prev7_revenue) as revenue_delta,
    case when prev7_revenue = 0 then null
         else (last7_revenue - prev7_revenue) / nullif(prev7_revenue,0)
    end as revenue_delta_pct
  from agg
)
select *
from scored
where prev7_orders >= 5
  and (orders_delta < 0 or revenue_delta < 0)
order by revenue_delta asc nulls last, orders_delta asc nulls last
limit 50;

-- Acceptance:
-- select * from public.erp_mkt_amazon_asin_dips_7d_v1 limit 20;

commit;
