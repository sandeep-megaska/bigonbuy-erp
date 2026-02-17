begin;

create or replace view public.erp_mkt_activation_scale_skus_v1 as
select
  company_id,
  week_start,
  sku,
  demand_score,
  confidence_score,
  recommended_pct_change,
  guardrail_tags
from public.erp_mkt_sku_demand_latest_v1
where decision = 'SCALE'
  and confidence_score >= 0.5
  and not ('LOW_INVENTORY' = any(guardrail_tags));

create or replace view public.erp_mkt_activation_expand_cities_v1 as
select
  company_id,
  week_start,
  city,
  demand_score,
  confidence_score,
  recommended_pct_change
from public.erp_mkt_city_demand_latest_v1
where decision = 'EXPAND'
  and confidence_score >= 0.5;

create or replace view public.erp_mkt_activation_reduce_skus_v1 as
select
  company_id,
  week_start,
  sku,
  demand_score,
  confidence_score,
  recommended_pct_change,
  guardrail_tags
from public.erp_mkt_sku_demand_latest_v1
where decision = 'REDUCE'
  and confidence_score >= 0.5;

grant select on public.erp_mkt_activation_scale_skus_v1 to authenticated, service_role;
grant select on public.erp_mkt_activation_expand_cities_v1 to authenticated, service_role;
grant select on public.erp_mkt_activation_reduce_skus_v1 to authenticated, service_role;

-- Acceptance checks:
-- select count(*) from public.erp_mkt_activation_scale_skus_v1;
-- select count(*) from public.erp_mkt_activation_expand_cities_v1;

commit;
