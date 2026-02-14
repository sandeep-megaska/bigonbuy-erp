begin;

-- --------------------------------------------------
-- Rolling 7-day KPI
-- --------------------------------------------------
drop view if exists public.erp_mkt_amazon_kpi_rolling_7d_v1 cascade;

create view public.erp_mkt_amazon_kpi_rolling_7d_v1 as
select
    company_id,
    max(dt) as window_end,
    sum(orders_count)::int as last7_orders,
    sum(units_count)::int as last7_units,
    sum(revenue)::numeric as last7_revenue
from (
    select *
    from public.erp_mkt_amazon_kpi_daily_v1
    where dt >= (current_date - interval '7 day')
) s
group by company_id;


-- --------------------------------------------------
-- Previous 7-day KPI
-- --------------------------------------------------
drop view if exists public.erp_mkt_amazon_kpi_prev7d_v1 cascade;

create view public.erp_mkt_amazon_kpi_prev7d_v1 as
select
    company_id,
    max(dt) as window_end,
    sum(orders_count)::int as prev7_orders,
    sum(units_count)::int as prev7_units,
    sum(revenue)::numeric as prev7_revenue
from (
    select *
    from public.erp_mkt_amazon_kpi_daily_v1
    where dt between (current_date - interval '14 day')
                   and (current_date - interval '7 day')
) s
group by company_id;


-- --------------------------------------------------
-- Alert comparison view
-- --------------------------------------------------
drop view if exists public.erp_mkt_amazon_alert_summary_v1 cascade;

create view public.erp_mkt_amazon_alert_summary_v1 as
select
    r.company_id,
    r.last7_orders,
    p.prev7_orders,
    r.last7_revenue,
    p.prev7_revenue,
    case
        when p.prev7_orders = 0 then null
        else (r.last7_orders - p.prev7_orders)::numeric / p.prev7_orders
    end as orders_change_pct,
    case
        when p.prev7_revenue = 0 then null
        else (r.last7_revenue - p.prev7_revenue)::numeric / p.prev7_revenue
    end as revenue_change_pct
from public.erp_mkt_amazon_kpi_rolling_7d_v1 r
left join public.erp_mkt_amazon_kpi_prev7d_v1 p
  on p.company_id = r.company_id;

commit;
