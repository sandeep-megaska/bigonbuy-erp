-- 0478_mkt_blended_roas_intelligence.sql
-- Purpose:
-- 1) Provide a canonical daily channel revenue fact table for marketing analytics
-- 2) Provide blended ROAS / channel mix views
--
-- Notes:
-- - Populate erp_mkt_channel_revenue_daily from existing ERP sales posting tables
--   via a simple nightly job/RPC (next step 0479), or by inserting from your current facts.

-------------------------------------------------------
-- 1) Canonical daily channel revenue fact
-------------------------------------------------------
create table if not exists public.erp_mkt_channel_revenue_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rev_date date not null,
  channel text not null, -- 'shopify' | 'amazon' | 'flipkart' etc.
  orders_count integer,
  units_count integer,
  gross_revenue numeric(14,2), -- before returns/refunds (your choice)
  net_revenue numeric(14,2),   -- after discounts (your choice)
  currency text default 'INR',
  source jsonb,                -- optional trace to upstream calc
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, rev_date, channel)
);

create index if not exists idx_mkt_channel_rev_date
on public.erp_mkt_channel_revenue_daily(company_id, rev_date);

-------------------------------------------------------
-- 2) Meta spend daily (from insights)
-------------------------------------------------------
create or replace view public.erp_mkt_meta_spend_daily_v1 as
select
  company_id,
  insight_date as dt,
  sum(coalesce(spend,0))::numeric(14,2) as meta_spend
from public.erp_mkt_meta_insights_daily
group by company_id, insight_date;

-------------------------------------------------------
-- 3) Channel revenue daily pivot
-------------------------------------------------------
create or replace view public.erp_mkt_channel_revenue_pivot_daily_v1 as
select
  company_id,
  rev_date as dt,
  sum(case when channel='shopify' then coalesce(net_revenue,0) else 0 end)::numeric(14,2) as shopify_revenue,
  sum(case when channel='amazon'  then coalesce(net_revenue,0) else 0 end)::numeric(14,2) as amazon_revenue,
  sum(coalesce(net_revenue,0))::numeric(14,2) as total_revenue
from public.erp_mkt_channel_revenue_daily
group by company_id, rev_date;

-------------------------------------------------------
-- 4) Blended ROAS daily
-------------------------------------------------------
create or replace view public.erp_mkt_blended_roas_daily_v1 as
select
  s.company_id,
  s.dt,
  s.meta_spend,
  coalesce(r.shopify_revenue,0) as shopify_revenue,
  coalesce(r.amazon_revenue,0)  as amazon_revenue,
  coalesce(r.total_revenue,0)   as total_revenue,
  (coalesce(r.total_revenue,0) / nullif(s.meta_spend,0))::numeric(14,4) as blended_roas,
  (coalesce(r.shopify_revenue,0) / nullif(s.meta_spend,0))::numeric(14,4) as d2c_roas,
  (coalesce(r.shopify_revenue,0) / nullif(coalesce(r.total_revenue,0),0))::numeric(14,4) as d2c_share
from public.erp_mkt_meta_spend_daily_v1 s
left join public.erp_mkt_channel_revenue_pivot_daily_v1 r
  on r.company_id = s.company_id
 and r.dt = s.dt;

-------------------------------------------------------
-- 5) Campaign ROAS (Meta-attributed only) - optional base view
-- This uses purchase_value captured by Meta (not blended yet).
-------------------------------------------------------
create or replace view public.erp_mkt_meta_campaign_roas_daily_v1 as
select
  company_id,
  insight_date as dt,
  meta_campaign_id,
  sum(coalesce(spend,0))::numeric(14,2) as spend,
  sum(coalesce(purchase_value,0))::numeric(14,2) as meta_purchase_value,
  (sum(coalesce(purchase_value,0))/nullif(sum(coalesce(spend,0)),0))::numeric(14,4) as meta_roas
from public.erp_mkt_meta_insights_daily
group by company_id, insight_date, meta_campaign_id;
