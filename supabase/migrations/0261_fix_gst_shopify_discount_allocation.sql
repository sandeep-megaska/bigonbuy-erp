-- 0261_fix_gst_shopify_discount_allocation.sql
-- Add discount-aware Shopify GST generation (allocate order discounts when needed)

alter table public.erp_gst_sales_register
  add column if not exists gross_before_discount numeric not null default 0,
  add column if not exists discount numeric not null default 0;

create or replace function public.erp_gst_generate_shopify(
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
      o.shopify_order_number as order_number,
      o.shipping_state_code as buyer_state_code,
      o.shipping_state_code as place_of_supply_code,
      o.financial_status as payment_status,
      o.fulfillment_status as fulfillment_status,
      (
        select string_agg(gateway, ', ')
        from jsonb_array_elements_text(coalesce(o.raw_order->'payment_gateway_names', '[]'::jsonb)) as gateway
      ) as payment_gateway,
      coalesce(
        nullif(trim(concat_ws(' ', nullif(o.raw_order#>>'{customer,first_name}', ''), nullif(o.raw_order#>>'{customer,last_name}', ''))), ''),
        nullif(o.raw_order#>>'{billing_address,name}', ''),
        nullif(o.raw_order#>>'{shipping_address,name}', ''),
        nullif(o.customer_email, '')
      ) as customer_name,
      (
        select nullif(trim(attr->>'value'), '')
        from jsonb_array_elements(coalesce(o.raw_order->'note_attributes', '[]'::jsonb)) as attr
        where lower(attr->>'name') in ('gstin', 'gstin number', 'gstin no', 'gst number', 'gst')
        limit 1
      ) as customer_gstin,
      coalesce(o.total_shipping, 0) as order_shipping,
      coalesce(o.total_discounts, 0) as order_total_discounts,
      l.id as line_id,
      l.sku as sku,
      upper(split_part(l.sku, '-', 1)) as style_code,
      l.title as product_title,
      case
        when nullif(l.raw_line->>'variant_title', '') is null then null
        when lower(l.raw_line->>'variant_title') = 'default title' then null
        else nullif(l.raw_line->>'variant_title', '')
      end as variant_title,
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
  existing_invoice as (
    select
      r.source_order_id,
      max(r.invoice_number) as invoice_number
    from public.erp_gst_sales_register r
    where r.company_id = v_company_id
      and r.source = 'shopify'
      and r.invoice_number is not null
    group by r.source_order_id
  ),
  order_info as (
    select distinct
      base.order_id,
      base.order_date,
      base.invoice_no,
      base.order_number,
      base.customer_name,
      base.customer_gstin,
      base.payment_status,
      base.payment_gateway,
      base.fulfillment_status,
      base.place_of_supply_code
    from base
  ),
  invoice_map as (
    select
      order_info.*,
      coalesce(existing_invoice.invoice_number, public.erp_gst_allocate_invoice_number(order_info.order_date)) as invoice_number
    from order_info
    left join existing_invoice on existing_invoice.source_order_id = order_info.order_id
  ),
  calc as (
    select
      base.*,
      greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0)) as line_gross_inclusive,
      sum(greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0))) over (partition by base.order_id) as order_line_gross_inclusive,
      sum(coalesce(base.line_discount, 0)) over (partition by base.order_id) as order_line_discount_total
    from base
  ),
  discount_alloc as (
    select
      calc.*,
      row_number() over (partition by calc.order_id order by calc.line_id) as line_index,
      count(*) over (partition by calc.order_id) as line_count,
      round(calc.order_total_discounts * calc.line_gross_inclusive / nullif(calc.order_line_gross_inclusive, 0), 2) as allocated_discount,
      sum(round(calc.order_total_discounts * calc.line_gross_inclusive / nullif(calc.order_line_gross_inclusive, 0), 2))
        over (partition by calc.order_id) as allocated_discount_sum
    from calc
  ),
  pricing as (
    select
      discount_alloc.*,
      least(
        discount_alloc.line_gross_inclusive,
        case
          when discount_alloc.order_line_discount_total > 0 then coalesce(discount_alloc.line_discount, 0)
          when discount_alloc.order_total_discounts > 0 and discount_alloc.order_line_gross_inclusive > 0 then
            case
              when discount_alloc.line_index = discount_alloc.line_count then
                greatest(
                  0,
                  discount_alloc.order_total_discounts
                    - (discount_alloc.allocated_discount_sum - discount_alloc.allocated_discount)
                )
              else discount_alloc.allocated_discount
            end
          else 0
        end
      ) as line_discount_inclusive
    from discount_alloc
  ),
  calc_total as (
    select
      pricing.*,
      greatest(0, pricing.line_gross_inclusive - pricing.line_discount_inclusive) as line_total_inclusive,
      sum(greatest(0, pricing.line_gross_inclusive - pricing.line_discount_inclusive))
        over (partition by pricing.order_id) as order_line_total
    from pricing
  ),
  alloc as (
    select
      calc_total.*,
      case
        when calc_total.order_line_total > 0 then (calc_total.order_shipping * calc_total.line_total_inclusive / calc_total.order_line_total)
        else 0
      end as shipping_share
    from calc_total
  ),
  taxcalc as (
    select
      alloc.*,
      round(alloc.line_gross_inclusive * 100 / (100 + alloc.gst_rate), 2) as line_gross_taxable,
      round(alloc.line_discount_inclusive * 100 / (100 + alloc.gst_rate), 2) as line_discount_taxable,
      greatest(
        0,
        round(alloc.line_gross_inclusive * 100 / (100 + alloc.gst_rate), 2)
        - round(alloc.line_discount_inclusive * 100 / (100 + alloc.gst_rate), 2)
      ) as line_taxable,
      round(
        greatest(
          0,
          round(alloc.line_gross_inclusive * 100 / (100 + alloc.gst_rate), 2)
          - round(alloc.line_discount_inclusive * 100 / (100 + alloc.gst_rate), 2)
        ) * alloc.gst_rate / 100,
        2
      ) as line_tax,
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
    invoice_number,
    order_number,
    customer_name,
    customer_gstin,
    payment_status,
    payment_gateway,
    fulfillment_status,
    place_of_supply_code,
    seller_state_code,
    buyer_state_code,
    sku,
    style_code,
    product_title,
    variant_title,
    hsn,
    gst_rate,
    quantity,
    gross_before_discount,
    discount,
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
    invoice_map.invoice_number,
    invoice_map.order_number,
    invoice_map.customer_name,
    invoice_map.customer_gstin,
    invoice_map.payment_status,
    invoice_map.payment_gateway,
    invoice_map.fulfillment_status,
    invoice_map.place_of_supply_code,
    'RJ',
    taxcalc.buyer_state_code,
    taxcalc.sku,
    taxcalc.style_code,
    taxcalc.product_title,
    taxcalc.variant_title,
    taxcalc.hsn,
    taxcalc.gst_rate,
    coalesce(taxcalc.quantity, 0),
    taxcalc.line_gross_taxable,
    taxcalc.line_discount_taxable,
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
      'line_gross_inclusive', taxcalc.line_gross_inclusive,
      'line_discount_inclusive', taxcalc.line_discount_inclusive,
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
  from taxcalc
  join invoice_map on invoice_map.order_id = taxcalc.order_id;

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
