begin;

alter table public.erp_mkt_sku_demand_scores
  add column if not exists confidence_score numeric not null default 0,
  add column if not exists recommended_pct_change int not null default 0,
  add column if not exists guardrail_tags text[] not null default '{}'::text[];

alter table public.erp_mkt_city_demand_scores
  add column if not exists confidence_score numeric not null default 0,
  add column if not exists recommended_pct_change int not null default 0,
  add column if not exists guardrail_tags text[] not null default '{}'::text[];

create or replace view public.erp_mkt_sku_demand_latest_v1 as
select
  s.id,
  s.company_id,
  s.week_start,
  s.sku,
  s.orders_30d,
  s.revenue_30d,
  s.orders_prev_30d,
  s.revenue_prev_30d,
  s.growth_rate,
  s.demand_score,
  s.decision,
  s.confidence_score,
  s.recommended_pct_change,
  s.guardrail_tags,
  s.created_at
from public.erp_mkt_sku_demand_scores s
where s.company_id = public.erp_current_company_id()
  and s.week_start = (
    select max(ss.week_start)
    from public.erp_mkt_sku_demand_scores ss
    where ss.company_id = s.company_id
  );

create or replace view public.erp_mkt_city_demand_latest_v1 as
select
  c.id,
  c.company_id,
  c.week_start,
  c.city,
  c.orders_30d,
  c.revenue_30d,
  c.orders_prev_30d,
  c.revenue_prev_30d,
  c.growth_rate,
  c.demand_score,
  c.decision,
  c.confidence_score,
  c.recommended_pct_change,
  c.guardrail_tags,
  c.created_at
from public.erp_mkt_city_demand_scores c
where c.company_id = public.erp_current_company_id()
  and c.week_start = (
    select max(cc.week_start)
    from public.erp_mkt_city_demand_scores cc
    where cc.company_id = c.company_id
  );

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
        greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue,
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
    where a.company_id = v_company_id
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
    left join sku_inventory i
      on i.sku = a.sku
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
      company_id,
      week_start,
      sku,
      orders_30d,
      revenue_30d,
      orders_prev_30d,
      revenue_prev_30d,
      growth_rate,
      demand_score,
      decision,
      confidence_score,
      recommended_pct_change,
      guardrail_tags,
      created_at
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
          case
            when s.demand_score >= 0.90 then 20
            when s.demand_score >= 0.80 then 10
            else 5
          end
        when s.decision = 'REDUCE' then
          case
            when s.demand_score <= 0.15 then -20
            when s.demand_score <= 0.25 then -10
            else -5
          end
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
          case
            when s.decision = 'SCALE'
              and s.available_qty <= 10
            then 'LOW_INVENTORY'
          end
        ]::text[],
        null
      ) as guardrail_tags,
      now()
    from sku_decisions s
    returning 1
  )
  select count(*)::int into v_sku_rows from inserted;

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
        greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
      from public.erp_amazon_order_facts f
      where f.company_id = v_company_id
        and f.purchase_date::date between (v_week_start - 60) and (v_week_start - 1)
    ) src
    where src.city is not null
      and src.city <> ''
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
  inserted as (
    insert into public.erp_mkt_city_demand_scores (
      company_id,
      week_start,
      city,
      orders_30d,
      revenue_30d,
      orders_prev_30d,
      revenue_prev_30d,
      growth_rate,
      demand_score,
      decision,
      confidence_score,
      recommended_pct_change,
      guardrail_tags,
      created_at
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
          case
            when s.demand_score >= 0.90 then 20
            when s.demand_score >= 0.80 then 10
            else 5
          end
        when s.decision = 'REDUCE' then
          case
            when s.demand_score <= 0.15 then -20
            when s.demand_score <= 0.25 then -10
            else -5
          end
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
  select count(*)::int into v_city_rows from inserted;

  return jsonb_build_object(
    'week_start', v_week_start,
    'sku_rows', v_sku_rows,
    'city_rows', v_city_rows
  );
end;
$$;

-- Manual acceptance checks:
-- 1) Refresh run:
--    select public.erp_mkt_demand_steering_refresh_v1(null);
-- 2) Non-null enhancements in latest rows:
--    select count(*) from public.erp_mkt_sku_demand_latest_v1
--    where confidence_score is null or recommended_pct_change is null or guardrail_tags is null;
--    select count(*) from public.erp_mkt_city_demand_latest_v1
--    where confidence_score is null or recommended_pct_change is null or guardrail_tags is null;
-- 3) API:
--    GET /api/marketing/demand-steering/summary includes confidence_score, recommended_pct_change, guardrail_tags.
-- 4) CSV:
--    Export endpoints include confidence_score,recommended_pct_change,guardrail_tags columns.

commit;
