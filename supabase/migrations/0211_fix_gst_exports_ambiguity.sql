-- 0211_fix_gst_exports_ambiguity.sql
-- Fix GST export/mapping RPCs to avoid ambiguous column references.

create or replace function public.erp_gst_missing_skus_shopify()
returns table (sku text, sample_title text, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    l.sku as sku,
    max(l.title) as sample_title,
    max(o.order_created_at) as last_seen_at
  from public.erp_shopify_order_lines l
  join public.erp_shopify_orders o on o.id = l.order_id
  left join public.erp_gst_sku_master m_sku
    on m_sku.company_id = o.company_id
   and m_sku.sku = l.sku
   and m_sku.is_active = true
  left join public.erp_gst_sku_master m_style
    on m_style.company_id = o.company_id
   and m_style.style_code = case
      when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
      else l.sku
    end
   and m_style.is_active = true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and l.sku is not null
    and l.sku <> ''
    and m_sku.sku is null
    and m_style.style_code is null
  group by l.sku
  order by max(o.order_created_at) desc;
end;
$$;

create or replace function public.erp_gst_missing_mappings_shopify(
  p_from date,
  p_to date
) returns table (style_code text, example_sku text, last_seen date, title text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    case
      when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
      else l.sku
    end as style_code,
    max(l.sku) as example_sku,
    max(o.order_created_at::date) as last_seen,
    max(l.title) as title
  from public.erp_shopify_order_lines l
  join public.erp_shopify_orders o on o.id = l.order_id
  left join public.erp_gst_sku_master m_sku
    on m_sku.company_id = o.company_id
   and m_sku.sku = l.sku
   and m_sku.is_active = true
  left join public.erp_gst_sku_master m_style
    on m_style.company_id = o.company_id
   and m_style.style_code = case
      when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
      else l.sku
    end
   and m_style.is_active = true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and o.order_created_at::date between p_from and p_to
    and l.sku is not null
    and l.sku <> ''
    and m_sku.sku is null
    and m_style.style_code is null
  group by case
    when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
    else l.sku
  end
  order by max(o.order_created_at) desc;
end;
$$;

create or replace function public.erp_gst_export_b2c_shopify(
  p_from date,
  p_to date
) returns table (
  order_date date,
  invoice_no text,
  buyer_state_code text,
  sku text,
  hsn text,
  gst_rate numeric,
  quantity numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  shipping_taxable_value numeric,
  shipping_cgst numeric,
  shipping_sgst numeric,
  shipping_igst numeric,
  total_tax numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    r.order_date as order_date,
    r.invoice_no as invoice_no,
    r.buyer_state_code as buyer_state_code,
    r.sku as sku,
    r.hsn as hsn,
    r.gst_rate as gst_rate,
    r.quantity as quantity,
    r.taxable_value as taxable_value,
    r.cgst as cgst,
    r.sgst as sgst,
    r.igst as igst,
    r.shipping_taxable_value as shipping_taxable_value,
    r.shipping_cgst as shipping_cgst,
    r.shipping_sgst as shipping_sgst,
    r.shipping_igst as shipping_igst,
    r.total_tax as total_tax
  from public.erp_gst_sales_register r
  where r.company_id = public.erp_current_company_id()
    and r.source = 'shopify'
    and r.is_void = false
    and r.order_date between p_from and p_to
  order by r.order_date, r.invoice_no, r.sku;
end;
$$;

create or replace function public.erp_gst_export_hsn_shopify(
  p_from date,
  p_to date
) returns table (
  hsn text,
  gst_rate numeric,
  quantity numeric,
  taxable_value numeric,
  shipping_taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total_tax numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    r.hsn as hsn,
    r.gst_rate as gst_rate,
    sum(r.quantity) as quantity,
    sum(r.taxable_value) as taxable_value,
    sum(r.shipping_taxable_value) as shipping_taxable_value,
    sum(r.cgst + r.shipping_cgst) as cgst,
    sum(r.sgst + r.shipping_sgst) as sgst,
    sum(r.igst + r.shipping_igst) as igst,
    sum(r.total_tax) as total_tax
  from public.erp_gst_sales_register r
  where r.company_id = public.erp_current_company_id()
    and r.source = 'shopify'
    and r.is_void = false
    and r.order_date between p_from and p_to
  group by r.hsn, r.gst_rate
  order by r.hsn, r.gst_rate;
end;
$$;

create or replace function public.erp_gst_export_summary_shopify(
  p_from date,
  p_to date
) returns table (
  seller_state_code text,
  taxable_value numeric,
  shipping_taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total_tax numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    r.seller_state_code as seller_state_code,
    sum(r.taxable_value) as taxable_value,
    sum(r.shipping_taxable_value) as shipping_taxable_value,
    sum(r.cgst + r.shipping_cgst) as cgst,
    sum(r.sgst + r.shipping_sgst) as sgst,
    sum(r.igst + r.shipping_igst) as igst,
    sum(r.total_tax) as total_tax
  from public.erp_gst_sales_register r
  where r.company_id = public.erp_current_company_id()
    and r.source = 'shopify'
    and r.is_void = false
    and r.order_date between p_from and p_to
  group by r.seller_state_code
  order by r.seller_state_code;
end;
$$;
