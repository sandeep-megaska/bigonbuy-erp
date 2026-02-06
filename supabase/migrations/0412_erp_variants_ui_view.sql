create or replace view public.erp_variants_ui as
select
  v.id,
  v.company_id,
  v.product_id,
  v.sku,
  nullif(trim(concat_ws(' - ', nullif(v.style_code, ''), nullif(v.color, ''), nullif(v.size, ''))), '') as title,
  v.color,
  v.size,
  v.style_code,
  v.hsn,
  v.gst_rate,
  v.image_url,
  v.cost_price,
  v.selling_price,
  v.created_at
from public.erp_variants v;

grant select on public.erp_variants_ui to authenticated;
grant select on public.erp_variants_ui to service_role;
