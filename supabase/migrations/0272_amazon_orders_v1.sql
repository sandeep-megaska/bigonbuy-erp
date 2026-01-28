-- 0272_amazon_orders_v1.sql
-- Amazon Orders API v1 tables + RPCs

create table if not exists public.erp_amazon_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  marketplace_id text not null,
  amazon_order_id text not null,
  order_status text null,
  purchase_date timestamptz null,
  last_update_date timestamptz null,
  fulfillment_channel text null,
  sales_channel text null,
  order_type text null,
  buyer_email text null,
  buyer_name text null,
  ship_service_level text null,
  currency text null,
  order_total numeric null,
  number_of_items_shipped int null,
  number_of_items_unshipped int null,
  is_prime boolean null,
  is_premium_order boolean null,
  is_business_order boolean null,
  shipping_address_city text null,
  shipping_address_state text null,
  shipping_address_postal_code text null,
  shipping_address_country_code text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_amazon_orders_unique unique (company_id, marketplace_id, amazon_order_id)
);

create index if not exists erp_amazon_orders_company_marketplace_purchase_idx
  on public.erp_amazon_orders (company_id, marketplace_id, purchase_date desc);

create index if not exists erp_amazon_orders_company_marketplace_status_idx
  on public.erp_amazon_orders (company_id, marketplace_id, order_status);

create index if not exists erp_amazon_orders_company_marketplace_updated_idx
  on public.erp_amazon_orders (company_id, marketplace_id, last_update_date desc);

create table if not exists public.erp_amazon_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  marketplace_id text not null,
  amazon_order_id text not null,
  order_item_id text not null,
  asin text null,
  seller_sku text null,
  title text null,
  quantity_ordered int null,
  quantity_shipped int null,
  item_price numeric null,
  item_tax numeric null,
  currency text null,
  promotion_discount numeric null,
  is_gift boolean null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_amazon_order_items_unique unique (company_id, marketplace_id, amazon_order_id, order_item_id)
);

create index if not exists erp_amazon_order_items_company_marketplace_order_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, amazon_order_id);

create index if not exists erp_amazon_order_items_company_marketplace_sku_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, seller_sku);

create index if not exists erp_amazon_order_items_company_marketplace_asin_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, asin);

create table if not exists public.erp_sync_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  source_key text not null,
  marketplace_id text not null,
  last_updated_after timestamptz null,
  last_created_after timestamptz null,
  last_run_at timestamptz null,
  last_status text null,
  last_error text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_sync_state_unique unique (company_id, source_key, marketplace_id)
);

drop trigger if exists erp_amazon_orders_set_updated on public.erp_amazon_orders;
create trigger erp_amazon_orders_set_updated
before update on public.erp_amazon_orders
for each row
execute function public.erp_set_updated_cols();

drop trigger if exists erp_amazon_order_items_set_updated on public.erp_amazon_order_items;
create trigger erp_amazon_order_items_set_updated
before update on public.erp_amazon_order_items
for each row
execute function public.erp_set_updated_cols();

drop trigger if exists erp_sync_state_set_updated on public.erp_sync_state;
create trigger erp_sync_state_set_updated
before update on public.erp_sync_state
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_amazon_orders enable row level security;
alter table public.erp_amazon_orders force row level security;
alter table public.erp_amazon_order_items enable row level security;
alter table public.erp_amazon_order_items force row level security;
alter table public.erp_sync_state enable row level security;
alter table public.erp_sync_state force row level security;

do $$
begin
  drop policy if exists erp_amazon_orders_select on public.erp_amazon_orders;
  drop policy if exists erp_amazon_orders_write on public.erp_amazon_orders;
  drop policy if exists erp_amazon_order_items_select on public.erp_amazon_order_items;
  drop policy if exists erp_amazon_order_items_write on public.erp_amazon_order_items;
  drop policy if exists erp_sync_state_select on public.erp_sync_state;
  drop policy if exists erp_sync_state_write on public.erp_sync_state;

  create policy erp_amazon_orders_select
    on public.erp_amazon_orders
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_amazon_orders_write
    on public.erp_amazon_orders
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_amazon_order_items_select
    on public.erp_amazon_order_items
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_amazon_order_items_write
    on public.erp_amazon_order_items
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_sync_state_select
    on public.erp_sync_state
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_sync_state_write
    on public.erp_sync_state
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );
end;
$$;

create or replace function public.erp_amazon_orders_upsert(
  p_marketplace_id text,
  p_order jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_order jsonb := p_order;
  v_amazon_order_id text;
  v_order_total numeric;
  v_order_total_currency text;
  v_purchase_date timestamptz;
  v_last_update_date timestamptz;
  v_number_items_shipped int;
  v_number_items_unshipped int;
  v_is_prime boolean;
  v_is_premium boolean;
  v_is_business boolean;
  v_result_id uuid;
  v_order_total_raw text;
  v_item_count_raw text;
  v_item_unshipped_raw text;
  v_bool_raw text;
  v_bool_premium_raw text;
  v_bool_business_raw text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_order is null or jsonb_typeof(v_order) <> 'object' then
    raise exception 'p_order must be an object';
  end if;

  v_amazon_order_id := nullif(trim(v_order->>'AmazonOrderId'), '');
  if v_amazon_order_id is null then
    raise exception 'AmazonOrderId is required';
  end if;

  begin
    v_purchase_date := (v_order->>'PurchaseDate')::timestamptz;
  exception
    when others then
      v_purchase_date := null;
  end;

  begin
    v_last_update_date := (v_order->>'LastUpdateDate')::timestamptz;
  exception
    when others then
      v_last_update_date := null;
  end;

  v_order_total_currency := nullif(trim(v_order->'OrderTotal'->>'CurrencyCode'), '');
  v_order_total_raw := nullif(trim(v_order->'OrderTotal'->>'Amount'), '');
  if v_order_total_raw ~ '^[-]?[0-9]+(\\.[0-9]+)?$' then
    v_order_total := v_order_total_raw::numeric;
  else
    v_order_total := null;
  end if;

  v_item_count_raw := nullif(trim(v_order->>'NumberOfItemsShipped'), '');
  if v_item_count_raw ~ '^[-]?[0-9]+$' then
    v_number_items_shipped := v_item_count_raw::int;
  else
    v_number_items_shipped := null;
  end if;

  v_item_unshipped_raw := nullif(trim(v_order->>'NumberOfItemsUnshipped'), '');
  if v_item_unshipped_raw ~ '^[-]?[0-9]+$' then
    v_number_items_unshipped := v_item_unshipped_raw::int;
  else
    v_number_items_unshipped := null;
  end if;

  v_bool_raw := lower(nullif(trim(v_order->>'IsPrime'), ''));
  if v_bool_raw in ('true', 'false') then
    v_is_prime := v_bool_raw::boolean;
  else
    v_is_prime := null;
  end if;

  v_bool_premium_raw := lower(nullif(trim(v_order->>'IsPremiumOrder'), ''));
  if v_bool_premium_raw in ('true', 'false') then
    v_is_premium := v_bool_premium_raw::boolean;
  else
    v_is_premium := null;
  end if;

  v_bool_business_raw := lower(nullif(trim(v_order->>'IsBusinessOrder'), ''));
  if v_bool_business_raw in ('true', 'false') then
    v_is_business := v_bool_business_raw::boolean;
  else
    v_is_business := null;
  end if;

  insert into public.erp_amazon_orders (
    company_id,
    marketplace_id,
    amazon_order_id,
    order_status,
    purchase_date,
    last_update_date,
    fulfillment_channel,
    sales_channel,
    order_type,
    buyer_email,
    buyer_name,
    ship_service_level,
    currency,
    order_total,
    number_of_items_shipped,
    number_of_items_unshipped,
    is_prime,
    is_premium_order,
    is_business_order,
    shipping_address_city,
    shipping_address_state,
    shipping_address_postal_code,
    shipping_address_country_code,
    payload,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_marketplace_id,
    v_amazon_order_id,
    nullif(trim(v_order->>'OrderStatus'), ''),
    v_purchase_date,
    v_last_update_date,
    nullif(trim(v_order->>'FulfillmentChannel'), ''),
    nullif(trim(v_order->>'SalesChannel'), ''),
    nullif(trim(v_order->>'OrderType'), ''),
    nullif(trim(v_order->>'BuyerEmail'), ''),
    nullif(trim(v_order->>'BuyerName'), ''),
    nullif(trim(v_order->>'ShipServiceLevel'), ''),
    v_order_total_currency,
    v_order_total,
    v_number_items_shipped,
    v_number_items_unshipped,
    v_is_prime,
    v_is_premium,
    v_is_business,
    nullif(trim(v_order->'ShippingAddress'->>'City'), ''),
    nullif(trim(v_order->'ShippingAddress'->>'StateOrRegion'), ''),
    nullif(trim(v_order->'ShippingAddress'->>'PostalCode'), ''),
    nullif(trim(v_order->'ShippingAddress'->>'CountryCode'), ''),
    v_order,
    auth.uid(),
    auth.uid()
  )
  on conflict on constraint erp_amazon_orders_unique
  do update set
    order_status = excluded.order_status,
    purchase_date = excluded.purchase_date,
    last_update_date = excluded.last_update_date,
    fulfillment_channel = excluded.fulfillment_channel,
    sales_channel = excluded.sales_channel,
    order_type = excluded.order_type,
    buyer_email = excluded.buyer_email,
    buyer_name = excluded.buyer_name,
    ship_service_level = excluded.ship_service_level,
    currency = excluded.currency,
    order_total = excluded.order_total,
    number_of_items_shipped = excluded.number_of_items_shipped,
    number_of_items_unshipped = excluded.number_of_items_unshipped,
    is_prime = excluded.is_prime,
    is_premium_order = excluded.is_premium_order,
    is_business_order = excluded.is_business_order,
    shipping_address_city = excluded.shipping_address_city,
    shipping_address_state = excluded.shipping_address_state,
    shipping_address_postal_code = excluded.shipping_address_postal_code,
    shipping_address_country_code = excluded.shipping_address_country_code,
    payload = excluded.payload,
    updated_at = now(),
    updated_by = auth.uid()
  returning id into v_result_id;

  return v_result_id;
end;
$$;

revoke all on function public.erp_amazon_orders_upsert(text, jsonb) from public;

grant execute on function public.erp_amazon_orders_upsert(text, jsonb) to authenticated;

create or replace function public.erp_amazon_order_items_replace(
  p_marketplace_id text,
  p_amazon_order_id text,
  p_items jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_amazon_order_id text := nullif(trim(p_amazon_order_id), '');
  v_inserted int := 0;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_amazon_order_id is null then
    raise exception 'amazon_order_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be an array';
  end if;

  delete from public.erp_amazon_order_items
   where company_id = v_company_id
     and marketplace_id = v_marketplace_id
     and amazon_order_id = v_amazon_order_id;

  insert into public.erp_amazon_order_items (
    company_id,
    marketplace_id,
    amazon_order_id,
    order_item_id,
    asin,
    seller_sku,
    title,
    quantity_ordered,
    quantity_shipped,
    item_price,
    item_tax,
    currency,
    promotion_discount,
    is_gift,
    payload,
    created_by,
    updated_by
  )
  select
    v_company_id,
    v_marketplace_id,
    v_amazon_order_id,
    nullif(trim(item->>'OrderItemId'), ''),
    nullif(trim(item->>'ASIN'), ''),
    nullif(trim(item->>'SellerSKU'), ''),
    nullif(trim(item->>'Title'), ''),
    case
      when (item->>'QuantityOrdered') ~ '^[-]?[0-9]+$' then (item->>'QuantityOrdered')::int
      else null
    end,
    case
      when (item->>'QuantityShipped') ~ '^[-]?[0-9]+$' then (item->>'QuantityShipped')::int
      else null
    end,
    case
      when (item->'ItemPrice'->>'Amount') ~ '^[-]?[0-9]+(\\.[0-9]+)?$' then (item->'ItemPrice'->>'Amount')::numeric
      else null
    end,
    case
      when (item->'ItemTax'->>'Amount') ~ '^[-]?[0-9]+(\\.[0-9]+)?$' then (item->'ItemTax'->>'Amount')::numeric
      else null
    end,
    nullif(trim(coalesce(item->'ItemPrice'->>'CurrencyCode', item->'ItemTax'->>'CurrencyCode')), ''),
    case
      when (item->'PromotionDiscount'->>'Amount') ~ '^[-]?[0-9]+(\\.[0-9]+)?$' then (item->'PromotionDiscount'->>'Amount')::numeric
      else null
    end,
    case
      when lower(nullif(trim(item->>'IsGift'), '')) in ('true', 'false') then (item->>'IsGift')::boolean
      else null
    end,
    item,
    auth.uid(),
    auth.uid()
  from jsonb_array_elements(p_items) as item
  where nullif(trim(item->>'OrderItemId'), '') is not null;

  get diagnostics v_inserted = row_count;

  return v_inserted;
end;
$$;

revoke all on function public.erp_amazon_order_items_replace(text, text, jsonb) from public;

grant execute on function public.erp_amazon_order_items_replace(text, text, jsonb) to authenticated;

create or replace function public.erp_amazon_orders_list(
  p_marketplace_id text,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_q text default null,
  p_limit int default 100,
  p_offset int default 0
) returns table (
  amazon_order_id text,
  order_status text,
  purchase_date timestamptz,
  last_update_date timestamptz,
  fulfillment_channel text,
  sales_channel text,
  order_type text,
  buyer_email text,
  buyer_name text,
  ship_service_level text,
  currency text,
  order_total numeric,
  number_of_items_shipped int,
  number_of_items_unshipped int,
  is_prime boolean,
  is_business_order boolean,
  shipping_address_city text,
  shipping_address_state text,
  shipping_address_country_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_q text := nullif(trim(p_q), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  perform public.erp_require_inventory_reader();

  return query
  select
    o.amazon_order_id,
    o.order_status,
    o.purchase_date,
    o.last_update_date,
    o.fulfillment_channel,
    o.sales_channel,
    o.order_type,
    o.buyer_email,
    o.buyer_name,
    o.ship_service_level,
    o.currency,
    o.order_total,
    o.number_of_items_shipped,
    o.number_of_items_unshipped,
    o.is_prime,
    o.is_business_order,
    o.shipping_address_city,
    o.shipping_address_state,
    o.shipping_address_country_code
  from public.erp_amazon_orders o
  where o.company_id = v_company_id
    and o.marketplace_id = v_marketplace_id
    and (p_status is null or o.order_status = p_status)
    and (p_from is null or o.purchase_date::date >= p_from)
    and (p_to is null or o.purchase_date::date <= p_to)
    and (
      v_q is null
      or o.amazon_order_id ilike '%' || v_q || '%'
      or exists (
        select 1
        from public.erp_amazon_order_items i
        where i.company_id = o.company_id
          and i.marketplace_id = o.marketplace_id
          and i.amazon_order_id = o.amazon_order_id
          and (
            coalesce(i.seller_sku, '') ilike '%' || v_q || '%'
            or coalesce(i.asin, '') ilike '%' || v_q || '%'
            or coalesce(i.title, '') ilike '%' || v_q || '%'
          )
      )
    )
  order by o.purchase_date desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_orders_list(text, text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_orders_list(text, text, date, date, text, int, int) to authenticated;

create or replace function public.erp_amazon_order_detail(
  p_marketplace_id text,
  p_amazon_order_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_order_id text := nullif(trim(p_amazon_order_id), '');
  v_payload jsonb;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null or v_order_id is null then
    raise exception 'marketplace_id and amazon_order_id are required';
  end if;

  perform public.erp_require_inventory_reader();

  select
    jsonb_build_object(
      'order', to_jsonb(o),
      'items', coalesce(
        (
          select jsonb_agg(to_jsonb(i) order by i.created_at)
          from public.erp_amazon_order_items i
          where i.company_id = o.company_id
            and i.marketplace_id = o.marketplace_id
            and i.amazon_order_id = o.amazon_order_id
        ),
        '[]'::jsonb
      )
    )
  into v_payload
  from public.erp_amazon_orders o
  where o.company_id = v_company_id
    and o.marketplace_id = v_marketplace_id
    and o.amazon_order_id = v_order_id
  limit 1;

  return v_payload;
end;
$$;

revoke all on function public.erp_amazon_order_detail(text, text) from public;

grant execute on function public.erp_amazon_order_detail(text, text) to authenticated;
