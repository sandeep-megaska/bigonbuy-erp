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
    coalesce(sum(s.gross), 0)::numeric as gross,
    coalesce(sum(s.net), 0)::numeric as net,
    coalesce(sum(s.quantity), 0)::int as units,
    count(distinct s.amazon_order_id)::int as orders,
    count(distinct s.customer_email)::int as customers_known,
    count(distinct s.customer_key)::int as customers_estimated,
    case
      when count(distinct s.customer_email) = 0 then 0::numeric
      else (select count(*) from known_repeats)::numeric / count(distinct s.customer_email)
    end as repeat_rate_known,
    case
      when count(distinct s.customer_key) = 0 then 0::numeric
      else (select count(*) from estimated_repeats)::numeric / count(distinct s.customer_key)
    end as repeat_rate_estimated
  from scoped s;
end;
$$;

revoke all on function public.erp_amazon_analytics_overview_kpis(text, date, date) from public;

grant execute on function public.erp_amazon_analytics_overview_kpis(text, date, date) to authenticated;

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
  v_state text := nullif(upper(trim(p_state)), '');
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
  with normalized(
    amazon_order_id,
    customer_key,
    norm_state,
    norm_city,
    quantity,
    gross
  ) as (
    select
      f.amazon_order_id,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        else coalesce(nullif(trim(f.ship_postal_code), ''), 'UNKNOWN')
          || '|' || coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'UNKNOWN')
          || '|' || coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN')
      end as customer_key,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN') as norm_state,
      coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'UNKNOWN') as norm_city,
      coalesce(f.quantity, 0) as quantity,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
      and (v_state is null or coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN') = v_state)
  ),
  aggregated as (
    select
      case
        when v_level = 'city' then normalized.norm_state || '|' || normalized.norm_city
        else normalized.norm_state
      end as geo_key,
      normalized.norm_state as state,
      case when v_level = 'city' then normalized.norm_city else null end as city,
      count(distinct normalized.amazon_order_id)::bigint as orders,
      count(distinct normalized.customer_key)::bigint as customers,
      sum(normalized.quantity)::numeric as units,
      sum(normalized.gross)::numeric as gross
    from normalized
    group by
      case
        when v_level = 'city' then normalized.norm_state || '|' || normalized.norm_city
        else normalized.norm_state
      end,
      normalized.norm_state,
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
