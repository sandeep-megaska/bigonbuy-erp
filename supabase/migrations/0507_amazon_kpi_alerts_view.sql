begin;

create or replace view public.erp_mkt_amazon_kpi_alerts_v1 as
with base as (
  select
    d.company_id,
    d.dt,
    d.orders_count::numeric as orders,
    d.revenue,
    avg(d.orders_count::numeric) over (
      partition by d.company_id
      order by d.dt
      rows between 7 preceding and 1 preceding
    )::numeric as rolling_7d_avg_orders
  from public.erp_mkt_amazon_kpi_daily_v1 d
)
select
  b.company_id,
  b.dt,
  b.orders,
  b.revenue,
  round(b.rolling_7d_avg_orders, 2) as rolling_7d_avg_orders,
  round(((b.orders - b.rolling_7d_avg_orders) / nullif(b.rolling_7d_avg_orders, 0)) * 100, 2) as one_day_deviation_pct,
  round((abs(b.orders - b.rolling_7d_avg_orders) / nullif(b.rolling_7d_avg_orders, 0)) * 100, 2) as one_day_deviation_abs_pct,
  case
    when b.rolling_7d_avg_orders is null or b.rolling_7d_avg_orders = 0 then 'UNKNOWN'
    when (b.rolling_7d_avg_orders - b.orders) / nullif(b.rolling_7d_avg_orders, 0) >= 0.35 then 'RED'
    else 'GREEN'
  end::text as trend_status,
  case
    when b.rolling_7d_avg_orders is null or b.rolling_7d_avg_orders = 0 then 'UNKNOWN'
    when abs(b.orders - b.rolling_7d_avg_orders) / nullif(b.rolling_7d_avg_orders, 0) > 0.35 then 'RED'
    when abs(b.orders - b.rolling_7d_avg_orders) / nullif(b.rolling_7d_avg_orders, 0) >= 0.20 then 'AMBER'
    else 'GREY'
  end::text as volatility_status
from base b;

grant select on public.erp_mkt_amazon_kpi_alerts_v1 to authenticated, service_role;

-- acceptance checks:
-- select * from public.erp_mkt_amazon_kpi_alerts_v1
-- where company_id = public.erp_current_company_id()
-- order by dt desc limit 1;
--
-- select dt, orders, rolling_7d_avg_orders, one_day_deviation_abs_pct, trend_status, volatility_status
-- from public.erp_mkt_amazon_kpi_alerts_v1
-- where company_id = public.erp_current_company_id()
-- order by dt desc limit 14;

commit;
