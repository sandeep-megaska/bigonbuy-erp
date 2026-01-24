-- 0244_shopify_oms_canonicalization.sql
-- Phase-4A Shopify OMS canonicalization: OMS orders + inventory reservations

create table if not exists public.erp_oms_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  channel_account_id uuid null references public.erp_channel_accounts (id) on delete set null,
  source text not null default 'shopify',
  source_order_id uuid null references public.erp_shopify_orders (id) on delete set null,
  external_order_id bigint not null,
  external_order_number text null,
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
  status text not null default 'open',
  raw_order jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_oms_orders_company_source_external_unique unique (company_id, source, external_order_id)
);

create index if not exists erp_oms_orders_company_id_idx
  on public.erp_oms_orders (company_id, order_created_at desc);

create table if not exists public.erp_oms_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  order_id uuid not null references public.erp_oms_orders (id) on delete restrict,
  source_line_id uuid null references public.erp_shopify_order_lines (id) on delete set null,
  external_line_id bigint not null,
  sku text null,
  title text null,
  quantity numeric not null default 0,
  price numeric null,
  line_discount numeric null default 0,
  taxable boolean not null default true,
  variant_id uuid null references public.erp_variants (id) on delete set null,
  reservation_id uuid null references public.erp_stock_reservations (id) on delete set null,
  status text not null default 'open',
  raw_line jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_oms_order_lines_company_external_unique unique (company_id, external_line_id)
);

create index if not exists erp_oms_order_lines_order_id_idx
  on public.erp_oms_order_lines (order_id);

create table if not exists public.erp_oms_fulfillments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  order_id uuid not null references public.erp_oms_orders (id) on delete cascade,
  source text not null default 'shopify',
  external_fulfillment_id bigint null,
  status text not null default 'fulfilled',
  fulfilled_at timestamptz not null default now(),
  raw_fulfillment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_oms_fulfillments_unique_ext
  on public.erp_oms_fulfillments (company_id, source, external_fulfillment_id)
  where external_fulfillment_id is not null;

create index if not exists erp_oms_fulfillments_order_id_idx
  on public.erp_oms_fulfillments (order_id);

create table if not exists public.erp_oms_refunds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id),
  order_id uuid not null references public.erp_oms_orders (id) on delete cascade,
  source text not null default 'shopify',
  external_refund_id bigint null,
  status text not null default 'refunded',
  refunded_at timestamptz not null default now(),
  raw_refund jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_oms_refunds_unique_ext
  on public.erp_oms_refunds (company_id, source, external_refund_id)
  where external_refund_id is not null;

create index if not exists erp_oms_refunds_order_id_idx
  on public.erp_oms_refunds (order_id);

create unique index if not exists erp_stock_reservations_source_unique
  on public.erp_stock_reservations (company_id, source_type, source_ref);

alter table public.erp_oms_orders enable row level security;
alter table public.erp_oms_orders force row level security;
alter table public.erp_oms_order_lines enable row level security;
alter table public.erp_oms_order_lines force row level security;
alter table public.erp_oms_fulfillments enable row level security;
alter table public.erp_oms_fulfillments force row level security;
alter table public.erp_oms_refunds enable row level security;
alter table public.erp_oms_refunds force row level security;

create trigger erp_oms_orders_set_updated
before update on public.erp_oms_orders
for each row
execute function public.erp_set_updated_cols();

create trigger erp_oms_order_lines_set_updated
before update on public.erp_oms_order_lines
for each row
execute function public.erp_set_updated_cols();

create trigger erp_oms_fulfillments_set_updated
before update on public.erp_oms_fulfillments
for each row
execute function public.erp_set_updated_cols();

create trigger erp_oms_refunds_set_updated
before update on public.erp_oms_refunds
for each row
execute function public.erp_set_updated_cols();

do $$
begin
  drop policy if exists erp_oms_orders_select on public.erp_oms_orders;
  drop policy if exists erp_oms_orders_write on public.erp_oms_orders;
  drop policy if exists erp_oms_order_lines_select on public.erp_oms_order_lines;
  drop policy if exists erp_oms_order_lines_write on public.erp_oms_order_lines;
  drop policy if exists erp_oms_fulfillments_select on public.erp_oms_fulfillments;
  drop policy if exists erp_oms_fulfillments_write on public.erp_oms_fulfillments;
  drop policy if exists erp_oms_refunds_select on public.erp_oms_refunds;
  drop policy if exists erp_oms_refunds_write on public.erp_oms_refunds;

  create policy erp_oms_orders_select
    on public.erp_oms_orders
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_orders_write
    on public.erp_oms_orders
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_order_lines_select
    on public.erp_oms_order_lines
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_order_lines_write
    on public.erp_oms_order_lines
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_fulfillments_select
    on public.erp_oms_fulfillments
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_fulfillments_write
    on public.erp_oms_fulfillments
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_refunds_select
    on public.erp_oms_refunds
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );

  create policy erp_oms_refunds_write
    on public.erp_oms_refunds
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
            and cu.role_key in ('owner', 'admin', 'finance', 'inventory')
        )
      )
    );
end $$;

create or replace function public.erp_oms_shopify_channel_account(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_account_id uuid;
  v_actor uuid := auth.uid();
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  select id
    into v_channel_account_id
    from public.erp_channel_accounts
   where company_id = p_company_id
     and channel_key = 'shopify'
   limit 1;

  if v_channel_account_id is null then
    insert into public.erp_channel_accounts (
      company_id,
      channel_key,
      name,
      is_active,
      metadata,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      p_company_id,
      'shopify',
      'Shopify',
      true,
      '{}'::jsonb,
      now(),
      v_actor,
      now(),
      v_actor
    )
    returning id into v_channel_account_id;
  end if;

  return v_channel_account_id;
end;
$$;

revoke all on function public.erp_oms_shopify_channel_account(uuid) from public;
revoke all on function public.erp_oms_shopify_channel_account(uuid) from authenticated;
grant execute on function public.erp_oms_shopify_channel_account(uuid) to authenticated;
grant execute on function public.erp_oms_shopify_channel_account(uuid) to service_role;

create or replace function public.erp_oms_sync_from_shopify(
  p_company_id uuid,
  p_shopify_order_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_shopify_orders%rowtype;
  v_oms_order_id uuid;
  v_line public.erp_shopify_order_lines%rowtype;
  v_line_id uuid;
  v_channel_account_id uuid;
  v_warehouse_id uuid;
  v_variant_id uuid;
  v_reservation_id uuid;
  v_existing_reservation public.erp_stock_reservations%rowtype;
  v_lines_upserted int := 0;
  v_reservations_created int := 0;
  v_reservations_updated int := 0;
  v_reservations_released int := 0;
  v_order_status text;
  v_line_status text;
begin
  perform public.erp_require_finance_writer_or_service();

  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_shopify_order_id is null then
    raise exception 'shopify_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_shopify_orders
   where company_id = p_company_id
     and shopify_order_id = p_shopify_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'shopify order not found';
  end if;

  v_channel_account_id := public.erp_oms_shopify_channel_account(p_company_id);
  v_warehouse_id := public.erp_oms_channel_default_warehouse(v_channel_account_id);

  if v_warehouse_id is null then
    raise exception 'No default warehouse configured for Shopify channel';
  end if;

  v_order_status := case
    when v_order.is_cancelled then 'cancelled'
    when v_order.fulfillment_status = 'fulfilled' then 'fulfilled'
    when v_order.fulfillment_status = 'partial' then 'partially_fulfilled'
    else 'open'
  end;

  insert into public.erp_oms_orders (
    company_id,
    channel_account_id,
    source,
    source_order_id,
    external_order_id,
    external_order_number,
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
    status,
    raw_order,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_company_id,
    v_channel_account_id,
    'shopify',
    v_order.id,
    v_order.shopify_order_id,
    v_order.shopify_order_number,
    v_order.order_created_at,
    v_order.processed_at,
    v_order.currency,
    v_order.financial_status,
    v_order.fulfillment_status,
    v_order.cancelled_at,
    v_order.is_cancelled,
    v_order.subtotal_price,
    v_order.total_discounts,
    v_order.total_shipping,
    v_order.total_tax,
    v_order.total_price,
    v_order.customer_email,
    v_order.shipping_state_code,
    v_order.shipping_pincode,
    v_order_status,
    v_order.raw_order,
    now(),
    coalesce(v_actor, v_order.created_by),
    now(),
    coalesce(v_actor, v_order.updated_by)
  )
  on conflict (company_id, source, external_order_id)
  do update set
    channel_account_id = excluded.channel_account_id,
    source_order_id = excluded.source_order_id,
    external_order_number = excluded.external_order_number,
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
    status = excluded.status,
    raw_order = excluded.raw_order,
    updated_at = now(),
    updated_by = coalesce(v_actor, excluded.updated_by)
  returning id into v_oms_order_id;

  for v_line in
    select *
      from public.erp_shopify_order_lines
     where company_id = p_company_id
       and order_id = v_order.id
  loop
    v_reservation_id := null;
    v_existing_reservation := null;
    v_line_status := case
      when v_order.is_cancelled then 'cancelled'
      else 'open'
    end;

    select alias.variant_id
      into v_variant_id
      from public.erp_channel_listing_aliases alias
     where alias.company_id = p_company_id
       and alias.channel_account_id = v_channel_account_id
       and alias.channel_sku = v_line.sku
       and alias.is_active
     limit 1;

    if v_variant_id is null and v_line.sku is not null then
      select v.id
        into v_variant_id
        from public.erp_variants v
       where v.sku = v_line.sku
       limit 1;
    end if;

    insert into public.erp_oms_order_lines (
      company_id,
      order_id,
      source_line_id,
      external_line_id,
      sku,
      title,
      quantity,
      price,
      line_discount,
      taxable,
      variant_id,
      status,
      raw_line,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      p_company_id,
      v_oms_order_id,
      v_line.id,
      v_line.shopify_line_id,
      v_line.sku,
      v_line.title,
      v_line.quantity,
      v_line.price,
      v_line.line_discount,
      v_line.taxable,
      v_variant_id,
      v_line_status,
      v_line.raw_line,
      now(),
      coalesce(v_actor, v_line.created_by),
      now(),
      coalesce(v_actor, v_line.updated_by)
    )
    on conflict (company_id, external_line_id)
    do update set
      order_id = excluded.order_id,
      source_line_id = excluded.source_line_id,
      sku = excluded.sku,
      title = excluded.title,
      quantity = excluded.quantity,
      price = excluded.price,
      line_discount = excluded.line_discount,
      taxable = excluded.taxable,
      variant_id = excluded.variant_id,
      status = excluded.status,
      raw_line = excluded.raw_line,
      updated_at = now(),
      updated_by = coalesce(v_actor, excluded.updated_by)
    returning id into v_line_id;

    v_lines_upserted := v_lines_upserted + 1;

    if v_line_id is not null then
      select *
        into v_existing_reservation
        from public.erp_stock_reservations
       where company_id = p_company_id
         and source_type = 'oms_order_line'
         and source_ref = v_line_id::text
       limit 1;

      if v_order.is_cancelled then
        if v_existing_reservation.id is not null and v_existing_reservation.status = 'active' then
          update public.erp_stock_reservations
             set status = 'cancelled'
           where id = v_existing_reservation.id;
          v_reservations_released := v_reservations_released + 1;
        end if;
      else
        if v_existing_reservation.id is null and v_variant_id is not null then
          insert into public.erp_stock_reservations (
            company_id,
            warehouse_id,
            variant_id,
            qty_reserved,
            source_type,
            source_ref,
            status,
            created_at,
            created_by
          ) values (
            p_company_id,
            v_warehouse_id,
            v_variant_id,
            v_line.quantity,
            'oms_order_line',
            v_line_id::text,
            'active',
            now(),
            coalesce(v_actor, v_line.created_by)
          )
          returning id into v_reservation_id;

          v_reservations_created := v_reservations_created + 1;
        elsif v_existing_reservation.id is not null then
          update public.erp_stock_reservations
             set qty_reserved = v_line.quantity,
                 status = 'active'
           where id = v_existing_reservation.id;
          v_reservations_updated := v_reservations_updated + 1;
          v_reservation_id := v_existing_reservation.id;
        end if;
      end if;

      if v_reservation_id is not null then
        update public.erp_oms_order_lines
           set reservation_id = v_reservation_id
         where id = v_line_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'oms_order_id', v_oms_order_id,
    'lines_upserted', v_lines_upserted,
    'reservations_created', v_reservations_created,
    'reservations_updated', v_reservations_updated,
    'reservations_released', v_reservations_released
  );
end;
$$;

revoke all on function public.erp_oms_sync_from_shopify(uuid, bigint) from public;
revoke all on function public.erp_oms_sync_from_shopify(uuid, bigint) from authenticated;
grant execute on function public.erp_oms_sync_from_shopify(uuid, bigint) to authenticated;
grant execute on function public.erp_oms_sync_from_shopify(uuid, bigint) to service_role;

create or replace function public.erp_oms_reserve_inventory(
  p_oms_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_warehouse_id uuid;
  v_reservation_id uuid;
  v_existing_reservation public.erp_stock_reservations%rowtype;
  v_reservations_created int := 0;
  v_reservations_updated int := 0;
  v_reservations_released int := 0;
begin
  perform public.erp_require_finance_writer_or_service();

  if p_oms_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_oms_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_warehouse_id := public.erp_oms_channel_default_warehouse(v_order.channel_account_id);
  if v_warehouse_id is null then
    raise exception 'No default warehouse configured for channel';
  end if;

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    v_reservation_id := null;
    v_existing_reservation := null;
    select *
      into v_existing_reservation
      from public.erp_stock_reservations
     where company_id = v_order.company_id
       and source_type = 'oms_order_line'
       and source_ref = v_line.id::text
     limit 1;

    if v_order.is_cancelled then
      if v_existing_reservation.id is not null and v_existing_reservation.status = 'active' then
        update public.erp_stock_reservations
           set status = 'cancelled'
         where id = v_existing_reservation.id;
        v_reservations_released := v_reservations_released + 1;
      end if;
    else
      if v_existing_reservation.id is null and v_line.variant_id is not null then
        insert into public.erp_stock_reservations (
          company_id,
          warehouse_id,
          variant_id,
          qty_reserved,
          source_type,
          source_ref,
          status,
          created_at,
          created_by
        ) values (
          v_order.company_id,
          v_warehouse_id,
          v_line.variant_id,
          v_line.quantity,
          'oms_order_line',
          v_line.id::text,
          'active',
          now(),
          coalesce(v_actor, v_order.created_by)
        )
        returning id into v_reservation_id;

        v_reservations_created := v_reservations_created + 1;
      elsif v_existing_reservation.id is not null then
        update public.erp_stock_reservations
           set qty_reserved = v_line.quantity,
               status = 'active'
         where id = v_existing_reservation.id;
        v_reservations_updated := v_reservations_updated + 1;
        v_reservation_id := v_existing_reservation.id;
      end if;
    end if;

    if v_reservation_id is not null then
      update public.erp_oms_order_lines
         set reservation_id = v_reservation_id
       where id = v_line.id;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reservations_created', v_reservations_created,
    'reservations_updated', v_reservations_updated,
    'reservations_released', v_reservations_released
  );
end;
$$;

revoke all on function public.erp_oms_reserve_inventory(uuid) from public;
revoke all on function public.erp_oms_reserve_inventory(uuid) from authenticated;
grant execute on function public.erp_oms_reserve_inventory(uuid) to authenticated;
grant execute on function public.erp_oms_reserve_inventory(uuid) to service_role;

create or replace function public.erp_oms_fulfill_order(
  p_oms_order_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_fulfillment_id uuid;
  v_external_id bigint;
  v_existing_fulfillment uuid;
  v_ledger_inserted int := 0;
  v_reservations_closed int := 0;
  v_reservation public.erp_stock_reservations%rowtype;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_oms_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_oms_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_external_id := nullif(p_payload->>'id', '')::bigint;

  if v_external_id is not null then
    select id
      into v_existing_fulfillment
      from public.erp_oms_fulfillments
     where company_id = v_order.company_id
       and source = 'shopify'
       and external_fulfillment_id = v_external_id
     limit 1;
  end if;

  if v_existing_fulfillment is null then
    insert into public.erp_oms_fulfillments (
      company_id,
      order_id,
      source,
      external_fulfillment_id,
      status,
      fulfilled_at,
      raw_fulfillment,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      'shopify',
      v_external_id,
      'fulfilled',
      coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now()),
      coalesce(p_payload, '{}'::jsonb),
      now(),
      coalesce(v_actor, v_order.created_by),
      now(),
      coalesce(v_actor, v_order.updated_by)
    )
    returning id into v_fulfillment_id;
  else
    v_fulfillment_id := v_existing_fulfillment;
  end if;

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    select *
      into v_reservation
      from public.erp_stock_reservations
     where company_id = v_order.company_id
       and source_type = 'oms_order_line'
       and source_ref = v_line.id::text
     limit 1;

    if v_reservation.id is not null and v_reservation.status = 'active' then
      update public.erp_stock_reservations
         set status = 'fulfilled'
       where id = v_reservation.id;
      v_reservations_closed := v_reservations_closed + 1;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.ref_type = 'oms_fulfillment'
         and il.ref_id = v_fulfillment_id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        movement_at,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_order.company_id,
        coalesce(v_reservation.warehouse_id, public.erp_oms_channel_default_warehouse(v_order.channel_account_id)),
        v_line.variant_id,
        0,
        greatest(v_line.quantity, 0)::int,
        'oms_fulfillment',
        'OMS fulfillment',
        'oms_fulfillment',
        v_fulfillment_id,
        v_line.id,
        now(),
        now(),
        coalesce(v_actor, v_order.created_by),
        now(),
        coalesce(v_actor, v_order.updated_by)
      );
      v_ledger_inserted := v_ledger_inserted + 1;
    end if;

    update public.erp_oms_order_lines
       set status = 'fulfilled'
     where id = v_line.id;
  end loop;

  update public.erp_oms_orders
     set fulfillment_status = 'fulfilled',
         status = 'fulfilled',
         updated_at = now(),
         updated_by = coalesce(v_actor, v_order.updated_by)
   where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'fulfillment_id', v_fulfillment_id,
    'ledger_inserted', v_ledger_inserted,
    'reservations_closed', v_reservations_closed
  );
end;
$$;

revoke all on function public.erp_oms_fulfill_order(uuid, jsonb) from public;
revoke all on function public.erp_oms_fulfill_order(uuid, jsonb) from authenticated;
grant execute on function public.erp_oms_fulfill_order(uuid, jsonb) to authenticated;
grant execute on function public.erp_oms_fulfill_order(uuid, jsonb) to service_role;

create or replace function public.erp_oms_refund_order(
  p_oms_order_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_refund_id uuid;
  v_external_id bigint;
  v_existing_refund uuid;
  v_ledger_inserted int := 0;
  v_reservation_reopened int := 0;
  v_reservation public.erp_stock_reservations%rowtype;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_oms_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_oms_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_external_id := nullif(p_payload->>'id', '')::bigint;

  if v_external_id is not null then
    select id
      into v_existing_refund
      from public.erp_oms_refunds
     where company_id = v_order.company_id
       and source = 'shopify'
       and external_refund_id = v_external_id
     limit 1;
  end if;

  if v_existing_refund is null then
    insert into public.erp_oms_refunds (
      company_id,
      order_id,
      source,
      external_refund_id,
      status,
      refunded_at,
      raw_refund,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      'shopify',
      v_external_id,
      'refunded',
      coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now()),
      coalesce(p_payload, '{}'::jsonb),
      now(),
      coalesce(v_actor, v_order.created_by),
      now(),
      coalesce(v_actor, v_order.updated_by)
    )
    returning id into v_refund_id;
  else
    v_refund_id := v_existing_refund;
  end if;

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    select *
      into v_reservation
      from public.erp_stock_reservations
     where company_id = v_order.company_id
       and source_type = 'oms_order_line'
       and source_ref = v_line.id::text
     limit 1;

    if v_reservation.id is not null and v_reservation.status = 'fulfilled' then
      update public.erp_stock_reservations
         set status = 'refunded'
       where id = v_reservation.id;
      v_reservation_reopened := v_reservation_reopened + 1;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.ref_type = 'oms_refund'
         and il.ref_id = v_refund_id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        movement_at,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_order.company_id,
        coalesce(v_reservation.warehouse_id, public.erp_oms_channel_default_warehouse(v_order.channel_account_id)),
        v_line.variant_id,
        greatest(v_line.quantity, 0)::int,
        0,
        'oms_refund',
        'OMS refund',
        'oms_refund',
        v_refund_id,
        v_line.id,
        now(),
        now(),
        coalesce(v_actor, v_order.created_by),
        now(),
        coalesce(v_actor, v_order.updated_by)
      );
      v_ledger_inserted := v_ledger_inserted + 1;
    end if;

    update public.erp_oms_order_lines
       set status = 'refunded'
     where id = v_line.id;
  end loop;

  update public.erp_oms_orders
     set status = 'refunded',
         updated_at = now(),
         updated_by = coalesce(v_actor, v_order.updated_by)
   where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'refund_id', v_refund_id,
    'ledger_inserted', v_ledger_inserted,
    'reservations_reopened', v_reservation_reopened
  );
end;
$$;

revoke all on function public.erp_oms_refund_order(uuid, jsonb) from public;
revoke all on function public.erp_oms_refund_order(uuid, jsonb) from authenticated;
grant execute on function public.erp_oms_refund_order(uuid, jsonb) to authenticated;
grant execute on function public.erp_oms_refund_order(uuid, jsonb) to service_role;
