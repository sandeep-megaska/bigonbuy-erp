create or replace function public.erp_shopify_analytics_sales_by_geo_v1(
  p_channel_account_id uuid,
  p_from date,
  p_to date,
  p_level text default 'state',
  p_limit int default 20,
  p_offset int default 0,
  p_state text default null
)
returns table(
  state text,
  city text,
  orders bigint,
  customers bigint,
  units bigint,
  gross numeric,
  rank_overall int
)
language sql
security definer
set search_path = public
as $$
  select erp_require_analytics_reader();

  with base as (
    select
      upper(trim(f.ship_state)) as raw_state,
      initcap(lower(trim(f.ship_city))) as norm_city,
      f.order_id,
      f.customer_key,
      f.gross_sales,
      f.units
    from public.erp_shopify_order_facts f
    where f.company_id = erp_current_company_id()
      and f.channel_account_id = p_channel_account_id
      and f.order_created_at::date between p_from and p_to
      and (p_state is null or upper(trim(f.ship_state)) = upper(trim(p_state)))
  ),
  agg as (
    select
      case when p_level = 'city' then raw_state else raw_state end as v_state,
      case when p_level = 'city' then norm_city else null end as v_city,
      count(distinct order_id)::bigint as v_orders,
      count(distinct coalesce(customer_key, 'order:' || order_id))::bigint as v_customers,
      coalesce(sum(base.units), 0)::bigint as v_units,
      coalesce(sum(base.gross_sales), 0)::numeric as v_gross
    from base
    group by 1, 2
  ),
  ranked as (
    select
      v_state,
      v_city,
      v_orders,
      v_customers,
      v_units,
      v_gross,
      dense_rank() over (order by v_gross desc)::int as v_rank
    from agg
  )
  select
    v_state as state,
    v_city as city,
    v_orders as orders,
    v_customers as customers,
    v_units as units,
    v_gross as gross,
    v_rank as rank_overall
  from ranked
  order by rank_overall asc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.erp_shopify_analytics_sales_by_geo_v1(uuid, date, date, text, int, int, text) to authenticated;
