-- 0209_gst_shopify_engine.sql
-- Phase-1 GST data engine (Shopify only)

create table if not exists public.erp_gst_sku_master (
  company_id uuid not null references public.erp_companies (id),
  sku text not null,
  hsn text not null,
  gst_rate numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_gst_sku_master_unique unique (company_id, sku)
);

create table if not exists public.erp_gst_sales_register (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  source text not null default 'shopify',
  source_order_id uuid not null references public.erp_shopify_orders (id),
  source_line_id uuid not null references public.erp_shopify_order_lines (id),
  order_date date not null,
  invoice_no text null,
  seller_state_code text not null default 'RJ',
  buyer_state_code text null,
  sku text null,
  hsn text not null,
  gst_rate numeric not null,
  quantity numeric not null default 0,
  taxable_value numeric not null default 0,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  shipping_taxable_value numeric not null default 0,
  shipping_cgst numeric not null default 0,
  shipping_sgst numeric not null default 0,
  shipping_igst numeric not null default 0,
  total_tax numeric not null default 0,
  raw_calc jsonb not null default '{}'::jsonb,
  is_void boolean not null default false,
  void_reason text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_gst_sales_register_unique_active
  on public.erp_gst_sales_register (company_id, source_line_id)
  where is_void = false;

alter table public.erp_gst_sku_master enable row level security;
alter table public.erp_gst_sku_master force row level security;
alter table public.erp_gst_sales_register enable row level security;
alter table public.erp_gst_sales_register force row level security;

do $$
begin
  drop policy if exists erp_gst_sku_master_select on public.erp_gst_sku_master;
  create policy erp_gst_sku_master_select
    on public.erp_gst_sku_master
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  drop policy if exists erp_gst_sales_register_select on public.erp_gst_sales_register;
  create policy erp_gst_sales_register_select
    on public.erp_gst_sales_register
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create or replace function public.erp_gst_sku_upsert(
  p_sku text,
  p_hsn text,
  p_rate numeric,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_sku is null or trim(p_sku) = '' then
    raise exception 'sku is required';
  end if;

  if p_hsn is null or trim(p_hsn) = '' then
    raise exception 'hsn is required';
  end if;

  if p_rate is null then
    raise exception 'gst_rate is required';
  end if;

  insert into public.erp_gst_sku_master (
    company_id,
    sku,
    hsn,
    gst_rate,
    is_active,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    trim(p_sku),
    trim(p_hsn),
    p_rate,
    coalesce(p_is_active, true),
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, sku)
  do update set
    hsn = excluded.hsn,
    gst_rate = excluded.gst_rate,
    is_active = excluded.is_active,
    updated_at = now(),
    updated_by = v_actor
  returning sku into v_id;

  return jsonb_build_object('ok', true, 'sku', v_id);
end;
$$;

revoke all on function public.erp_gst_sku_upsert(text, text, numeric, boolean) from public;
revoke all on function public.erp_gst_sku_upsert(text, text, numeric, boolean) from authenticated;
grant execute on function public.erp_gst_sku_upsert(text, text, numeric, boolean) to authenticated;

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
  left join public.erp_gst_sku_master m
    on m.company_id = o.company_id
   and m.sku = l.sku
   and m.is_active = true
  where o.company_id = public.erp_current_company_id()
    and o.is_cancelled = false
    and l.sku is not null
    and l.sku <> ''
    and m.sku is null
  group by l.sku
  order by max(o.order_created_at) desc;
end;
$$;

revoke all on function public.erp_gst_missing_skus_shopify() from public;
revoke all on function public.erp_gst_missing_skus_shopify() from authenticated;
grant execute on function public.erp_gst_missing_skus_shopify() to authenticated;

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

  select array_agg(distinct l.sku)
    into v_missing_skus
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    left join public.erp_gst_sku_master m
      on m.company_id = v_company_id
     and m.sku = l.sku
     and m.is_active = true
   where o.company_id = v_company_id
     and o.is_cancelled = false
     and o.order_created_at::date between p_from and p_to
     and l.sku is not null
     and l.sku <> ''
     and m.sku is null;

  v_missing_sku_count := coalesce(array_length(v_missing_skus, 1), 0);

  select count(*)
    into v_missing_state_count
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    join public.erp_gst_sku_master m
      on m.company_id = v_company_id
     and m.sku = l.sku
     and m.is_active = true
   where o.company_id = v_company_id
     and o.is_cancelled = false
     and o.order_created_at::date between p_from and p_to
     and o.shipping_state_code is null;

  with base as (
    select
      o.id as order_id,
      o.order_created_at::date as order_date,
      o.shopify_order_number as invoice_no,
      o.shipping_state_code as buyer_state_code,
      coalesce(o.total_shipping, 0) as order_shipping,
      l.id as line_id,
      l.sku,
      l.quantity,
      l.price,
      l.line_discount,
      m.hsn,
      m.gst_rate
    from public.erp_shopify_orders o
    join public.erp_shopify_order_lines l on l.order_id = o.id
    join public.erp_gst_sku_master m
      on m.company_id = v_company_id
     and m.sku = l.sku
     and m.is_active = true
    where o.company_id = v_company_id
      and o.is_cancelled = false
      and o.order_created_at::date between p_from and p_to
      and (o.financial_status is null or o.financial_status in ('paid', 'partially_paid'))
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
      'missing_state_code', taxcalc.buyer_state_code is null
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
    order_date,
    invoice_no,
    buyer_state_code,
    sku,
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
    total_tax
  from public.erp_gst_sales_register
  where company_id = public.erp_current_company_id()
    and source = 'shopify'
    and is_void = false
    and order_date between p_from and p_to
  order by order_date, invoice_no, sku;
end;
$$;

revoke all on function public.erp_gst_export_b2c_shopify(date, date) from public;
revoke all on function public.erp_gst_export_b2c_shopify(date, date) from authenticated;
grant execute on function public.erp_gst_export_b2c_shopify(date, date) to authenticated;

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
    hsn,
    gst_rate,
    sum(quantity) as quantity,
    sum(taxable_value) as taxable_value,
    sum(shipping_taxable_value) as shipping_taxable_value,
    sum(cgst + shipping_cgst) as cgst,
    sum(sgst + shipping_sgst) as sgst,
    sum(igst + shipping_igst) as igst,
    sum(total_tax) as total_tax
  from public.erp_gst_sales_register
  where company_id = public.erp_current_company_id()
    and source = 'shopify'
    and is_void = false
    and order_date between p_from and p_to
  group by hsn, gst_rate
  order by hsn, gst_rate;
end;
$$;

revoke all on function public.erp_gst_export_hsn_shopify(date, date) from public;
revoke all on function public.erp_gst_export_hsn_shopify(date, date) from authenticated;
grant execute on function public.erp_gst_export_hsn_shopify(date, date) to authenticated;

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
    seller_state_code,
    sum(taxable_value) as taxable_value,
    sum(shipping_taxable_value) as shipping_taxable_value,
    sum(cgst + shipping_cgst) as cgst,
    sum(sgst + shipping_sgst) as sgst,
    sum(igst + shipping_igst) as igst,
    sum(total_tax) as total_tax
  from public.erp_gst_sales_register
  where company_id = public.erp_current_company_id()
    and source = 'shopify'
    and is_void = false
    and order_date between p_from and p_to
  group by seller_state_code
  order by seller_state_code;
end;
$$;

revoke all on function public.erp_gst_export_summary_shopify(date, date) from public;
revoke all on function public.erp_gst_export_summary_shopify(date, date) from authenticated;
grant execute on function public.erp_gst_export_summary_shopify(date, date) to authenticated;
