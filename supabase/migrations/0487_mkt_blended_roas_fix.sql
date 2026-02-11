-- 0487_mkt_blended_roas_fix.sql
-- DROP + RECREATE derived views to fix date join and ensure rows exist without spend.

begin;

-- Drop dependent view first
drop view if exists public.erp_mkt_blended_roas_daily_v1;

-- Drop spend view next
drop view if exists public.erp_mkt_meta_spend_daily_v1;

-- 1) Recreate Meta spend daily view (company_id, dt, meta_spend)
create view public.erp_mkt_meta_spend_daily_v1 as
select
  company_id,
  insight_date as dt,
  sum(coalesce(spend, 0))::numeric as meta_spend
from public.erp_mkt_meta_insights_daily
group by company_id, insight_date;

comment on view public.erp_mkt_meta_spend_daily_v1 is
'Meta spend aggregated daily by company. dt = erp_mkt_meta_insights_daily.insight_date.';

-- 2) Recreate blended ROAS view driven from revenue dates (LEFT JOIN spend)
create view public.erp_mkt_blended_roas_daily_v1 as
with revenue_by_day as (
  select
    company_id,
    rev_date as dt,
    sum(case when channel = 'shopify' then coalesce(net_revenue, 0) else 0 end)::numeric as shopify_revenue,
    sum(case when channel = 'amazon'  then coalesce(net_revenue, 0) else 0 end)::numeric as amazon_revenue
  from public.erp_mkt_channel_revenue_daily
  group by company_id, rev_date
)
select
  r.company_id,
  r.dt,
  s.meta_spend,
  r.shopify_revenue,
  r.amazon_revenue,
  (r.shopify_revenue + r.amazon_revenue)::numeric as total_revenue,
  ((r.shopify_revenue + r.amazon_revenue) / nullif(s.meta_spend, 0))::numeric as blended_roas,
  (r.shopify_revenue / nullif(s.meta_spend, 0))::numeric as d2c_roas,
  (r.shopify_revenue / nullif((r.shopify_revenue + r.amazon_revenue), 0))::numeric as d2c_share
from revenue_by_day r
left join public.erp_mkt_meta_spend_daily_v1 s
  on s.company_id = r.company_id
 and s.dt = r.dt;

comment on view public.erp_mkt_blended_roas_daily_v1 is
'Daily blended ROAS from channel revenue facts + Meta spend. Driven by revenue dates; spend LEFT JOINed.';

commit;

-- Acceptance checks (run manually)
-- select min(dt), max(dt), count(*) from public.erp_mkt_blended_roas_daily_v1 where company_id = erp_current_company_id();
-- select * from public.erp_mkt_blended_roas_daily_v1 where company_id = erp_current_company_id() order by dt desc limit 20;
