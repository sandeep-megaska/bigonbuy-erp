create or replace view public.erp_inventory_variant_search_v
with (security_invoker = true) as
select
  p.company_id,
  v.id as variant_id,
  v.sku,
  p.style_code,
  p.title,
  v.color,
  v.size
from public.erp_variants v
join public.erp_products p on p.id = v.product_id;

grant select on public.erp_inventory_variant_search_v to authenticated;
