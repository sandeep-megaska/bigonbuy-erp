-- 0476_mkt_meta_ads_attribution_schema.sql
-- Meta Ads attribution ingestion canonical tables

-------------------------------------------------------
-- Campaigns
-------------------------------------------------------
create table if not exists public.erp_mkt_meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  meta_campaign_id text not null,
  campaign_name text,
  objective text,
  status text,
  created_time timestamptz,
  updated_time timestamptz,
  raw_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, meta_campaign_id)
);

-------------------------------------------------------
-- Adsets
-------------------------------------------------------
create table if not exists public.erp_mkt_meta_adsets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  meta_adset_id text not null,
  meta_campaign_id text not null,
  adset_name text,
  optimization_goal text,
  billing_event text,
  status text,
  raw_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, meta_adset_id)
);

-------------------------------------------------------
-- Ads
-------------------------------------------------------
create table if not exists public.erp_mkt_meta_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  meta_ad_id text not null,
  meta_adset_id text not null,
  ad_name text,
  status text,
  creative_id text,
  raw_json jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, meta_ad_id)
);

-------------------------------------------------------
-- Daily Insights (fact table)
-------------------------------------------------------
create table if not exists public.erp_mkt_meta_insights_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  insight_date date not null,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,

  impressions bigint,
  clicks bigint,
  spend numeric(14,4),
  reach bigint,
  frequency numeric(10,4),

  purchases bigint,
  purchase_value numeric(14,4),

  raw_json jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(company_id, insight_date, meta_ad_id)
);

create index if not exists idx_meta_insights_date
on public.erp_mkt_meta_insights_daily(company_id, insight_date);

create index if not exists idx_meta_insights_campaign
on public.erp_mkt_meta_insights_daily(company_id, meta_campaign_id);
