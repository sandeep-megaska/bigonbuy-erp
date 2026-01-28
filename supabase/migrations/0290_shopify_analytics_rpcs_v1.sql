-- 0290_shopify_analytics_rpcs_v1.sql
-- Shopify analytics RPCs (v1) + minimal facts table alignment

create table if not exists public.erp_shopify_order_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  channel_account_id uuid not null,
  order_id text not null,
  order_created_at timestamptz not null,
  currency text null,
  ship_state text null,
  ship_city text null,
  customer_key text null,
  gross_sales numeric not null default 0,
  discount_value numeric not null default 0,
  units int not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_shopify_order_facts'
      and column_name = 'order_created_at'
  ) then
    alter table public.erp_shopify_order_facts
      add column order_created_at timestamptz not null default now();
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_shopify_order_facts'
      and column_name = 'discount_value'
  ) then
    alter table public.erp_shopify_order_facts
      add column discount_value numeric not null default 0;
  end if;
end;
$$;

create unique index if not exists erp_shopify_order_facts_unique_order_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, order_id);

alter table public.erp_shopify_order_facts enable row level security;
alter table public.erp_shopify_order_facts force row level security;

do $$
begin
  drop policy if exists erp_shopify_order_facts_select on public.erp_shopify_order_facts;

  create policy erp_shopify_order_facts_select
    on public.erp_shopify_order_facts
    for select
    using (company_id = public.erp_current_company_id());
end;
$$;

create or replace function public.erp_shopify_analytics_overview_v1(
  p_channel_account_id uuid,
  p_from date,
  p_to date
) returns table (
  gross_sales numeric,
  confirmed_orders_value numeric,
  confirmed_orders_count bigint,
  cancellations_count bigint,
  returns_value numeric,
  returns_count bigint,
  discount_value numeric,
  net_sales_estimated numeric,
  avg_per_day numeric,
  days_count int,
  currency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_days int := (p_to - p_from + 1)::int;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    coalesce(sum(f.gross_sales), 0) as gross_sales,
    coalesce(sum(f.gross_sales), 0) as confirmed_orders_value,
    count(distinct f.order_id) as confirmed_orders_count,
    0::bigint as cancellations_count,
    0::numeric as returns_value,
    0::bigint as returns_count,
    coalesce(sum(f.discount_value), 0) as discount_value,
    coalesce(sum(f.gross_sales), 0) - coalesce(sum(f.discount_value), 0) as net_sales_estimated,
    case
      when v_days = 0 then null
      else (
        coalesce(sum(f.gross_sales), 0) - coalesce(sum(f.discount_value), 0)
      ) / nullif(v_days, 0)
    end as avg_per_day,
    v_days as days_count,
    coalesce(max(f.currency), 'INR') as currency
  from public.erp_shopify_order_facts f
  where f.company_id = v_company_id
    and f.channel_account_id = p_channel_account_id
    and f.order_created_at::date between p_from and p_to;
end;
$$;

revoke all on function public.erp_shopify_analytics_overview_v1(uuid, date, date) from public;
grant execute on function public.erp_shopify_analytics_overview_v1(uuid, date, date) to authenticated;

create or replace function public.erp_shopify_analytics_sales_by_sku_v1(
  p_channel_account_id uuid,
  p_from date,
  p_to date
) returns table (
  sku text,
  orders bigint,
  customers bigint,
  units bigint,
  gross numeric,
  rank_overall int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    null::text as sku,
    0::bigint as orders,
    0::bigint as customers,
    0::bigint as units,
    0::numeric as gross,
    0::int as rank_overall
  where false;
end;
$$;

revoke all on function public.erp_shopify_analytics_sales_by_sku_v1(uuid, date, date) from public;
grant execute on function public.erp_shopify_analytics_sales_by_sku_v1(uuid, date, date) to authenticated;

create or replace function public.erp_shopify_analytics_sales_by_geo_v1(
  p_channel_account_id uuid,
  p_from date,
  p_to date,
  p_level text default 'state',
  p_limit int default 100,
  p_offset int default 0
) returns table (
  state text,
  city text,
  orders bigint,
  customers bigint,
  units bigint,
  gross numeric,
  rank_overall int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_level text := lower(coalesce(p_level, 'state'));
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_level not in ('state', 'city') then
    raise exception 'level must be state or city';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      case
        when v_level = 'city' then upper(trim(f.ship_state))
        else upper(trim(f.ship_state))
      end as state,
      case
        when v_level = 'city' then initcap(lower(trim(f.ship_city)))
        else null
      end as city,
      f.order_id,
      coalesce(nullif(trim(f.customer_key), ''), f.order_id) as customer_key,
      coalesce(f.units, 0) as units,
      coalesce(f.gross_sales, 0) as gross
    from public.erp_shopify_order_facts f
    where f.company_id = v_company_id
      and f.channel_account_id = p_channel_account_id
      and f.order_created_at::date between p_from and p_to
  ),
  grouped as (
    select
      state,
      city,
      count(distinct order_id) as orders,
      count(distinct customer_key) as customers,
      sum(units) as units,
      sum(gross) as gross
    from scoped
    group by state, city
  )
  select
    state,
    city,
    orders,
    customers,
    units,
    gross,
    dense_rank() over (order by gross desc) as rank_overall
  from grouped
  order by gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_sales_by_geo_v1(uuid, date, date, text, int, int) from public;
grant execute on function public.erp_shopify_analytics_sales_by_geo_v1(uuid, date, date, text, int, int) to authenticated;

create or replace function public.erp_shopify_analytics_customers_v1(
  p_channel_account_id uuid,
  p_from date,
  p_to date,
  p_limit int default 100,
  p_offset int default 0
) returns table (
  customer_key text,
  orders bigint,
  units bigint,
  gross numeric,
  first_order_date date,
  last_order_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      coalesce(nullif(trim(f.customer_key), ''), 'unknown:' || f.order_id) as customer_key,
      f.order_id,
      coalesce(f.units, 0) as units,
      coalesce(f.gross_sales, 0) as gross,
      f.order_created_at::date as order_date
    from public.erp_shopify_order_facts f
    where f.company_id = v_company_id
      and f.channel_account_id = p_channel_account_id
      and f.order_created_at::date between p_from and p_to
  )
  select
    customer_key,
    count(distinct order_id) as orders,
    sum(units) as units,
    sum(gross) as gross,
    min(order_date) as first_order_date,
    max(order_date) as last_order_date
  from scoped
  group by customer_key
  order by gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_customers_v1(uuid, date, date, int, int) from public;
grant execute on function public.erp_shopify_analytics_customers_v1(uuid, date, date, int, int) to authenticated;
