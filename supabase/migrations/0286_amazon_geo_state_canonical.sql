-- 0286_amazon_geo_state_canonical.sql
-- Canonical state mappings for consistent geo analytics.

create table if not exists public.erp_geo_state_canonical_map (
  state_key text primary key,
  canonical_state text not null,
  is_active boolean not null default true
);

insert into public.erp_geo_state_canonical_map (state_key, canonical_state, is_active) values
  ('ANDAMAN AND NICOBAR ISLANDS', 'Andaman and Nicobar Islands', true),
  ('AN', 'Andaman and Nicobar Islands', true),
  ('ANDHRA PRADESH', 'Andhra Pradesh', true),
  ('ANDHRA PRADESH (NEW)', 'Andhra Pradesh', true),
  ('AP', 'Andhra Pradesh', true),
  ('ARUNACHAL PRADESH', 'Arunachal Pradesh', true),
  ('AR', 'Arunachal Pradesh', true),
  ('ASSAM', 'Assam', true),
  ('AS', 'Assam', true),
  ('BIHAR', 'Bihar', true),
  ('BR', 'Bihar', true),
  ('CHANDIGARH', 'Chandigarh', true),
  ('CH', 'Chandigarh', true),
  ('CHHATTISGARH', 'Chhattisgarh', true),
  ('CT', 'Chhattisgarh', true),
  ('CG', 'Chhattisgarh', true),
  ('DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('DADRA & NAGAR HAVELI AND DAMAN & DIU', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('DN', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('DD', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('DELHI', 'Delhi', true),
  ('NEW DELHI', 'Delhi', true),
  ('NCT OF DELHI', 'Delhi', true),
  ('DL', 'Delhi', true),
  ('GOA', 'Goa', true),
  ('GA', 'Goa', true),
  ('GUJARAT', 'Gujarat', true),
  ('GJ', 'Gujarat', true),
  ('HARYANA', 'Haryana', true),
  ('HR', 'Haryana', true),
  ('HIMACHAL PRADESH', 'Himachal Pradesh', true),
  ('HP', 'Himachal Pradesh', true),
  ('JAMMU AND KASHMIR', 'Jammu and Kashmir', true),
  ('JAMMU & KASHMIR', 'Jammu and Kashmir', true),
  ('JK', 'Jammu and Kashmir', true),
  ('JHARKHAND', 'Jharkhand', true),
  ('JH', 'Jharkhand', true),
  ('KARNATAKA', 'Karnataka', true),
  ('KA', 'Karnataka', true),
  ('KERALA', 'Kerala', true),
  ('KL', 'Kerala', true),
  ('LADAKH', 'Ladakh', true),
  ('LA', 'Ladakh', true),
  ('LAKSHADWEEP', 'Lakshadweep', true),
  ('LD', 'Lakshadweep', true),
  ('MADHYA PRADESH', 'Madhya Pradesh', true),
  ('MP', 'Madhya Pradesh', true),
  ('MAHARASHTRA', 'Maharashtra', true),
  ('MH', 'Maharashtra', true),
  ('MANIPUR', 'Manipur', true),
  ('MN', 'Manipur', true),
  ('MEGHALAYA', 'Meghalaya', true),
  ('ML', 'Meghalaya', true),
  ('MIZORAM', 'Mizoram', true),
  ('MZ', 'Mizoram', true),
  ('NAGALAND', 'Nagaland', true),
  ('NL', 'Nagaland', true),
  ('ODISHA', 'Odisha', true),
  ('ORISSA', 'Odisha', true),
  ('OD', 'Odisha', true),
  ('PUDUCHERRY', 'Puducherry', true),
  ('PONDICHERRY', 'Puducherry', true),
  ('PY', 'Puducherry', true),
  ('PUNJAB', 'Punjab', true),
  ('PB', 'Punjab', true),
  ('RAJASTHAN', 'Rajasthan', true),
  ('RJ', 'Rajasthan', true),
  ('SIKKIM', 'Sikkim', true),
  ('SK', 'Sikkim', true),
  ('TAMIL NADU', 'Tamil Nadu', true),
  ('TN', 'Tamil Nadu', true),
  ('TELANGANA', 'Telangana', true),
  ('TS', 'Telangana', true),
  ('TG', 'Telangana', true),
  ('TRIPURA', 'Tripura', true),
  ('TR', 'Tripura', true),
  ('UTTAR PRADESH', 'Uttar Pradesh', true),
  ('UP', 'Uttar Pradesh', true),
  ('UTTARAKHAND', 'Uttarakhand', true),
  ('UTTARANCHAL', 'Uttarakhand', true),
  ('UK', 'Uttarakhand', true),
  ('WEST BENGAL', 'West Bengal', true),
  ('WB', 'West Bengal', true)
on conflict (state_key) do update
  set canonical_state = excluded.canonical_state,
      is_active = excluded.is_active;

create index if not exists erp_geo_state_canonical_map_canonical_idx
  on public.erp_geo_state_canonical_map (canonical_state);

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
      coalesce(nullif(upper(trim(i.ship_state)), ''), 'UNKNOWN') as state_key,
      coalesce(i.ship_city, 'Unknown') as norm_city,
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
      coalesce(m.canonical_state, n.state_key) as norm_state,
      n.norm_city,
      n.quantity,
      n.sales
    from normalized n
    left join public.erp_geo_state_canonical_map m
      on m.state_key = n.state_key
      and m.is_active
  )
  select
    case
      when v_geo_expr = 'city' then coalesce(mapped.norm_city, 'Unknown')
      else coalesce(mapped.norm_state, 'UNKNOWN')
    end as geo,
    count(distinct mapped.amazon_order_id)::int as orders,
    sum(coalesce(mapped.quantity, 0))::int as units,
    sum(coalesce(mapped.sales, 0)) as sales
  from mapped
  group by geo
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
    select m.canonical_state
      into v_state
      from public.erp_geo_state_canonical_map m
      where m.state_key = v_state_key
        and m.is_active
      limit 1;

    v_state := coalesce(v_state, v_state_key);
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with source as (
    select
      f.*,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN') as state_key,
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
    norm_state,
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
          || '|' || coalesce(m.canonical_state, s.state_key)
      end as customer_key,
      coalesce(m.canonical_state, s.state_key) as norm_state,
      s.norm_city as norm_city,
      coalesce(s.quantity, 0) as quantity,
      (coalesce(s.item_amount, 0) + coalesce(s.shipping_amount, 0) + coalesce(s.gift_wrap_amount, 0)
        - coalesce(s.promo_discount, 0)) as gross
    from source s
    left join public.erp_geo_state_canonical_map m
      on m.state_key = s.state_key
      and m.is_active
    where v_state is null or coalesce(m.canonical_state, s.state_key) = v_state
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
