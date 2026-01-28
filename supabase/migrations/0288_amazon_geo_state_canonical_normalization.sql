-- 0288_amazon_geo_state_canonical_normalization.sql
-- Canonical state normalization for Amazon geo analytics.

create table if not exists public.erp_geo_state_canonical (
  variant text primary key,
  canonical text not null
);

insert into public.erp_geo_state_canonical (variant, canonical) values
  ('TAMIL NADU', 'TAMIL NADU'),
  ('TAMILNADU', 'TAMIL NADU'),
  ('TN', 'TAMIL NADU'),
  ('MAHARASHTRA', 'MAHARASHTRA'),
  ('MH', 'MAHARASHTRA'),
  ('RAJASTHAN', 'RAJASTHAN'),
  ('RJ', 'RAJASTHAN'),
  ('DELHI', 'DELHI'),
  ('NEW DELHI', 'DELHI'),
  ('NCT OF DELHI', 'DELHI')
on conflict (variant) do update
  set canonical = excluded.canonical;

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
  with normalized as (
    select
      i.amazon_order_id,
      coalesce(nullif(upper(trim(i.ship_state)), ''), 'UNKNOWN') as raw_state,
      coalesce(nullif(initcap(lower(trim(i.ship_city))), ''), 'Unknown') as norm_city,
      coalesce(i.quantity, 0) as quantity,
      (coalesce(i.item_amount, 0) + coalesce(i.item_tax, 0) + coalesce(i.shipping_amount, 0)
        + coalesce(i.shipping_tax, 0) - coalesce(i.promo_discount, 0)) as sales
    from public.erp_amazon_order_items i
    where i.company_id = v_company_id
      and i.marketplace_id = v_marketplace_id
      and i.purchase_date::date >= v_from
      and i.purchase_date::date <= v_to
  ),
  mapped as (
    select
      n.amazon_order_id,
      coalesce(sc.canonical, n.raw_state) as canonical_state,
      n.norm_city,
      n.quantity,
      n.sales
    from normalized n
    left join public.erp_geo_state_canonical sc
      on sc.variant = n.raw_state
  )
  select
    case
      when v_geo_expr = 'city' then coalesce(mapped.norm_city, 'Unknown')
      else coalesce(mapped.canonical_state, 'UNKNOWN')
    end as geo,
    count(distinct mapped.amazon_order_id)::int as orders,
    sum(coalesce(mapped.quantity, 0))::int as units,
    sum(coalesce(mapped.sales, 0)) as sales
  from mapped
  group by
    case
      when v_geo_expr = 'city' then mapped.canonical_state
      else mapped.canonical_state
    end,
    case
      when v_geo_expr = 'city' then mapped.norm_city
      else null
    end,
    case
      when v_geo_expr = 'city' then mapped.norm_city
      else mapped.canonical_state
    end
  order by sales desc nulls last;
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text) to authenticated;

create or replace function public.erp_amazon_analytics_sales_by_geo_v2(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_level text default 'state',
  p_state text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  geo_key text,
  state text,
  city text,
  orders bigint,
  customers bigint,
  units numeric,
  gross numeric,
  gross_share_within_state numeric,
  rank_within_state int,
  rank_overall int
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
  v_state_key text := nullif(upper(trim(p_state)), '');
  v_state text := null;
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

  if v_state_key is not null then
    select sc.canonical
      into v_state
      from public.erp_geo_state_canonical sc
      where sc.variant = v_state_key
      limit 1;

    v_state := coalesce(v_state, v_state_key);
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with source as (
    select
      f.*,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN') as raw_state,
      coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'UNKNOWN') as norm_city
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  ),
  normalized(
    amazon_order_id,
    customer_key,
    canonical_state,
    norm_city,
    quantity,
    gross
  ) as (
    select
      s.amazon_order_id,
      case
        when s.buyer_email is not null and trim(s.buyer_email) <> '' then lower(trim(s.buyer_email))
        else coalesce(nullif(trim(s.ship_postal_code), ''), 'UNKNOWN')
          || '|' || s.norm_city
          || '|' || coalesce(sc.canonical, s.raw_state)
      end as customer_key,
      coalesce(sc.canonical, s.raw_state) as canonical_state,
      s.norm_city as norm_city,
      coalesce(s.quantity, 0) as quantity,
      (coalesce(s.item_amount, 0) + coalesce(s.shipping_amount, 0) + coalesce(s.gift_wrap_amount, 0)
        - coalesce(s.promo_discount, 0)) as gross
    from source s
    left join public.erp_geo_state_canonical sc
      on sc.variant = s.raw_state
    where v_state is null or coalesce(sc.canonical, s.raw_state) = v_state
  ),
  aggregated as (
    select
      case
        when v_level = 'city' then normalized.canonical_state || '|' || normalized.norm_city
        else normalized.canonical_state
      end as geo_key,
      normalized.canonical_state as state,
      case when v_level = 'city' then normalized.norm_city else null end as city,
      count(distinct normalized.amazon_order_id)::bigint as orders,
      count(distinct normalized.customer_key)::bigint as customers,
      sum(normalized.quantity)::numeric as units,
      sum(normalized.gross)::numeric as gross
    from normalized
    group by
      case
        when v_level = 'city' then normalized.canonical_state || '|' || normalized.norm_city
        else normalized.canonical_state
      end,
      normalized.canonical_state,
      case when v_level = 'city' then normalized.norm_city else null end
  ),
  ranked as (
    select
      aggregated.*,
      sum(aggregated.gross) over (partition by aggregated.state) as state_gross,
      dense_rank() over (partition by aggregated.state order by aggregated.gross desc)::int as rank_within_state,
      dense_rank() over (order by aggregated.gross desc)::int as rank_overall
    from aggregated
  )
  select
    ranked.geo_key::text as geo_key,
    ranked.state::text as state,
    case
      when v_level = 'city' then ranked.city::text
      else null::text
    end as city,
    ranked.orders::bigint as orders,
    ranked.customers::bigint as customers,
    ranked.units::numeric as units,
    ranked.gross::numeric as gross,
    case
      when v_level = 'city' then
        round((ranked.gross / nullif(ranked.state_gross, 0)) * 100, 2)::numeric
      else null::numeric
    end as gross_share_within_state,
    case
      when v_level = 'city' then ranked.rank_within_state::int
      else null::int
    end as rank_within_state,
    ranked.rank_overall::int as rank_overall
  from ranked
  order by ranked.orders desc nulls last, ranked.state, ranked.city
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo_v2(text, date, date, text, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo_v2(text, date, date, text, text, int, int) to authenticated;
