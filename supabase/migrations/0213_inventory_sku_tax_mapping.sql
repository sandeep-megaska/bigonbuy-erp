-- 0213_inventory_sku_tax_mapping.sql
-- Unify GST/HSN mapping on inventory SKU master (erp_variants).

alter table public.erp_variants
  add column if not exists hsn text null,
  add column if not exists gst_rate numeric null default 5;

alter table public.erp_variants
  add column if not exists style_code text
  generated always as (nullif(split_part(sku, '-', 1), '')) stored;

create index if not exists erp_variants_company_sku_idx
  on public.erp_variants (company_id, sku);

create index if not exists erp_variants_company_style_code_idx
  on public.erp_variants (company_id, style_code);

create or replace function public.erp_inventory_sku_tax_upsert(
  p_sku text,
  p_style_code text,
  p_hsn text,
  p_gst_rate numeric default 5,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_style_code text := nullif(trim(coalesce(p_style_code, '')), '');
  v_hsn_raw text := coalesce(p_hsn, '');
  v_hsn text;
  v_gst_rate numeric := coalesce(p_gst_rate, 5);
  v_updated int := 0;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_sku is null and v_style_code is null then
    raise exception 'sku or style_code is required';
  end if;

  if v_style_code is null and v_sku is not null then
    v_style_code := nullif(split_part(v_sku, '-', 1), '');
  end if;

  v_hsn := regexp_replace(v_hsn_raw, '\\D', '', 'g');

  if v_hsn is null or v_hsn = '' then
    raise exception 'hsn is required';
  end if;

  if length(v_hsn) < 4 or length(v_hsn) > 10 then
    raise exception 'hsn must be 4-10 digits';
  end if;

  if v_gst_rate is null then
    raise exception 'gst_rate is required';
  end if;

  if v_sku is not null then
    update public.erp_variants
       set hsn = v_hsn,
           gst_rate = v_gst_rate
     where company_id = v_company_id
       and sku = v_sku;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'sku not found';
    end if;

    return jsonb_build_object('ok', true, 'sku', v_sku, 'updated', v_updated);
  end if;

  update public.erp_variants
     set hsn = v_hsn,
         gst_rate = v_gst_rate
   where company_id = v_company_id
     and style_code = v_style_code;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'style_code not found';
  end if;

  return jsonb_build_object('ok', true, 'style_code', v_style_code, 'updated', v_updated);
end;
$$;

revoke all on function public.erp_inventory_sku_tax_upsert(text, text, text, numeric, boolean) from public;
revoke all on function public.erp_inventory_sku_tax_upsert(text, text, text, numeric, boolean) from authenticated;
grant execute on function public.erp_inventory_sku_tax_upsert(text, text, text, numeric, boolean) to authenticated;

create or replace function public.erp_inventory_sku_tax_bulk_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_total int := 0;
  v_valid int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_errors int := 0;
  v_skipped int := 0;
  v_error_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_line int := 0;
  v_style_code text;
  v_sku text;
  v_hsn_raw text;
  v_hsn text;
  v_rate numeric;
  v_reason text;
  v_updated_count int := 0;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_line := v_line + 1;
    v_total := v_total + 1;

    if coalesce(trim(v_row->>'style_code'), '') = ''
      and coalesce(trim(v_row->>'sku'), '') = ''
      and coalesce(trim(v_row->>'hsn'), '') = ''
      and coalesce(trim(v_row->>'gst_rate'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_style_code := upper(trim(coalesce(v_row->>'style_code', '')));
    v_sku := nullif(trim(coalesce(v_row->>'sku', '')), '');
    if v_style_code = '' and v_sku is not null then
      v_style_code := upper(nullif(split_part(v_sku, '-', 1), ''));
    end if;

    v_hsn_raw := coalesce(v_row->>'hsn', '');
    v_hsn := regexp_replace(v_hsn_raw, '\\D', '', 'g');

    v_rate := null;
    v_reason := null;

    begin
      if v_row ? 'gst_rate' and coalesce(trim(v_row->>'gst_rate'), '') <> '' then
        v_rate := (v_row->>'gst_rate')::numeric;
      else
        v_rate := 5;
      end if;
    exception
      when others then
        v_reason := 'gst_rate must be numeric';
    end;

    if v_reason is null then
      if v_style_code = '' and v_sku is null then
        v_reason := 'style_code or sku is required';
      elsif v_hsn = '' then
        v_reason := 'hsn is required';
      elsif length(v_hsn) < 4 or length(v_hsn) > 10 then
        v_reason := 'hsn must be 4-10 digits';
      elsif v_rate is null then
        v_reason := 'gst_rate is required';
      elsif v_rate <> 5 then
        v_reason := 'gst_rate must be 5';
      end if;
    end if;

    if v_reason is not null then
      v_errors := v_errors + 1;
      if jsonb_array_length(v_error_rows) < 50 then
        v_error_rows := v_error_rows || jsonb_build_array(
          jsonb_build_object(
            'line', v_line,
            'style_code', nullif(v_style_code, ''),
            'sku', v_sku,
            'hsn', nullif(v_hsn_raw, ''),
            'gst_rate', nullif(v_row->>'gst_rate', ''),
            'reason', v_reason
          )
        );
      end if;
      continue;
    end if;

    v_valid := v_valid + 1;
    v_updated_count := 0;

    if v_sku is not null then
      update public.erp_variants
         set hsn = v_hsn,
             gst_rate = v_rate
       where company_id = v_company_id
         and sku = v_sku;
      get diagnostics v_updated_count = row_count;

      if v_updated_count = 0 then
        v_errors := v_errors + 1;
        if jsonb_array_length(v_error_rows) < 50 then
          v_error_rows := v_error_rows || jsonb_build_array(
            jsonb_build_object(
              'line', v_line,
              'style_code', nullif(v_style_code, ''),
              'sku', v_sku,
              'hsn', nullif(v_hsn_raw, ''),
              'gst_rate', nullif(v_row->>'gst_rate', ''),
              'reason', 'sku not found'
            )
          );
        end if;
        continue;
      end if;
    else
      update public.erp_variants
         set hsn = v_hsn,
             gst_rate = v_rate
       where company_id = v_company_id
         and style_code = v_style_code;
      get diagnostics v_updated_count = row_count;

      if v_updated_count = 0 then
        v_errors := v_errors + 1;
        if jsonb_array_length(v_error_rows) < 50 then
          v_error_rows := v_error_rows || jsonb_build_array(
            jsonb_build_object(
              'line', v_line,
              'style_code', nullif(v_style_code, ''),
              'sku', v_sku,
              'hsn', nullif(v_hsn_raw, ''),
              'gst_rate', nullif(v_row->>'gst_rate', ''),
              'reason', 'style_code not found'
            )
          );
        end if;
        continue;
      end if;
    end if;

    v_updated := v_updated + v_updated_count;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'total_lines', v_total,
    'valid', v_valid,
    'inserted', v_inserted,
    'updated', v_updated,
    'upserted', v_inserted + v_updated,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_rows', v_error_rows
  );
end;
$$;

revoke all on function public.erp_inventory_sku_tax_bulk_upsert(jsonb) from public;
revoke all on function public.erp_inventory_sku_tax_bulk_upsert(jsonb) from authenticated;
grant execute on function public.erp_inventory_sku_tax_bulk_upsert(jsonb) to authenticated;

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
    l.sku,
    max(l.title) as sample_title,
    max(o.order_created_at) as last_seen_at
  from public.erp_shopify_order_lines l
  join public.erp_shopify_orders o on o.id = l.order_id
  left join public.erp_variants v_sku
    on v_sku.company_id = o.company_id
   and v_sku.sku = l.sku
   and v_sku.hsn is not null
   and v_sku.gst_rate is not null
  left join lateral (
    select v.hsn
      from public.erp_variants v
     where v.company_id = o.company_id
       and v.style_code = case
         when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
         else l.sku
       end
       and v.hsn is not null
       and v.gst_rate is not null
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
   and v_sku.gst_rate is not null
  left join lateral (
    select v.hsn
      from public.erp_variants v
     where v.company_id = o.company_id
       and v.style_code = case
         when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
         else l.sku
       end
       and v.hsn is not null
       and v.gst_rate is not null
     limit 1
  ) v_style on true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and o.order_created_at::date between p_from and p_to
    and l.sku is not null
    and l.sku <> ''
    and v_sku.sku is null
    and v_style.hsn is null
  group by style_code
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

  select array_agg(distinct style_code)
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
       and v_sku.gst_rate is not null
      left join lateral (
        select v.hsn
          from public.erp_variants v
         where v.company_id = v_company_id
           and v.style_code = case
             when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
             else l.sku
           end
           and v.hsn is not null
           and v.gst_rate is not null
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
     and v_sku.gst_rate is not null
    left join lateral (
      select v.hsn
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.style_code = case
           when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
           else l.sku
         end
         and v.hsn is not null
         and v.gst_rate is not null
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
      l.sku,
      case
        when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
        else l.sku
      end as style_code,
      l.quantity,
      l.price,
      l.line_discount,
      coalesce(v_sku.hsn, v_style.hsn) as hsn,
      coalesce(v_sku.gst_rate, v_style.gst_rate) as gst_rate
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_variants v_sku
      on v_sku.company_id = v_company_id
     and v_sku.sku = l.sku
     and v_sku.hsn is not null
     and v_sku.gst_rate is not null
    left join lateral (
      select v.hsn, v.gst_rate
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.style_code = case
           when position('-' in l.sku) > 0 then split_part(l.sku, '-', 1)
           else l.sku
         end
         and v.hsn is not null
         and v.gst_rate is not null
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
