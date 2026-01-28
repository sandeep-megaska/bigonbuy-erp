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
  ),
  aggregated as (
    select
      case
        when v_level = 'city' then normalized.norm_state || '|' || normalized.norm_city
        else normalized.norm_state
      end as geo_key,
      normalized.norm_state as state,
      case when v_level = 'city' then normalized.norm_city else null end as city,
      count(distinct normalized.amazon_order_id)::int as orders,
      count(distinct normalized.customer_key)::int as customers,
      sum(normalized.quantity)::int as units,
      sum(normalized.gross) as gross
    from normalized
    group by
      case
        when v_level = 'city' then normalized.norm_state || '|' || normalized.norm_city
        else normalized.norm_state
      end,
      normalized.norm_state,
      case when v_level = 'city' then normalized.norm_city else null end
  )
  select
    aggregated.geo_key,
    aggregated.state,
    aggregated.city,
    aggregated.orders,
    aggregated.customers,
    aggregated.units,
    aggregated.gross
  from aggregated
  order by aggregated.orders desc nulls last, aggregated.state, aggregated.city
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) to authenticated;
