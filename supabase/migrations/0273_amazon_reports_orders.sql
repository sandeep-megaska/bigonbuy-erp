-- 0273_amazon_reports_orders.sql
-- Amazon order reports ingestion + analytics scaffolding

create table if not exists public.erp_channel_report_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_key text not null,
  marketplace_id text not null,
  report_type text not null,
  status text not null default 'requested',
  report_id text null,
  report_document_id text null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz null,
  row_count int null,
  error text null,
  report_request jsonb not null default '{}'::jsonb,
  report_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

create index if not exists erp_channel_report_runs_company_channel_marketplace_idx
  on public.erp_channel_report_runs (company_id, channel_key, marketplace_id, requested_at desc);

drop trigger if exists erp_channel_report_runs_set_updated on public.erp_channel_report_runs;
create trigger erp_channel_report_runs_set_updated
before update on public.erp_channel_report_runs
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_channel_report_runs enable row level security;
alter table public.erp_channel_report_runs force row level security;

do $$
begin
  drop policy if exists erp_channel_report_runs_select on public.erp_channel_report_runs;
  drop policy if exists erp_channel_report_runs_write on public.erp_channel_report_runs;

  create policy erp_channel_report_runs_select
    on public.erp_channel_report_runs
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

  create policy erp_channel_report_runs_write
    on public.erp_channel_report_runs
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

alter table public.erp_amazon_orders
  add column if not exists ship_state text null,
  add column if not exists ship_city text null,
  add column if not exists ship_postal_code text null,
  add column if not exists source_run_id uuid null references public.erp_channel_report_runs (id);

alter table public.erp_amazon_order_items
  add column if not exists order_item_key text,
  add column if not exists external_sku text null,
  add column if not exists fnsku text null,
  add column if not exists purchase_date timestamptz null,
  add column if not exists order_status text null,
  add column if not exists quantity int not null default 0,
  add column if not exists item_amount numeric not null default 0,
  add column if not exists shipping_amount numeric not null default 0,
  add column if not exists shipping_tax numeric not null default 0,
  add column if not exists promo_discount numeric not null default 0,
  add column if not exists ship_state text null,
  add column if not exists ship_city text null,
  add column if not exists ship_postal_code text null,
  add column if not exists buyer_email text null,
  add column if not exists mapped_variant_id uuid null references public.erp_variants (id) on delete restrict,
  add column if not exists erp_sku text null,
  add column if not exists style_code text null,
  add column if not exists size text null,
  add column if not exists color text null,
  add column if not exists source_run_id uuid null references public.erp_channel_report_runs (id);

update public.erp_amazon_order_items
  set order_item_key = order_item_id
  where order_item_key is null;

update public.erp_amazon_order_items
  set external_sku = seller_sku
  where external_sku is null and seller_sku is not null;

alter table public.erp_amazon_order_items
  alter column order_item_key set not null;

alter table public.erp_amazon_order_items
  add constraint erp_amazon_order_items_unique_order_item_key
  unique (company_id, marketplace_id, amazon_order_id, order_item_key);

create index if not exists erp_amazon_order_items_company_marketplace_purchase_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, purchase_date desc);

create index if not exists erp_amazon_order_items_company_marketplace_variant_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, mapped_variant_id);

create index if not exists erp_amazon_order_items_company_marketplace_ship_state_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, ship_state);

create index if not exists erp_amazon_order_items_company_marketplace_buyer_email_idx
  on public.erp_amazon_order_items (company_id, marketplace_id, buyer_email);

create table if not exists public.erp_amazon_returns_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  marketplace_id text not null,
  amazon_order_id text null,
  order_item_key text null,
  return_date timestamptz null,
  return_reason text null,
  refund_amount numeric null,
  currency text null,
  source_run_id uuid null references public.erp_channel_report_runs (id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

create index if not exists erp_amazon_returns_items_company_marketplace_date_idx
  on public.erp_amazon_returns_items (company_id, marketplace_id, return_date desc);

drop trigger if exists erp_amazon_returns_items_set_updated on public.erp_amazon_returns_items;
create trigger erp_amazon_returns_items_set_updated
before update on public.erp_amazon_returns_items
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_amazon_returns_items enable row level security;
alter table public.erp_amazon_returns_items force row level security;

do $$
begin
  drop policy if exists erp_amazon_returns_items_select on public.erp_amazon_returns_items;
  drop policy if exists erp_amazon_returns_items_write on public.erp_amazon_returns_items;

  create policy erp_amazon_returns_items_select
    on public.erp_amazon_returns_items
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

  create policy erp_amazon_returns_items_write
    on public.erp_amazon_returns_items
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

drop function if exists public.erp_amazon_orders_list(text, text, date, date, text, int, int);

create or replace function public.erp_amazon_orders_list(
  p_marketplace_id text,
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_q text default null,
  p_limit int default 100,
  p_offset int default 0
) returns table (
  order_id text,
  status text,
  purchase_date timestamptz,
  buyer_email text,
  order_total numeric,
  items int,
  ship_state text,
  ship_city text
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
    o.amazon_order_id as order_id,
    o.order_status as status,
    o.purchase_date,
    o.buyer_email,
    o.order_total,
    (
      select count(*)::int
      from public.erp_amazon_order_items i
      where i.company_id = o.company_id
        and i.marketplace_id = o.marketplace_id
        and i.amazon_order_id = o.amazon_order_id
    ) as items,
    o.ship_state,
    o.ship_city
  from public.erp_amazon_orders o
  where o.company_id = v_company_id
    and o.marketplace_id = v_marketplace_id
    and (p_status is null or o.order_status = p_status)
    and (p_from is null or o.purchase_date::date >= p_from)
    and (p_to is null or o.purchase_date::date <= p_to)
    and (
      v_q is null
      or o.amazon_order_id ilike '%' || v_q || '%'
      or coalesce(o.buyer_email, '') ilike '%' || v_q || '%'
      or exists (
        select 1
        from public.erp_amazon_order_items i
        where i.company_id = o.company_id
          and i.marketplace_id = o.marketplace_id
          and i.amazon_order_id = o.amazon_order_id
          and (
            coalesce(i.external_sku, '') ilike '%' || v_q || '%'
            or coalesce(i.erp_sku, '') ilike '%' || v_q || '%'
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

revoke all on function public.erp_amazon_orders_list(text, date, date, text, text, int, int) from public;

grant execute on function public.erp_amazon_orders_list(text, date, date, text, text, int, int) to authenticated;

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

create or replace function public.erp_amazon_analytics_sales_by_sku(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_grain text default 'day'
) returns table (
  period date,
  sku text,
  asin text,
  title text,
  units int,
  sales numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_from date := p_from;
  v_to date := p_to;
  v_trunc text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('day', 'week') then
    raise exception 'grain must be day or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'day' end;

  perform public.erp_require_inventory_reader();

  return query
  select
    date_trunc(v_trunc, i.purchase_date)::date as period,
    coalesce(i.erp_sku, i.external_sku) as sku,
    max(i.asin) as asin,
    max(i.title) as title,
    sum(coalesce(i.quantity, 0))::int as units,
    sum(coalesce(i.item_amount, 0) + coalesce(i.item_tax, 0) + coalesce(i.shipping_amount, 0)
        + coalesce(i.shipping_tax, 0) - coalesce(i.promo_discount, 0)) as sales
  from public.erp_amazon_order_items i
  where i.company_id = v_company_id
    and i.marketplace_id = v_marketplace_id
    and i.purchase_date::date >= v_from
    and i.purchase_date::date <= v_to
  group by date_trunc(v_trunc, i.purchase_date)::date, coalesce(i.erp_sku, i.external_sku)
  order by period desc, units desc nulls last;
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_sku(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_sales_by_sku(text, date, date, text) to authenticated;

create or replace function public.erp_amazon_analytics_sales_by_geo(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_level text default 'state'
) returns table (
  geo text,
  orders int,
  units int,
  sales numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_level text := lower(coalesce(p_level, 'state'));
  v_from date := p_from;
  v_to date := p_to;
  v_geo_expr text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_level not in ('state', 'city') then
    raise exception 'level must be state or city';
  end if;

  v_geo_expr := case when v_level = 'city' then 'city' else 'state' end;

  perform public.erp_require_inventory_reader();

  return query
  select
    case
      when v_geo_expr = 'city' then coalesce(i.ship_city, 'Unknown')
      else coalesce(i.ship_state, 'Unknown')
    end as geo,
    count(distinct i.amazon_order_id)::int as orders,
    sum(coalesce(i.quantity, 0))::int as units,
    sum(coalesce(i.item_amount, 0) + coalesce(i.item_tax, 0) + coalesce(i.shipping_amount, 0)
        + coalesce(i.shipping_tax, 0) - coalesce(i.promo_discount, 0)) as sales
  from public.erp_amazon_order_items i
  where i.company_id = v_company_id
    and i.marketplace_id = v_marketplace_id
    and i.purchase_date::date >= v_from
    and i.purchase_date::date <= v_to
  group by geo
  order by sales desc nulls last;
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text) to authenticated;

create or replace function public.erp_amazon_analytics_customer_cohorts(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_cohort_grain text default 'month'
) returns table (
  cohort_period date,
  customers int,
  repeat_customers int,
  repeat_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_cohort_grain, 'month'));
  v_trunc text;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('month', 'week') then
    raise exception 'cohort grain must be month or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'month' end;

  perform public.erp_require_inventory_reader();

  return query
  with buyer_orders as (
    select
      buyer_email,
      min(purchase_date)::date as first_purchase_date,
      count(distinct amazon_order_id) as order_count
    from public.erp_amazon_order_items
    where company_id = v_company_id
      and marketplace_id = v_marketplace_id
      and buyer_email is not null
      and purchase_date::date >= v_from
      and purchase_date::date <= v_to
    group by buyer_email
  )
  select
    date_trunc(v_trunc, first_purchase_date)::date as cohort_period,
    count(*)::int as customers,
    sum(case when order_count > 1 then 1 else 0 end)::int as repeat_customers,
    case
      when count(*) = 0 then 0
      else round(sum(case when order_count > 1 then 1 else 0 end)::numeric / count(*)::numeric, 4)
    end as repeat_rate
  from buyer_orders
  group by cohort_period
  order by cohort_period;
end;
$$;

revoke all on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) to authenticated;

create or replace function public.erp_channel_report_runs_list(
  p_channel_key text,
  p_marketplace_id text,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id uuid,
  status text,
  requested_at timestamptz,
  completed_at timestamptz,
  row_count int,
  report_type text,
  report_id text,
  report_document_id text,
  error text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_key text := nullif(trim(p_channel_key), '');
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_key is null or v_marketplace_id is null then
    raise exception 'channel_key and marketplace_id are required';
  end if;

  perform public.erp_require_inventory_reader();

  return query
  select
    r.id,
    r.status,
    r.requested_at,
    r.completed_at,
    r.row_count,
    r.report_type,
    r.report_id,
    r.report_document_id,
    r.error
  from public.erp_channel_report_runs r
  where r.company_id = v_company_id
    and r.channel_key = v_channel_key
    and r.marketplace_id = v_marketplace_id
  order by r.requested_at desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_channel_report_runs_list(text, text, int, int) from public;

grant execute on function public.erp_channel_report_runs_list(text, text, int, int) to authenticated;
