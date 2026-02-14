begin;

create or replace view public.erp_mkt_activation_scale_skus_v1 as
select
  s.company_id,
  s.week_start,
  s.sku,
  s.demand_score,
  s.confidence_score,
  s.recommended_pct_change,
  s.guardrail_tags
from public.erp_mkt_sku_demand_latest_v1 s
where s.decision = 'SCALE'
  and s.confidence_score >= 0.5
  and not ('LOW_INVENTORY' = any(coalesce(s.guardrail_tags, '{}'::text[])));

create or replace view public.erp_mkt_activation_expand_cities_v1 as
select
  c.company_id,
  c.week_start,
  c.city,
  c.demand_score,
  c.confidence_score,
  c.recommended_pct_change
from public.erp_mkt_city_demand_latest_v1 c
where c.decision = 'EXPAND'
  and c.confidence_score >= 0.5;

create or replace view public.erp_mkt_activation_reduce_skus_v1 as
select
  s.company_id,
  s.week_start,
  s.sku,
  s.demand_score,
  s.confidence_score,
  s.recommended_pct_change,
  s.guardrail_tags
from public.erp_mkt_sku_demand_latest_v1 s
where s.decision = 'REDUCE'
  and s.confidence_score >= 0.5;

grant select on public.erp_mkt_activation_scale_skus_v1 to authenticated, service_role;
grant select on public.erp_mkt_activation_expand_cities_v1 to authenticated, service_role;
grant select on public.erp_mkt_activation_reduce_skus_v1 to authenticated, service_role;

commit;
