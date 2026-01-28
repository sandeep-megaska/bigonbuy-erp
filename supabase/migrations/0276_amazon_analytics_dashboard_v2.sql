-- 0276_amazon_analytics_dashboard_v2.sql
-- Amazon analytics dashboard v2 RPCs + geo normalization

create or replace function public.erp_amazon_analytics_overview_kpis(
  p_marketplace_id text,
  p_from date,
  p_to date
) returns table (
  gross numeric,
  net numeric,
  units int,
  orders int,
  customers_known int,
  customers_estimated int,
  repeat_rate_known numeric,
  repeat_rate_estimated numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
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

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      f.amazon_order_id,
      coalesce(f.quantity, 0) as quantity,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0) - coalesce(f.item_tax, 0) - coalesce(f.shipping_tax, 0)) as net,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        else null
      end as customer_email,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> ''
          then 'postal:' || trim(f.ship_postal_code)
        when f.ship_state is not null and trim(f.ship_state) <> ''
          then 'state:' || upper(trim(f.ship_state))
        else 'order:' || f.amazon_order_id
      end as customer_key
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  ),
  known_repeats as (
    select s.customer_email
    from scoped s
    where s.customer_email is not null
    group by s.customer_email
    having count(distinct s.amazon_order_id) > 1
  ),
  estimated_repeats as (
    select s.customer_key
    from scoped s
    group by s.customer_key
    having count(distinct s.amazon_order_id) > 1
  )
  select
    coalesce(sum(s.gross), 0) as gross,
    coalesce(sum(s.net), 0) as net,
    coalesce(sum(s.quantity), 0)::int as units,
    count(distinct s.amazon_order_id)::int as orders,
    count(distinct s.customer_email)::int as customers_known,
    count(distinct s.customer_key)::int as customers_estimated,
    case
      when count(distinct s.customer_email) = 0 then 0
      else (select count(*) from known_repeats)::numeric / count(distinct s.customer_email)
    end as repeat_rate_known,
    case
      when count(distinct s.customer_key) = 0 then 0
      else (select count(*) from estimated_repeats)::numeric / count(distinct s.customer_key)
    end as repeat_rate_estimated
  from scoped s;
end;
$$;

revoke all on function public.erp_amazon_analytics_overview_kpis(text, date, date) from public;

grant execute on function public.erp_amazon_analytics_overview_kpis(text, date, date) to authenticated;

create or replace function public.erp_amazon_analytics_sku_summary(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_sort text default 'units_desc',
  p_q text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  mapped_variant_id uuid,
  erp_sku text,
  style_code text,
  size text,
  color text,
  orders int,
  customers int,
  units int,
  gross numeric,
  net numeric,
  asp numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_from date := p_from;
  v_to date := p_to;
  v_sort text := lower(coalesce(p_sort, 'units_desc'));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
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

  if v_sort not in ('units_desc', 'net_desc', 'units_asc', 'net_asc') then
    raise exception 'sort must be units_desc, net_desc, units_asc, or net_asc';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with summary as (
    select
      f.mapped_variant_id,
      max(f.erp_sku) as erp_sku,
      max(f.style_code) as style_code,
      max(f.size) as size,
      max(f.color) as color,
      count(distinct f.amazon_order_id)::int as orders,
      count(distinct case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> ''
          then 'postal:' || trim(f.ship_postal_code)
        when f.ship_state is not null and trim(f.ship_state) <> ''
          then 'state:' || upper(trim(f.ship_state))
        else 'order:' || f.amazon_order_id
      end)::int as customers,
      sum(coalesce(f.quantity, 0))::int as units,
      sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
          - coalesce(f.promo_discount, 0)) as gross,
      sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
          - coalesce(f.promo_discount, 0) - coalesce(f.item_tax, 0) - coalesce(f.shipping_tax, 0)) as net
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
      and (
        v_q is null
        or coalesce(f.erp_sku, '') ilike ('%' || v_q || '%')
        or coalesce(f.style_code, '') ilike ('%' || v_q || '%')
        or coalesce(f.external_sku, '') ilike ('%' || v_q || '%')
      )
    group by f.mapped_variant_id
  )
  select
    s.mapped_variant_id,
    s.erp_sku,
    s.style_code,
    s.size,
    s.color,
    s.orders,
    s.customers,
    s.units,
    s.gross,
    s.net,
    case when s.units = 0 then 0 else s.net / s.units end as asp
  from summary s
  order by
    case when v_sort = 'units_desc' then s.units end desc nulls last,
    case when v_sort = 'net_desc' then s.net end desc nulls last,
    case when v_sort = 'units_asc' then s.units end asc nulls last,
    case when v_sort = 'net_asc' then s.net end asc nulls last,
    s.net desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sku_summary(text, date, date, text, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sku_summary(text, date, date, text, text, int, int) to authenticated;

create or replace function public.erp_amazon_analytics_sales_by_geo(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_level text default 'state',
  p_limit int default 200,
  p_offset int default 0
) returns table (
  geo_key text,
  state text,
  city text,
  orders int,
  customers int,
  units int,
  gross numeric
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

  perform public.erp_require_analytics_reader();

  return query
  with normalized as (
    select
      f.amazon_order_id,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        else f.amazon_order_id
      end as customer_key,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'Unknown') as state,
      coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'Unknown') as city,
      coalesce(f.quantity, 0) as quantity,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  )
  select
    case
      when v_level = 'city' then n.state || '|' || n.city
      else n.state
    end as geo_key,
    n.state,
    case when v_level = 'city' then n.city else null end as city,
    count(distinct n.amazon_order_id)::int as orders,
    count(distinct n.customer_key)::int as customers,
    sum(n.quantity)::int as units,
    sum(n.gross) as gross
  from normalized n
  group by geo_key, n.state, city
  order by gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_amazon_analytics_top_skus_by_geo(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_level text,
  p_state text default null,
  p_city text default null,
  p_limit int default 100
) returns table (
  mapped_variant_id uuid,
  erp_sku text,
  style_code text,
  size text,
  color text,
  orders int,
  customers int,
  units int,
  gross numeric,
  net numeric,
  asp numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_from date := p_from;
  v_to date := p_to;
  v_level text := lower(coalesce(p_level, 'state'));
  v_state text := nullif(trim(coalesce(p_state, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_state_norm text := null;
  v_city_norm text := null;
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

  if v_level = 'state' and v_state is null then
    raise exception 'state is required for state drilldown';
  end if;

  if v_level = 'city' and (v_state is null or v_city is null) then
    raise exception 'state and city are required for city drilldown';
  end if;

  v_state_norm := coalesce(nullif(upper(trim(v_state)), ''), 'Unknown');
  v_city_norm := coalesce(nullif(initcap(lower(trim(v_city))), ''), 'Unknown');

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      f.mapped_variant_id,
      f.erp_sku,
      f.style_code,
      f.size,
      f.color,
      f.amazon_order_id,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> ''
          then 'postal:' || trim(f.ship_postal_code)
        when f.ship_state is not null and trim(f.ship_state) <> ''
          then 'state:' || upper(trim(f.ship_state))
        else 'order:' || f.amazon_order_id
      end as customer_key,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'Unknown') as state,
      coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'Unknown') as city,
      coalesce(f.quantity, 0) as quantity,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0) - coalesce(f.item_tax, 0) - coalesce(f.shipping_tax, 0)) as net
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  ),
  filtered as (
    select *
    from scoped s
    where (
      v_level = 'state' and s.state = v_state_norm
    ) or (
      v_level = 'city' and s.state = v_state_norm and s.city = v_city_norm
    )
  ),
  summary as (
    select
      f.mapped_variant_id,
      max(f.erp_sku) as erp_sku,
      max(f.style_code) as style_code,
      max(f.size) as size,
      max(f.color) as color,
      count(distinct f.amazon_order_id)::int as orders,
      count(distinct f.customer_key)::int as customers,
      sum(f.quantity)::int as units,
      sum(f.gross) as gross,
      sum(f.net) as net
    from filtered f
    group by f.mapped_variant_id
  )
  select
    s.mapped_variant_id,
    s.erp_sku,
    s.style_code,
    s.size,
    s.color,
    s.orders,
    s.customers,
    s.units,
    s.gross,
    s.net,
    case when s.units = 0 then 0 else s.net / s.units end as asp
  from summary s
  order by s.units desc nulls last, s.net desc nulls last
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.erp_amazon_analytics_top_skus_by_geo(text, date, date, text, text, text, int) from public;

grant execute on function public.erp_amazon_analytics_top_skus_by_geo(text, date, date, text, text, text, int) to authenticated;

create or replace function public.erp_amazon_analytics_unmapped_skus(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_limit int default 200
) returns table (
  external_sku text,
  asin text,
  fnsku text,
  units int,
  net numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
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

  perform public.erp_require_analytics_reader();

  return query
  select
    f.external_sku,
    f.asin,
    f.fnsku,
    sum(coalesce(f.quantity, 0))::int as units,
    sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0) - coalesce(f.item_tax, 0) - coalesce(f.shipping_tax, 0)) as net
  from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
    and f.marketplace_id = v_marketplace_id
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to
    and f.mapped_variant_id is null
  group by f.external_sku, f.asin, f.fnsku
  order by net desc nulls last
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.erp_amazon_analytics_unmapped_skus(text, date, date, int) from public;

grant execute on function public.erp_amazon_analytics_unmapped_skus(text, date, date, int) to authenticated;
