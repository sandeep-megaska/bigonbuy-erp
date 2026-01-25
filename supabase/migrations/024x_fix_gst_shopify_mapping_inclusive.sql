-- 024x_fix_gst_shopify_mapping_inclusive.sql

 drop function if exists public.erp_gst_generate_shopify(date, date);

create function public.erp_gst_generate_shopify(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_voided_count int := 0;
  v_inserted_count int := 0;
  v_missing_skus text[] := '{}'::text[];
  v_missing_sku_count int := 0;
  v_missing_empty_sku_count int := 0;
  v_missing_state_count int := 0;
  v_error_count int := 0;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'date range is required';
  end if;

  update public.erp_gst_sales_register
     set is_void = true,
         void_reason = 'regenerated',
         updated_at = now(),
         updated_by = v_actor
   where company_id = v_company_id
     and source = 'shopify'
     and is_void = false
     and order_date between p_from and p_to;

  get diagnostics v_voided_count = row_count;

  select array_agg(distinct missing_styles.style_code)
    into v_missing_skus
    from (
      select
        upper(split_part(l.sku, '-', 1)) as style_code
      from public.erp_shopify_orders o
      join public.erp_shopify_order_lines l on l.order_id = o.id
      left join public.erp_style_tax_profiles st
        on st.company_id = v_company_id
       and st.style_code = upper(split_part(l.sku, '-', 1))
       and st.is_active = true
     where o.company_id = v_company_id
       and o.is_cancelled = false
       and o.order_created_at::date between p_from and p_to
       and l.sku is not null
       and l.sku <> ''
       and st.style_code is null
    ) missing_styles;

  select count(*)
    into v_missing_empty_sku_count
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
   where o.company_id = v_company_id
     and o.is_cancelled = false
     and o.order_created_at::date between p_from and p_to
     and (l.sku is null or l.sku = '');

  v_missing_sku_count := coalesce(array_length(v_missing_skus, 1), 0) + v_missing_empty_sku_count;

  select count(*)
    into v_missing_state_count
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_style_tax_profiles st
      on st.company_id = v_company_id
     and st.style_code = upper(split_part(l.sku, '-', 1))
     and st.is_active = true
   where o.company_id = v_company_id
     and o.is_cancelled = false
     and o.order_created_at::date between p_from and p_to
     and o.shipping_state_code is null
     and l.sku is not null
     and l.sku <> ''
     and st.style_code is not null;

  with base as (
    select
      o.id as order_id,
      o.order_created_at::date as order_date,
      o.shopify_order_number as invoice_no,
      o.shipping_state_code as buyer_state_code,
      coalesce(o.total_shipping, 0) as order_shipping,
      l.id as line_id,
      l.sku as sku,
      upper(split_part(l.sku, '-', 1)) as style_code,
      l.quantity as quantity,
      l.price as price,
      l.line_discount as line_discount,
      st.hsn as hsn,
      coalesce(st.gst_rate, 5) as gst_rate
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_style_tax_profiles st
      on st.company_id = v_company_id
     and st.style_code = upper(split_part(l.sku, '-', 1))
     and st.is_active = true
    where o.company_id = v_company_id
      and o.is_cancelled = false
      and o.order_created_at::date between p_from and p_to
      and (o.financial_status is null or o.financial_status in ('paid', 'partially_paid'))
      and l.sku is not null
      and l.sku <> ''
      and st.style_code is not null
  ),
  calc as (
    select
      base.*,
      greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0) - coalesce(base.line_discount, 0)) as line_total_inclusive,
      sum(greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0) - coalesce(base.line_discount, 0))) over (partition by base.order_id) as order_line_total
    from base
  ),
  alloc as (
    select
      calc.*,
      case
        when calc.order_line_total > 0 then (calc.order_shipping * calc.line_total_inclusive / calc.order_line_total)
        else 0
      end as shipping_share
    from calc
  ),
  taxcalc as (
    select
      alloc.*,
      round(alloc.line_total_inclusive * 100 / (100 + alloc.gst_rate), 2) as line_taxable,
      round(alloc.line_total_inclusive - round(alloc.line_total_inclusive * 100 / (100 + alloc.gst_rate), 2), 2) as line_tax,
      round(alloc.shipping_share * 100 / (100 + alloc.gst_rate), 2) as shipping_taxable,
      round(alloc.shipping_share - round(alloc.shipping_share * 100 / (100 + alloc.gst_rate), 2), 2) as shipping_tax,
      case when alloc.buyer_state_code = 'RJ' then true else false end as is_intra
    from alloc
  )
  insert into public.erp_gst_sales_register (
    company_id,
    source,
    source_order_id,
    source_line_id,
    order_date,
    invoice_no,
    seller_state_code,
    buyer_state_code,
    sku,
    style_code,
    hsn,
    gst_rate,
    quantity,
    taxable_value,
    cgst,
    sgst,
    igst,
    shipping_taxable_value,
    shipping_cgst,
    shipping_sgst,
    shipping_igst,
    total_tax,
    raw_calc,
    is_void,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  select
    v_company_id,
    'shopify',
    taxcalc.order_id,
    taxcalc.line_id,
    taxcalc.order_date,
    taxcalc.invoice_no,
    'RJ',
    taxcalc.buyer_state_code,
    taxcalc.sku,
    taxcalc.style_code,
    taxcalc.hsn,
    taxcalc.gst_rate,
    coalesce(taxcalc.quantity, 0),
    taxcalc.line_taxable,
    case when taxcalc.is_intra then round(taxcalc.line_tax / 2, 2) else 0 end,
    case when taxcalc.is_intra then round(taxcalc.line_tax - round(taxcalc.line_tax / 2, 2), 2) else 0 end,
    case when taxcalc.is_intra then 0 else taxcalc.line_tax end,
    taxcalc.shipping_taxable,
    case when taxcalc.is_intra then round(taxcalc.shipping_tax / 2, 2) else 0 end,
    case when taxcalc.is_intra then round(taxcalc.shipping_tax - round(taxcalc.shipping_tax / 2, 2), 2) else 0 end,
    case when taxcalc.is_intra then 0 else taxcalc.shipping_tax end,
    round(taxcalc.line_tax + taxcalc.shipping_tax, 2),
    jsonb_build_object(
      'line_total_inclusive', taxcalc.line_total_inclusive,
      'order_line_total', taxcalc.order_line_total,
      'shipping_share', taxcalc.shipping_share,
      'buyer_state_code', taxcalc.buyer_state_code,
      'missing_state_code', taxcalc.buyer_state_code is null,
      'style_code', taxcalc.style_code
    ),
    false,
    now(),
    v_actor,
    now(),
    v_actor
  from taxcalc;

  get diagnostics v_inserted_count = row_count;

  v_error_count := v_missing_sku_count + coalesce(v_missing_state_count, 0);

  return jsonb_build_object(
    'inserted_count', v_inserted_count,
    'voided_count', v_voided_count,
    'missing_sku_count', v_missing_sku_count,
    'missing_skus', coalesce(v_missing_skus, '{}'::text[]),
    'error_count', v_error_count
  );
end;
$$;

revoke all on function public.erp_gst_generate_shopify(date, date) from public;
revoke all on function public.erp_gst_generate_shopify(date, date) from authenticated;
grant execute on function public.erp_gst_generate_shopify(date, date) to authenticated;

-- Validation queries:
-- select count(*) from public.erp_gst_sales_register
--  where source = 'shopify'
--    and order_date between '2024-01-01' and '2024-01-31'
--    and is_void = false;
--
-- select * from public.erp_gst_missing_mappings_shopify('2024-01-01', '2024-01-31');
