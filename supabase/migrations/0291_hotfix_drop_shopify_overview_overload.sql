-- 0xxx_hotfix_drop_shopify_overview_overload.sql
-- Fix PostgREST ambiguity: keep only one canonical signature

drop function if exists public.erp_shopify_analytics_overview_v1(date, date, uuid);

-- (Optional but recommended) ensure execute grants exist on the remaining one
grant execute on function public.erp_shopify_analytics_overview_v1(uuid, date, date) to authenticated;
