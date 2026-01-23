-- 0214_gst_inventory_hsn_fixed_rate.sql
-- Use inventory SKU master (erp_variants) for GST HSN mapping with fixed 5% rate.
-- Qualify columns in GST export/list RPCs to avoid ambiguity.

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
  left join public.erp_variants v_sku
    on v_sku.company_id = o.company_id
   and v_sku.sku = l.sku
   and v_sku.hsn is not null
  left join lateral (
    select v.hsn
      from public.erp_variants v
     where v.company_id = o.company_id
       and v.style_code = case
         when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
         else l.sku
       end
       and v.hsn is not null
     limit 1
  ) v_style on true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and l.sku is not null
    and l.sku <> ''
    and v_sku.sku is null
    and v_style.hsn is null
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
  left join public.erp_variants v_sku
    on v_sku.company_id = o.company_id
   and v_sku.sku = l.sku
   and v_sku.hsn is not null
  left join lateral (
    select v.hsn
      from public.erp_variants v
     where v.company_id = o.company_id
       and v.style_code = case
         when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
         else l.sku
       end
       and v.hsn is not null
     limit 1
  ) v_style on true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and o.order_created_at::date between p_from and p_to
    and l.sku is not null
    and l.sku <> ''
    and v_sku.sku is null
    and v_style.hsn is null
  group by case
    when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
    else l.sku
  end
  order by max(o.order_created_at) desc;
end;
$$;

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
        case
          when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
          else l.sku
        end as style_code
      from public.erp_shopify_orders o
      join public.erp_shopify_order_lines l on l.order_id = o.id
      left join public.erp_variants v_sku
        on v_sku.company_id = v_company_id
       and v_sku.sku = l.sku
       and v_sku.hsn is not null
      left join lateral (
        select v.hsn
          from public.erp_variants v
         where v.company_id = v_company_id
           and v.style_code = case
             when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
             else l.sku
           end
           and v.hsn is not null
         limit 1
      ) v_style on true
     where o.company_id = v_company_id
       and o.is_cancelled = false
       and o.order_created_at::date between p_from and p_to
       and l.sku is not null
       and l.sku <> ''
       and v_sku.sku is null
       and v_style.hsn is null
    ) missing_styles;

  v_missing_sku_count := coalesce(array_length(v_missing_skus, 1), 0);

  select count(*)
    into v_missing_state_count
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_variants v_sku
      on v_sku.company_id = v_company_id
     and v_sku.sku = l.sku
     and v_sku.hsn is not null
    left join lateral (
      select v.hsn
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.style_code = case
           when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
           else l.sku
         end
         and v.hsn is not null
       limit 1
    ) v_style on true
   where o.company_id = v_company_id
     and o.is_cancelled = false
     and o.order_created_at::date between p_from and p_to
     and o.shipping_state_code is null
     and (v_sku.sku is not null or v_style.hsn is not null);

  with base as (
    select
      o.id as order_id,
      o.order_created_at::date as order_date,
      o.shopify_order_number as invoice_no,
      o.shipping_state_code as buyer_state_code,
      coalesce(o.total_shipping, 0) as order_shipping,
      l.id as line_id,
      l.sku as sku,
      case
        when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
        else l.sku
      end as style_code,
      l.quantity as quantity,
      l.price as price,
      l.line_discount as line_discount,
      coalesce(v_sku.hsn, v_style.hsn) as hsn,
      5::numeric as gst_rate
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_variants v_sku
      on v_sku.company_id = v_company_id
     and v_sku.sku = l.sku
     and v_sku.hsn is not null
    left join lateral (
      select v.hsn
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.style_code = case
           when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
           else l.sku
         end
         and v.hsn is not null
       limit 1
    ) v_style on true
    where o.company_id = v_company_id
      and o.is_cancelled = false
      and o.order_created_at::date between p_from and p_to
      and (o.financial_status is null or o.financial_status in ('paid', 'partially_paid'))
      and coalesce(v_sku.hsn, v_style.hsn) is not null
  ),
  calc as (
    select
      base.*,
      greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0) - coalesce(base.line_discount, 0)) as line_taxable,
      sum(greatest(0, coalesce(base.quantity, 0) * coalesce(base.price, 0) - coalesce(base.line_discount, 0))) over (partition by base.order_id) as order_line_total
    from base
  ),
  alloc as (
    select
      calc.*,
      case
        when calc.order_line_total > 0 then (calc.order_shipping * calc.line_taxable / calc.order_line_total)
        else 0
      end as shipping_share
    from calc
  ),
  taxcalc as (
    select
      alloc.*,
      (alloc.line_taxable * alloc.gst_rate / 100) as line_tax,
      (alloc.shipping_share * alloc.gst_rate / 100) as shipping_tax,
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
    case when taxcalc.is_intra then taxcalc.line_tax / 2 else 0 end,
    case when taxcalc.is_intra then taxcalc.line_tax / 2 else 0 end,
    case when taxcalc.is_intra then 0 else taxcalc.line_tax end,
    taxcalc.shipping_share,
    case when taxcalc.is_intra then taxcalc.shipping_tax / 2 else 0 end,
    case when taxcalc.is_intra then taxcalc.shipping_tax / 2 else 0 end,
    case when taxcalc.is_intra then 0 else taxcalc.shipping_tax end,
    taxcalc.line_tax + taxcalc.shipping_tax,
    jsonb_build_object(
      'line_taxable', taxcalc.line_taxable,
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
