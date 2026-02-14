begin;

-- Drop dependents first (safe even if missing)
drop view if exists public.erp_mkt_amazon_asin_dips_7d_v1;
drop view if exists public.erp_mkt_amazon_alert_summary_v1;
drop view if exists public.erp_mkt_amazon_kpi_rolling_7d_v1;

create view public.erp_mkt_amazon_kpi_rolling_7d_v1 as
with daily as (
  select *
  from public.erp_mkt_amazon_kpi_daily_v1
),
bounds as (
  select max(dt) as last_dt
  from daily
),
win as (
  select
    (b.last_dt - 6) as last7_from,
    b.last_dt as last7_to,
    (b.last_dt - 13) as prev7_from,
    (b.last_dt - 7) as prev7_to
  from bounds b
),
agg as (
  select
    w.last7_from, w.last7_to, w.prev7_from, w.prev7_to,

    coalesce(sum(d.orders_count) filter (where d.dt between w.last7_from and w.last7_to), 0)::int as last7_orders,
    coalesce(sum(d.orders_count) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::int as prev7_orders,

    coalesce(sum(d.revenue) filter (where d.dt between w.last7_from and w.last7_to), 0)::numeric as last7_revenue,
    coalesce(sum(d.revenue) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::numeric as prev7_revenue
  from win w
  left join daily d on true
  group by w.last7_from, w.last7_to, w.prev7_from, w.prev7_to
)
select
  public.erp_current_company_id() as company_id,
  a.last7_from,
  a.last7_to,
  a.prev7_from,
  a.prev7_to,

  a.last7_orders,
  a.prev7_orders,
  (a.last7_orders - a.prev7_orders) as orders_delta,
  case
    when a.prev7_orders = 0 then null
    else (a.last7_orders - a.prev7_orders)::numeric / nullif(a.prev7_orders,0)
  end as orders_delta_pct,

  a.last7_revenue,
  a.prev7_revenue,
  (a.last7_revenue - a.prev7_revenue) as revenue_delta,
  case
    when a.prev7_revenue = 0 then null
    else (a.last7_revenue - a.prev7_revenue) / nullif(a.prev7_revenue,0)
  end as revenue_delta_pct
from agg a;

-- Optional (keep summary view too; UI can use either)
create view public.erp_mkt_amazon_alert_summary_v1 as
select * from public.erp_mkt_amazon_kpi_rolling_7d_v1;

-- Acceptance checks:
-- select * from public.erp_mkt_amazon_kpi_rolling_7d_v1;
-- (must include orders_delta + revenue_delta columns)

commit;
