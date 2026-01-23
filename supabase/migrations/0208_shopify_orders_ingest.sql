-- 0208_shopify_orders_ingest.sql
-- Phase-0 Shopify orders ingest ledger

create table if not exists public.erp_shopify_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  shopify_order_id bigint not null,
  shopify_order_number text null,
  order_created_at timestamptz not null,
  processed_at timestamptz null,
  currency text not null default 'INR',
  financial_status text null,
  fulfillment_status text null,
  cancelled_at timestamptz null,
  is_cancelled boolean not null default false,
  subtotal_price numeric null,
  total_discounts numeric null,
  total_shipping numeric null,
  total_tax numeric null,
  total_price numeric null,
  customer_email text null,
  shipping_state_code text null,
  shipping_pincode text null,
  raw_order jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_shopify_orders_company_order_unique unique (company_id, shopify_order_id)
);

create table if not exists public.erp_shopify_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  order_id uuid not null references public.erp_shopify_orders (id) on delete restrict,
  shopify_order_id bigint not null,
  shopify_line_id bigint not null,
  sku text null,
  title text null,
  quantity numeric not null default 0,
  price numeric null,
  line_discount numeric null default 0,
  taxable boolean not null default true,
  raw_line jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_shopify_order_lines_company_line_unique unique (company_id, shopify_line_id)
);

alter table public.erp_shopify_orders enable row level security;
alter table public.erp_shopify_orders force row level security;
alter table public.erp_shopify_order_lines enable row level security;
alter table public.erp_shopify_order_lines force row level security;

do $$
begin
  drop policy if exists erp_shopify_orders_select on public.erp_shopify_orders;
  create policy erp_shopify_orders_select
    on public.erp_shopify_orders
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

  drop policy if exists erp_shopify_order_lines_select on public.erp_shopify_order_lines;
  create policy erp_shopify_order_lines_select
    on public.erp_shopify_order_lines
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

create or replace function public.erp_shopify_order_upsert(
  p_company_id uuid,
  p_order jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shopify_order_id bigint;
  v_order_id uuid;
  v_actor uuid;
  v_created_by uuid;
  v_shipping_state text;
  v_cancelled_at timestamptz;
  v_is_cancelled boolean;
  v_processed_at timestamptz;
  v_currency text;
  v_subtotal numeric;
  v_discounts numeric;
  v_shipping numeric;
  v_tax numeric;
  v_total numeric;
  v_customer_email text;
  v_order_created_at timestamptz;
  v_shopify_order_number text;
  v_financial_status text;
  v_fulfillment_status text;
begin
  perform public.erp_require_finance_writer_or_service();

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  v_shopify_order_id := nullif(p_order->>'id', '')::bigint;
  if v_shopify_order_id is null then
    raise exception 'shopify_order_id is required';
  end if;

  v_actor := auth.uid();
  if v_actor is null then
    select created_by
      into v_actor
      from public.erp_shopify_orders
     where company_id = p_company_id
       and shopify_order_id = v_shopify_order_id
     limit 1;

    if v_actor is null then
      select user_id
        into v_actor
        from public.erp_company_users
       where company_id = p_company_id
         and role_key = 'owner'
       order by created_at asc
       limit 1;
    end if;

    if v_actor is null then
      select user_id
        into v_actor
        from public.erp_company_users
       where company_id = p_company_id
       order by created_at asc
       limit 1;
    end if;
  end if;

  v_created_by := coalesce(v_actor, auth.uid());
  v_order_created_at := coalesce(nullif(p_order->>'created_at', '')::timestamptz, now());
  v_processed_at := nullif(p_order->>'processed_at', '')::timestamptz;
  v_currency := coalesce(nullif(p_order->>'currency', ''), 'INR');
  v_financial_status := nullif(p_order->>'financial_status', '');
  v_fulfillment_status := nullif(p_order->>'fulfillment_status', '');
  v_cancelled_at := nullif(p_order->>'cancelled_at', '')::timestamptz;
  v_is_cancelled := coalesce((p_order->>'cancelled')::boolean, false);
  if v_cancelled_at is not null then
    v_is_cancelled := true;
  end if;

  v_subtotal := nullif(p_order->>'subtotal_price', '')::numeric;
  v_discounts := nullif(p_order->>'total_discounts', '')::numeric;
  v_shipping := coalesce(
    nullif(p_order->>'total_shipping_price', '')::numeric,
    nullif(p_order#>>'{total_shipping_price_set,shop_money,amount}', '')::numeric
  );
  v_tax := nullif(p_order->>'total_tax', '')::numeric;
  v_total := nullif(p_order->>'total_price', '')::numeric;
  v_customer_email := coalesce(
    nullif(p_order->>'email', ''),
    nullif(p_order#>>'{customer,email}', '')
  );
  v_shipping_state := upper(nullif(p_order#>>'{shipping_address,province_code}', ''));

  v_shopify_order_number := coalesce(nullif(p_order->>'name', ''), nullif(p_order->>'order_number', ''));

  insert into public.erp_shopify_orders (
    company_id,
    shopify_order_id,
    shopify_order_number,
    order_created_at,
    processed_at,
    currency,
    financial_status,
    fulfillment_status,
    cancelled_at,
    is_cancelled,
    subtotal_price,
    total_discounts,
    total_shipping,
    total_tax,
    total_price,
    customer_email,
    shipping_state_code,
    shipping_pincode,
    raw_order,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_company_id,
    v_shopify_order_id,
    v_shopify_order_number,
    v_order_created_at,
    v_processed_at,
    v_currency,
    v_financial_status,
    v_fulfillment_status,
    v_cancelled_at,
    v_is_cancelled,
    v_subtotal,
    v_discounts,
    v_shipping,
    v_tax,
    v_total,
    v_customer_email,
    v_shipping_state,
    nullif(p_order#>>'{shipping_address,zip}', ''),
    coalesce(p_order, '{}'::jsonb),
    now(),
    v_created_by,
    now(),
    v_created_by
  )
  on conflict (company_id, shopify_order_id)
  do update set
    shopify_order_number = excluded.shopify_order_number,
    order_created_at = excluded.order_created_at,
    processed_at = excluded.processed_at,
    currency = excluded.currency,
    financial_status = excluded.financial_status,
    fulfillment_status = excluded.fulfillment_status,
    cancelled_at = excluded.cancelled_at,
    is_cancelled = excluded.is_cancelled,
    subtotal_price = excluded.subtotal_price,
    total_discounts = excluded.total_discounts,
    total_shipping = excluded.total_shipping,
    total_tax = excluded.total_tax,
    total_price = excluded.total_price,
    customer_email = excluded.customer_email,
    shipping_state_code = excluded.shipping_state_code,
    shipping_pincode = excluded.shipping_pincode,
    raw_order = excluded.raw_order,
    updated_at = now(),
    updated_by = v_created_by
  returning id into v_order_id;

  insert into public.erp_shopify_order_lines (
    company_id,
    order_id,
    shopify_order_id,
    shopify_line_id,
    sku,
    title,
    quantity,
    price,
    line_discount,
    taxable,
    raw_line,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  select
    p_company_id,
    v_order_id,
    v_shopify_order_id,
    nullif(line_item->>'id', '')::bigint,
    nullif(line_item->>'sku', ''),
    nullif(line_item->>'title', ''),
    coalesce(nullif(line_item->>'quantity', '')::numeric, 0),
    nullif(line_item->>'price', '')::numeric,
    coalesce(nullif(line_item->>'total_discount', '')::numeric, 0),
    coalesce((line_item->>'taxable')::boolean, true),
    coalesce(line_item, '{}'::jsonb),
    now(),
    v_created_by,
    now(),
    v_created_by
  from jsonb_array_elements(coalesce(p_order->'line_items', '[]'::jsonb)) as line_item
  where line_item ? 'id'
  on conflict (company_id, shopify_line_id)
  do update set
    order_id = excluded.order_id,
    shopify_order_id = excluded.shopify_order_id,
    sku = excluded.sku,
    title = excluded.title,
    quantity = excluded.quantity,
    price = excluded.price,
    line_discount = excluded.line_discount,
    taxable = excluded.taxable,
    raw_line = excluded.raw_line,
    updated_at = now(),
    updated_by = v_created_by;

  return v_order_id;
end;
$$;

revoke all on function public.erp_shopify_order_upsert(uuid, jsonb) from public;
revoke all on function public.erp_shopify_order_upsert(uuid, jsonb) from authenticated;
grant execute on function public.erp_shopify_order_upsert(uuid, jsonb) to authenticated;
grant execute on function public.erp_shopify_order_upsert(uuid, jsonb) to service_role;
