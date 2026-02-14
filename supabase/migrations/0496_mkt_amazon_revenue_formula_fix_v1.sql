begin;

-- =========================================================
-- 0495: Amazon Revenue Formula Fix (avoid double counting)
-- New canonical Amazon marketing revenue proxy:
--   amazon_net_revenue = greatest(coalesce(item_amount,0) - coalesce(promo_discount,0), 0)
-- Excludes shipping/tax for marketing analytics consistency.
-- =========================================================

-- -------------------------------------------------------------------
-- A) Amazon Alerts views (replace with corrected revenue calculation)
-- -------------------------------------------------------------------

create or replace view public.erp_mkt_amazon_kpi_daily_v1 as
with base as (
  select
    (case
      when pg_typeof(f.purchase_date)::text like '%timestamp%' then (f.purchase_date::timestamptz at time zone 'utc')::date
      else f.purchase_date::date
    end) as dt,
    f.amazon_order_id,
    greatest(
      coalesce(f.item_amount, 0) - coalesce(f.promo_discount, 0),
      0
    )::numeric as revenue
  from public.erp_amazon_order_facts f
  where f.company_id = public.erp_current_company_id()
    and f.amazon_order_id is not null
)
select
  public.erp_current_company_id() as company_id,
  dt,
  count(distinct amazon_order_id)::int as orders_count,
  coalesce(sum(revenue), 0)::numeric as revenue
from base
group by dt;

-- rolling view: DROP + CREATE to avoid type-change errors
-- Drop dependents first
drop view if exists public.erp_mkt_amazon_asin_dips_7d_v1;

-- Now safe to drop rolling
drop view if exists public.erp_mkt_amazon_kpi_rolling_7d_v1;

drop view if exists public.erp_mkt_amazon_kpi_rolling_7d_v1;

create view public.erp_mkt_amazon_kpi_rolling_7d_v1 as
with daily as (
  select * from public.erp_mkt_amazon_kpi_daily_v1
),
bounds as (
  select max(dt) as last_dt from daily
),
win as (
  select
    (b.last_dt - 6) as last7_from,
    b.last_dt as last7_to,
    (b.last_dt - 13) as prev7_from,
    (b.last_dt - 7) as prev7_to
  from bounds b
),
agg as (
  select
    w.last7_from, w.last7_to, w.prev7_from, w.prev7_to,

    -- IMPORTANT: keep orders as int to match existing view signature
    coalesce(sum(d.orders_count) filter (where d.dt between w.last7_from and w.last7_to), 0)::int as last7_orders,
    coalesce(sum(d.orders_count) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::int as prev7_orders,

    -- revenue remains numeric
    coalesce(sum(d.revenue) filter (where d.dt between w.last7_from and w.last7_to), 0)::numeric as last7_revenue,
    coalesce(sum(d.revenue) filter (where d.dt between w.prev7_from and w.prev7_to), 0)::numeric as prev7_revenue
  from win w
  left join daily d on true
  group by w.last7_from, w.last7_to, w.prev7_from, w.prev7_to
)
select
  public.erp_current_company_id() as company_id,
  a.last7_from, a.last7_to, a.prev7_from, a.prev7_to,
  a.last7_orders,
  a.prev7_orders,
  (a.last7_orders - a.prev7_orders) as orders_delta,
  case
    when a.prev7_orders = 0 then null
    else (a.last7_orders - a.prev7_orders)::numeric / nullif(a.prev7_orders,0)
  end as orders_delta_pct,
  a.last7_revenue,
  a.prev7_revenue,
  (a.last7_revenue - a.prev7_revenue) as revenue_delta,
  case
    when a.prev7_revenue = 0 then null
    else (a.last7_revenue - a.prev7_revenue) / nullif(a.prev7_revenue,0)
  end as revenue_delta_pct
from agg a;

create or replace view public.erp_mkt_amazon_asin_dips_7d_v1 as
with w as (
  select * from public.erp_mkt_amazon_kpi_rolling_7d_v1
),
base as (
  select
    (case
      when pg_typeof(f.purchase_date)::text like '%timestamp%' then (f.purchase_date::timestamptz at time zone 'utc')::date
      else f.purchase_date::date
    end) as dt,
    nullif(trim(coalesce(f.asin, '')), '') as asin,
    nullif(trim(coalesce(f.erp_sku, f.external_sku, '')), '') as sku,
    f.amazon_order_id,
    greatest(
      coalesce(f.item_amount, 0) - coalesce(f.promo_discount, 0),
      0
    )::numeric as revenue
  from public.erp_amazon_order_facts f
  where f.company_id = public.erp_current_company_id()
    and f.amazon_order_id is not null
),
keyed as (
  select
    coalesce(asin, sku, 'unknown') as key_id,
    max(asin) as asin,
    max(sku) as sku,
    dt,
    amazon_order_id,
    revenue
  from base
  group by coalesce(asin, sku, 'unknown'), dt, amazon_order_id, revenue
),
agg as (
  select
    k.key_id,
    max(k.asin) as asin,
    max(k.sku) as sku,
    count(distinct k.amazon_order_id) filter (where k.dt between w.last7_from and w.last7_to)::numeric as last7_orders,
    count(distinct k.amazon_order_id) filter (where k.dt between w.prev7_from and w.prev7_to)::numeric as prev7_orders,
    coalesce(sum(k.revenue) filter (where k.dt between w.last7_from and w.last7_to), 0)::numeric as last7_revenue,
    coalesce(sum(k.revenue) filter (where k.dt between w.prev7_from and w.prev7_to), 0)::numeric as prev7_revenue
  from w
  join keyed k on true
  group by k.key_id
),
scored as (
  select
    public.erp_current_company_id() as company_id,
    (select last7_from from w) as last7_from,
    (select last7_to from w) as last7_to,
    (select prev7_from from w) as prev7_from,
    (select prev7_to from w) as prev7_to,
    a.key_id,
    a.asin,
    a.sku,
    a.last7_orders,
    a.prev7_orders,
    (a.last7_orders - a.prev7_orders) as orders_delta,
    case when a.prev7_orders = 0 then null else (a.last7_orders - a.prev7_orders) / nullif(a.prev7_orders,0) end as orders_delta_pct,
    a.last7_revenue,
    a.prev7_revenue,
    (a.last7_revenue - a.prev7_revenue) as revenue_delta,
    case when a.prev7_revenue = 0 then null else (a.last7_revenue - a.prev7_revenue) / nullif(a.prev7_revenue,0) end as revenue_delta_pct
  from agg a
)
select *
from scored
where prev7_orders >= 5
  and (orders_delta < 0 or revenue_delta < 0)
order by revenue_delta asc nulls last, orders_delta asc nulls last;

-- -------------------------------------------------------------------
-- B) Channel revenue refresh (Amazon net revenue formula fix)
-- NOTE: We only change the Amazon aggregation expression.
-- -------------------------------------------------------------------

create or replace function public.erp_mkt_channel_revenue_daily_refresh_v1(
  p_from date default null,
  p_to date default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_from date := coalesce(p_from, (current_date - 60));
  v_to date := coalesce(p_to, current_date);
begin
  if v_company_id is null then
    raise exception 'Company context is required';
  end if;

  -- Clear target window for shopify/amazon (derived facts are refreshable)
  delete from public.erp_mkt_channel_revenue_daily
  where company_id = v_company_id
    and rev_date between v_from and v_to
    and channel in ('shopify','amazon');

  -- Shopify aggregation (unchanged; keep existing logic if different in your repo)
  insert into public.erp_mkt_channel_revenue_daily (
    company_id, rev_date, channel, orders_count, units_count, net_revenue
  )
  select
    v_company_id,
    o.order_created_at::date as rev_date,
    'shopify'::text as channel,
    count(distinct o.shopify_order_id)::int as orders_count,
    coalesce(sum(coalesce(l.quantity,0)),0)::int as units_count,
    coalesce(sum(greatest((coalesce(l.price,0)*coalesce(l.quantity,0)) - coalesce(l.line_discount,0),0)),0)::numeric as net_revenue
  from public.erp_shopify_orders o
  left join public.erp_shopify_order_lines l
    on l.company_id = o.company_id and l.order_id = o.id
  where o.company_id = v_company_id
    and coalesce(o.is_cancelled,false) = false
    and o.order_created_at::date between v_from and v_to
  group by o.order_created_at::date
  on conflict (company_id, rev_date, channel) do update
    set orders_count = excluded.orders_count,
        units_count = excluded.units_count,
        net_revenue = excluded.net_revenue;

  -- Amazon aggregation (FIXED revenue formula)
  insert into public.erp_mkt_channel_revenue_daily (
    company_id, rev_date, channel, orders_count, units_count, net_revenue
  )
  select
    v_company_id,
    f.purchase_date::date as rev_date,
    'amazon'::text as channel,
    count(distinct f.amazon_order_id)::int as orders_count,
    count(*)::int as units_count,
    coalesce(sum(greatest(coalesce(f.item_amount,0) - coalesce(f.promo_discount,0),0)),0)::numeric as net_revenue
  from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
    and f.purchase_date::date between v_from and v_to
  group by f.purchase_date::date
  on conflict (company_id, rev_date, channel) do update
    set orders_count = excluded.orders_count,
        units_count = excluded.units_count,
        net_revenue = excluded.net_revenue;

end;
$$;

-- -------------------------------------------------------------------
-- C) Demand Steering refresh (Amazon net revenue formula fix)
-- NOTE: Only change amazon revenue expression in sku_sales + city_sales unions.
-- -------------------------------------------------------------------

create or replace function public.erp_mkt_demand_steering_refresh_v1(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_week_start date := coalesce(
    p_week_start,
    date_trunc('week', (now() at time zone 'utc')::date)::date
  );
  v_sku_rows int := 0;
  v_city_rows int := 0;
begin
  if v_company_id is null then
    raise exception 'Company context is required';
  end if;

  delete from public.erp_mkt_sku_demand_scores
  where company_id = v_company_id
    and week_start = v_week_start;

  delete from public.erp_mkt_city_demand_scores
  where company_id = v_company_id
    and week_start = v_week_start;

  with sku_sales as (
    select
      src.sku,
      src.order_ref,
      src.order_date,
      src.revenue,
      src.channel,
      case
        when src.order_date between (v_week_start - 30) and (v_week_start - 1) then 'current'
        when src.order_date between (v_week_start - 60) and (v_week_start - 31) then 'previous'
        else null
      end as period
    from (
      select
        coalesce(nullif(trim(l.sku), ''), nullif(trim(l.title), ''), 'unknown') as sku,
        concat('shopify:', o.shopify_order_id::text) as order_ref,
        o.order_created_at::date as order_date,
        greatest((coalesce(l.price, 0) * coalesce(l.quantity, 0)) - coalesce(l.line_discount, 0), 0)::numeric as revenue,
        'shopify'::text as channel
      from public.erp_shopify_orders o
      left join public.erp_shopify_order_lines l
        on l.company_id = o.company_id
       and l.order_id = o.id
      where o.company_id = v_company_id
        and coalesce(o.is_cancelled, false) = false
        and o.order_created_at::date between (v_week_start - 60) and (v_week_start - 1)

      union all

      select
        coalesce(nullif(trim(f.erp_sku), ''), nullif(trim(f.external_sku), ''), nullif(trim(f.asin), ''), 'unknown') as sku,
        concat('amazon:', f.marketplace_id, ':', f.amazon_order_id) as order_ref,
        f.purchase_date::date as order_date,
        greatest(coalesce(f.item_amount, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue,
        'amazon'::text as channel
      from public.erp_amazon_order_facts f
      where f.company_id = v_company_id
        and f.purchase_date::date between (v_week_start - 60) and (v_week_start - 1)
    ) src
  ),
  sku_agg as (
    select
      sku,
      count(distinct order_ref) filter (where period = 'current')::int as orders_30d,
      coalesce(sum(revenue) filter (where period = 'current'), 0)::numeric as revenue_30d,
      count(distinct order_ref) filter (where period = 'previous')::int as orders_prev_30d,
      coalesce(sum(revenue) filter (where period = 'previous'), 0)::numeric as revenue_prev_30d,
      coalesce(sum(revenue) filter (where period = 'current' and channel = 'amazon'), 0)::numeric as amazon_revenue_30d
    from sku_sales
    where period is not null
    group by sku
  ),
  sku_inventory as (
    select
      v.sku,
      sum(coalesce(a.available, 0))::numeric as available_qty
    from public.erp_inventory_available(null) a
    join public.erp_variants v
      on v.company_id = v_company_id
     and v.id = a.variant_id
    group by v.sku
  ),
  sku_scored as (
    select
      a.sku,
      a.orders_30d,
      a.revenue_30d,
      a.orders_prev_30d,
      a.revenue_prev_30d,
      coalesce((a.revenue_30d - a.revenue_prev_30d) / nullif(a.revenue_prev_30d, 0), 0) as growth_rate,
      max(a.revenue_30d) over () as max_rev,
      a.amazon_revenue_30d,
      coalesce(i.available_qty, 0)::numeric as available_qty
    from sku_agg a
    left join sku_inventory i on i.sku = a.sku
  ),
  sku_decisions as (
    select
      s.*,
      (
        (0.65 * case
          when coalesce(s.max_rev, 0) <= 0 then 0
          else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
        end)
        +
        (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
      ) as demand_score,
      case
        when (
          (0.65 * case
            when coalesce(s.max_rev, 0) <= 0 then 0
            else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
          end)
          +
          (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
        ) >= 0.70 then 'SCALE'
        when (
          (0.65 * case
            when coalesce(s.max_rev, 0) <= 0 then 0
            else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
          end)
          +
          (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
        ) <= 0.30 then 'REDUCE'
        else 'HOLD'
      end as decision,
      greatest(
        0::numeric,
        least(
          1::numeric,
          least(1::numeric, sqrt(greatest(s.orders_30d, 0)::numeric / 50))
          *
          (case
            when abs(s.growth_rate) >= 3 then 0.60
            when abs(s.growth_rate) >= 2 then 0.75
            when abs(s.growth_rate) >= 1 then 0.90
            else 1
          end)
        )
      ) as confidence_score
    from sku_scored s
  ),
  inserted as (
    insert into public.erp_mkt_sku_demand_scores (
      company_id, week_start, sku,
      orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d,
      growth_rate, demand_score, decision,
      confidence_score, recommended_pct_change, guardrail_tags, created_at
    )
    select
      v_company_id,
      v_week_start,
      s.sku,
      s.orders_30d,
      s.revenue_30d,
      s.orders_prev_30d,
      s.revenue_prev_30d,
      s.growth_rate,
      s.demand_score,
      s.decision,
      s.confidence_score,
      case
        when s.confidence_score < 0.40 then 0
        when s.decision = 'SCALE' then
          case when s.demand_score >= 0.90 then 20
               when s.demand_score >= 0.80 then 10
               else 5 end
        when s.decision = 'REDUCE' then
          case when s.demand_score <= 0.15 then -20
               when s.demand_score <= 0.25 then -10
               else -5 end
        else 0
      end as recommended_pct_change,
      array_remove(
        array[
          case when s.orders_30d < 10 then 'LOW_SAMPLE' end,
          case when s.confidence_score < 0.40 then 'LOW_CONFIDENCE' end,
          case when s.growth_rate >= 3 then 'NEW_SPIKE' end,
          case when s.growth_rate <= -0.5 and s.revenue_30d > 0 then 'DECLINING' end,
          case when s.revenue_30d = 0 and s.orders_30d > 0 then 'REVENUE_ANOMALY' end,
          case
            when s.decision = 'SCALE'
              and coalesce(s.amazon_revenue_30d / nullif(s.revenue_30d, 0), 0) >= 0.70
            then 'PROTECT_AMAZON'
          end,
          case when s.decision = 'SCALE' and s.available_qty <= 10 then 'LOW_INVENTORY' end
        ]::text[],
        null
      ) as guardrail_tags,
      now()
    from sku_decisions s
    returning 1
  )
  select count(*)::int into v_sku_rows from inserted;

  -- City side: only replace amazon revenue expression similarly
  with city_sales as (
    select
      src.city,
      src.order_ref,
      src.order_date,
      src.revenue,
      case
        when src.order_date between (v_week_start - 30) and (v_week_start - 1) then 'current'
        when src.order_date between (v_week_start - 60) and (v_week_start - 31) then 'previous'
        else null
      end as period
    from (
      select
        initcap(lower(trim(o.raw_order#>>'{shipping_address,city}'))) as city,
        concat('shopify:', o.shopify_order_id::text) as order_ref,
        o.order_created_at::date as order_date,
        coalesce(o.total_price, 0)::numeric as revenue
      from public.erp_shopify_orders o
      where o.company_id = v_company_id
        and coalesce(o.is_cancelled, false) = false
        and o.order_created_at::date between (v_week_start - 60) and (v_week_start - 1)

      union all

      select
        initcap(lower(trim(f.ship_city))) as city,
        concat('amazon:', f.marketplace_id, ':', f.amazon_order_id) as order_ref,
        f.purchase_date::date as order_date,
        greatest(coalesce(f.item_amount, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
      from public.erp_amazon_order_facts f
      where f.company_id = v_company_id
        and f.purchase_date::date between (v_week_start - 60) and (v_week_start - 1)
    ) src
    where src.city is not null and src.city <> ''
  ),
  city_agg as (
    select
      city,
      count(distinct order_ref) filter (where period = 'current')::int as orders_30d,
      coalesce(sum(revenue) filter (where period = 'current'), 0)::numeric as revenue_30d,
      count(distinct order_ref) filter (where period = 'previous')::int as orders_prev_30d,
      coalesce(sum(revenue) filter (where period = 'previous'), 0)::numeric as revenue_prev_30d
    from city_sales
    where period is not null
    group by city
  ),
  city_scored as (
    select
      a.city,
      a.orders_30d,
      a.revenue_30d,
      a.orders_prev_30d,
      a.revenue_prev_30d,
      coalesce((a.revenue_30d - a.revenue_prev_30d) / nullif(a.revenue_prev_30d, 0), 0) as growth_rate,
      max(a.revenue_30d) over () as max_rev
    from city_agg a
  ),
  city_decisions as (
    select
      s.*,
      (
        (0.65 * case
          when coalesce(s.max_rev, 0) <= 0 then 0
          else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
        end)
        +
        (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
      ) as demand_score,
      case
        when (
          (0.65 * case
            when coalesce(s.max_rev, 0) <= 0 then 0
            else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
          end)
          +
          (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
        ) >= 0.70 then 'EXPAND'
        when (
          (0.65 * case
            when coalesce(s.max_rev, 0) <= 0 then 0
            else least(1::numeric, ln(1 + s.revenue_30d) / nullif(ln(1 + s.max_rev), 0))
          end)
          +
          (0.35 * greatest(0::numeric, least(1::numeric, (s.growth_rate + 0.5) / 1.5)))
        ) <= 0.30 then 'REDUCE'
        else 'HOLD'
      end as decision,
      greatest(
        0::numeric,
        least(
          1::numeric,
          least(1::numeric, sqrt(greatest(s.orders_30d, 0)::numeric / 50))
          *
          (case
            when abs(s.growth_rate) >= 3 then 0.60
            when abs(s.growth_rate) >= 2 then 0.75
            when abs(s.growth_rate) >= 1 then 0.90
            else 1
          end)
        )
      ) as confidence_score
    from city_scored s
  ),
  inserted_city as (
    insert into public.erp_mkt_city_demand_scores (
      company_id, week_start, city,
      orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d,
      growth_rate, demand_score, decision,
      confidence_score, recommended_pct_change, guardrail_tags, created_at
    )
    select
      v_company_id,
      v_week_start,
      s.city,
      s.orders_30d,
      s.revenue_30d,
      s.orders_prev_30d,
      s.revenue_prev_30d,
      s.growth_rate,
      s.demand_score,
      s.decision,
      s.confidence_score,
      case
        when s.confidence_score < 0.40 then 0
        when s.decision = 'EXPAND' then
          case when s.demand_score >= 0.90 then 20
               when s.demand_score >= 0.80 then 10
               else 5 end
        when s.decision = 'REDUCE' then
          case when s.demand_score <= 0.15 then -20
               when s.demand_score <= 0.25 then -10
               else -5 end
        else 0
      end as recommended_pct_change,
      array_remove(
        array[
          case when s.orders_30d < 10 then 'LOW_SAMPLE' end,
          case when s.confidence_score < 0.40 then 'LOW_CONFIDENCE' end,
          case when s.growth_rate >= 3 then 'NEW_SPIKE' end,
          case when s.growth_rate <= -0.5 and s.revenue_30d > 0 then 'DECLINING' end,
          case when s.revenue_30d = 0 and s.orders_30d > 0 then 'REVENUE_ANOMALY' end
        ]::text[],
        null
      ) as guardrail_tags,
      now()
    from city_decisions s
    returning 1
  )
  select count(*)::int into v_city_rows from inserted_city;

  return jsonb_build_object('week_start', v_week_start, 'sku_rows', v_sku_rows, 'city_rows', v_city_rows);
end;
$$;

-- =========================================================
-- Acceptance checks (manual)
-- =========================================================
-- 1) Amazon Alerts daily:
--    select * from public.erp_mkt_amazon_kpi_daily_v1 order by dt desc limit 5;
-- 2) Rebuild channel facts + cockpit:
--    select public.erp_mkt_channel_revenue_daily_refresh_v1(current_date - 60, current_date);
--    select public.erp_growth_cockpit_snapshot_refresh_v1();
-- 3) Rebuild demand steering:
--    select public.erp_mkt_demand_steering_refresh_v1(null);

commit;
