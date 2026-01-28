-- 0292_hotfix_drop_shopify_geo_overloads.sql
-- Keep only: erp_shopify_analytics_sales_by_geo_v1(uuid,date,date,text,integer,integer,text)

drop function if exists public.erp_shopify_analytics_sales_by_geo_v1(uuid, date, date, text, integer, integer);
drop function if exists public.erp_shopify_analytics_sales_by_geo_v1(date, date, uuid, text, text, integer, integer);

grant execute on function public.erp_shopify_analytics_sales_by_geo_v1(uuid, date, date, text, integer, integer, text) to authenticated;
