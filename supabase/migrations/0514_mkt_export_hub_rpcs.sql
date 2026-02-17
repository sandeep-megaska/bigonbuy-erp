begin;

-- Introspection notes used to avoid assumptions:
-- select n.nspname, c.relname, c.relkind
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname ilike '%expand%'
--   and c.relname ilike '%cities%'
-- order by c.relname;
--
-- Existing canonical demand source already used by summary/top-5 UI:
-- public.erp_mkt_city_demand_latest_v1
--
-- Missing relation that caused schema-cache UI error:
-- public.erp_mkt_demand_steering_expand_cities_v1

create or replace function public.erp_mkt_demand_steering_export_expand_cities_v1(
  p_company_id uuid,
  p_limit int default 50000
)
returns table (
  city text,
  week_start date,
  orders_30d int,
  revenue_30d numeric,
  growth_rate numeric,
  demand_score numeric,
  confidence_score numeric,
  recommended_pct_change int,
  guardrail_tags text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.city,
    c.week_start,
    c.orders_30d,
    c.revenue_30d,
    c.growth_rate,
    c.demand_score,
    c.confidence_score,
    c.recommended_pct_change,
    c.guardrail_tags
  from public.erp_mkt_city_demand_latest_v1 c
  where c.company_id = p_company_id
    and c.company_id = public.erp_current_company_id()
    and c.decision = 'EXPAND'
  order by c.demand_score desc
  limit greatest(1, least(coalesce(p_limit, 50000), 100000));
$$;

create or replace function public.erp_mkt_demand_steering_export_scale_skus_v1(
  p_company_id uuid,
  p_limit int default 50000
)
returns table (
  sku text,
  week_start date,
  orders_30d int,
  revenue_30d numeric,
  growth_rate numeric,
  demand_score numeric,
  confidence_score numeric,
  recommended_pct_change int,
  guardrail_tags text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.sku,
    s.week_start,
    s.orders_30d,
    s.revenue_30d,
    s.growth_rate,
    s.demand_score,
    s.confidence_score,
    s.recommended_pct_change,
    s.guardrail_tags
  from public.erp_mkt_sku_demand_latest_v1 s
  where s.company_id = p_company_id
    and s.company_id = public.erp_current_company_id()
    and s.decision = 'SCALE'
  order by s.demand_score desc
  limit greatest(1, least(coalesce(p_limit, 50000), 100000));
$$;

create or replace function public.erp_mkt_audience_export_atc_30d_v1(
  p_limit int default 50000
)
returns table (
  email text,
  phone text,
  city text,
  state text,
  zip text,
  country text,
  source text,
  last_event_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.email,
    a.phone,
    a.city,
    a.state,
    a.zip,
    a.country,
    a.source,
    a.last_event_at
  from public.erp_mkt_audience_atc_30d_no_purchase_v1 a
  order by a.last_event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50000), 100000));
$$;

create or replace function public.erp_mkt_audience_export_purchasers_180d_v1(
  p_limit int default 50000
)
returns table (
  email text,
  phone text,
  city text,
  state text,
  zip text,
  country text,
  source text,
  last_event_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.email,
    a.phone,
    a.city,
    a.state,
    a.zip,
    a.country,
    a.source,
    a.last_event_at
  from public.erp_mkt_audience_purchasers_180d_v1 a
  order by a.last_event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50000), 100000));
$$;

create or replace function public.erp_mkt_audience_export_vip_buyers_180d_v1(
  p_limit int default 50000
)
returns table (
  email text,
  phone text,
  city text,
  state text,
  zip text,
  country text,
  source text,
  last_event_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.email,
    a.phone,
    a.city,
    a.state,
    a.zip,
    a.country,
    a.source,
    a.last_event_at
  from public.erp_mkt_audience_vip_buyers_180d_v1 a
  order by a.last_event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50000), 100000));
$$;

revoke all on function public.erp_mkt_demand_steering_export_expand_cities_v1(uuid, int) from public;
revoke all on function public.erp_mkt_demand_steering_export_scale_skus_v1(uuid, int) from public;
revoke all on function public.erp_mkt_audience_export_atc_30d_v1(int) from public;
revoke all on function public.erp_mkt_audience_export_purchasers_180d_v1(int) from public;
revoke all on function public.erp_mkt_audience_export_vip_buyers_180d_v1(int) from public;

grant execute on function public.erp_mkt_demand_steering_export_expand_cities_v1(uuid, int) to authenticated, service_role;
grant execute on function public.erp_mkt_demand_steering_export_scale_skus_v1(uuid, int) to authenticated, service_role;
grant execute on function public.erp_mkt_audience_export_atc_30d_v1(int) to authenticated, service_role;
grant execute on function public.erp_mkt_audience_export_purchasers_180d_v1(int) to authenticated, service_role;
grant execute on function public.erp_mkt_audience_export_vip_buyers_180d_v1(int) to authenticated, service_role;

commit;
