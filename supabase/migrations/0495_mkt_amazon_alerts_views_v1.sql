begin;

create or replace view public.erp_mkt_amazon_kpi_daily_v1 as
with current_company as (
  select public.erp_current_company_id() as company_id
)
select
  c.company_id,
  f.purchase_date::date as dt,
  count(distinct f.amazon_order_id)::int as orders_count,
  coalesce(
    sum(
      greatest(
        coalesce(f.item_amount, 0)
        + coalesce(f.shipping_amount, 0)
        + coalesce(f.item_tax, 0)
        - coalesce(f.promo_discount, 0),
        0
      )
    ),
    0
  )::numeric as revenue
from current_company c
join public.erp_amazon_order_facts f
  on f.company_id = c.company_id
group by c.company_id, f.purchase_date::date;

create or replace view public.erp_mkt_amazon_kpi_rolling_7d_v1 as
with current_company as (
  select public.erp_current_company_id() as company_id
),
anchor as (
  select
    c.company_id,
    coalesce(max(d.dt), current_date)::date as last7_to
  from current_company c
  left join public.erp_mkt_amazon_kpi_daily_v1 d
    on d.company_id = c.company_id
  group by c.company_id
),
window_bounds as (
  select
    a.company_id,
    (a.last7_to - 6)::date as last7_from,
    a.last7_to,
    (a.last7_to - 13)::date as prev7_from,
    (a.last7_to - 7)::date as prev7_to
  from anchor a
),
agg as (
  select
    w.company_id,
    w.last7_from,
    w.last7_to,
    w.prev7_from,
    w.prev7_to,
    coalesce(sum(d.orders_count) filter (where d.dt between w.last7_from and w.last7_to), 0)::int as last7_orders,
    coalesce(sum(d.orders_count) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::int as prev7_orders,
    coalesce(sum(d.revenue) filter (where d.dt between w.last7_from and w.last7_to), 0)::numeric as last7_revenue,
    coalesce(sum(d.revenue) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::numeric as prev7_revenue
  from window_bounds w
  left join public.erp_mkt_amazon_kpi_daily_v1 d
    on d.company_id = w.company_id
   and d.dt between w.prev7_from and w.last7_to
  group by w.company_id, w.last7_from, w.last7_to, w.prev7_from, w.prev7_to
)
select
  a.company_id,
  a.last7_from,
  a.last7_to,
  a.prev7_from,
  a.prev7_to,
  a.last7_orders,
  a.prev7_orders,
  (a.last7_orders - a.prev7_orders)::int as orders_delta,
  coalesce((a.last7_orders - a.prev7_orders)::numeric / nullif(a.prev7_orders::numeric, 0), 0)::numeric as orders_delta_pct,
  a.last7_revenue,
  a.prev7_revenue,
  (a.last7_revenue - a.prev7_revenue)::numeric as revenue_delta,
  coalesce((a.last7_revenue - a.prev7_revenue) / nullif(a.prev7_revenue, 0), 0)::numeric as revenue_delta_pct
from agg a;

create or replace view public.erp_mkt_amazon_asin_dips_7d_v1 as
with current_company as (
  select public.erp_current_company_id() as company_id
),
window_bounds as (
  select
    r.company_id,
    r.last7_from,
    r.last7_to,
    r.prev7_from,
    r.prev7_to
  from public.erp_mkt_amazon_kpi_rolling_7d_v1 r
  join current_company c
    on c.company_id = r.company_id
),
periodized as (
  select
    w.company_id,
    coalesce(nullif(trim(f.asin), ''), 'unknown') as asin,
    coalesce(nullif(trim(f.erp_sku), ''), nullif(trim(f.external_sku), ''), nullif(trim(f.asin), ''), 'unknown') as sku,
    case
      when f.purchase_date::date between w.last7_from and w.last7_to then 'last7'
      when f.purchase_date::date between w.prev7_from and w.prev7_to then 'prev7'
      else null
    end as bucket,
    f.amazon_order_id,
    greatest(
      coalesce(f.item_amount, 0)
      + coalesce(f.shipping_amount, 0)
      + coalesce(f.item_tax, 0)
      - coalesce(f.promo_discount, 0),
      0
    )::numeric as revenue
  from window_bounds w
  join public.erp_amazon_order_facts f
    on f.company_id = w.company_id
   and f.purchase_date::date between w.prev7_from and w.last7_to
),
agg as (
  select
    p.company_id,
    p.asin,
    p.sku,
    count(distinct p.amazon_order_id) filter (where p.bucket = 'last7')::int as last7_orders,
    count(distinct p.amazon_order_id) filter (where p.bucket = 'prev7')::int as prev7_orders,
    coalesce(sum(p.revenue) filter (where p.bucket = 'last7'), 0)::numeric as last7_revenue,
    coalesce(sum(p.revenue) filter (where p.bucket = 'prev7'), 0)::numeric as prev7_revenue
  from periodized p
  where p.bucket is not null
  group by p.company_id, p.asin, p.sku
)
select
  a.company_id,
  a.asin,
  a.sku,
  a.last7_orders,
  a.prev7_orders,
  (a.last7_orders - a.prev7_orders)::int as orders_delta,
  coalesce((a.last7_orders - a.prev7_orders)::numeric / nullif(a.prev7_orders::numeric, 0), 0)::numeric as orders_delta_pct,
  a.last7_revenue,
  a.prev7_revenue,
  (a.last7_revenue - a.prev7_revenue)::numeric as revenue_delta,
  coalesce((a.last7_revenue - a.prev7_revenue) / nullif(a.prev7_revenue, 0), 0)::numeric as revenue_delta_pct
from agg a
where (a.last7_orders - a.prev7_orders) < 0
   or (a.last7_revenue - a.prev7_revenue) < 0
order by revenue_delta asc, orders_delta asc;

grant select on public.erp_mkt_amazon_kpi_daily_v1 to authenticated, service_role;
grant select on public.erp_mkt_amazon_kpi_rolling_7d_v1 to authenticated, service_role;
grant select on public.erp_mkt_amazon_asin_dips_7d_v1 to authenticated, service_role;

-- acceptance checks:
-- select * from public.erp_mkt_amazon_kpi_rolling_7d_v1;
-- select * from public.erp_mkt_amazon_asin_dips_7d_v1 limit 20;

commit;
