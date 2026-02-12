begin;

create table if not exists public.erp_mkt_sku_demand_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id),
  week_start date not null,
  sku text not null,
  orders_30d int not null default 0,
  revenue_30d numeric not null default 0,
  orders_prev_30d int not null default 0,
  revenue_prev_30d numeric not null default 0,
  growth_rate numeric not null default 0,
  demand_score numeric not null default 0,
  decision text not null check (decision in ('SCALE', 'HOLD', 'REDUCE')),
  created_at timestamptz not null default now(),
  constraint erp_mkt_sku_demand_scores_company_week_sku_uniq unique (company_id, week_start, sku)
);

create index if not exists erp_mkt_sku_demand_scores_company_week_idx
  on public.erp_mkt_sku_demand_scores (company_id, week_start desc);
create index if not exists erp_mkt_sku_demand_scores_company_decision_idx
  on public.erp_mkt_sku_demand_scores (company_id, decision, demand_score desc);

create table if not exists public.erp_mkt_city_demand_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id),
  week_start date not null,
  city text not null,
  orders_30d int not null default 0,
  revenue_30d numeric not null default 0,
  orders_prev_30d int not null default 0,
  revenue_prev_30d numeric not null default 0,
  growth_rate numeric not null default 0,
  demand_score numeric not null default 0,
  decision text not null check (decision in ('EXPAND', 'HOLD', 'REDUCE')),
  created_at timestamptz not null default now(),
  constraint erp_mkt_city_demand_scores_company_week_city_uniq unique (company_id, week_start, city)
);

create index if not exists erp_mkt_city_demand_scores_company_week_idx
  on public.erp_mkt_city_demand_scores (company_id, week_start desc);
create index if not exists erp_mkt_city_demand_scores_company_decision_idx
  on public.erp_mkt_city_demand_scores (company_id, decision, demand_score desc);

alter table public.erp_mkt_sku_demand_scores enable row level security;
alter table public.erp_mkt_city_demand_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_sku_demand_scores'
      and policyname = 'erp_mkt_sku_demand_scores_select'
  ) then
    create policy erp_mkt_sku_demand_scores_select on public.erp_mkt_sku_demand_scores
      for select using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_sku_demand_scores'
      and policyname = 'erp_mkt_sku_demand_scores_write'
  ) then
    create policy erp_mkt_sku_demand_scores_write on public.erp_mkt_sku_demand_scores
      for all using (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      ) with check (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_city_demand_scores'
      and policyname = 'erp_mkt_city_demand_scores_select'
  ) then
    create policy erp_mkt_city_demand_scores_select on public.erp_mkt_city_demand_scores
      for select using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_city_demand_scores'
      and policyname = 'erp_mkt_city_demand_scores_write'
  ) then
    create policy erp_mkt_city_demand_scores_write on public.erp_mkt_city_demand_scores
      for all using (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      ) with check (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      );
  end if;
end;
$$;

create or replace view public.erp_mkt_sku_demand_latest_v1 as
select s.*
from public.erp_mkt_sku_demand_scores s
where s.company_id = public.erp_current_company_id()
  and s.week_start = (
    select max(ss.week_start)
    from public.erp_mkt_sku_demand_scores ss
    where ss.company_id = s.company_id
  );

create or replace view public.erp_mkt_city_demand_latest_v1 as
select c.*
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
        greatest((coalesce(l.price, 0) * coalesce(l.quantity, 0)) - coalesce(l.line_discount, 0), 0)::numeric as revenue
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
        greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
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
      coalesce(sum(revenue) filter (where period = 'previous'), 0)::numeric as revenue_prev_30d
    from sku_sales
    where period is not null
    group by sku
  ),
  sku_scored as (
    select
      a.sku,
      a.orders_30d,
      a.revenue_30d,
      a.orders_prev_30d,
      a.revenue_prev_30d,
      coalesce((a.revenue_30d - a.revenue_prev_30d) / nullif(a.revenue_prev_30d, 0), 0) as growth_rate,
      max(a.revenue_30d) over () as max_rev
    from sku_agg a
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
      end,
      now()
    from sku_scored s
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
      end,
      now()
    from city_scored s
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

revoke all on function public.erp_mkt_demand_steering_refresh_v1(date) from public;
grant execute on function public.erp_mkt_demand_steering_refresh_v1(date) to authenticated, service_role;

grant select on public.erp_mkt_sku_demand_latest_v1 to authenticated, service_role;
grant select on public.erp_mkt_city_demand_latest_v1 to authenticated, service_role;

-- Manual acceptance checks:
-- 1) Tables:
--    select to_regclass('public.erp_mkt_sku_demand_scores'), to_regclass('public.erp_mkt_city_demand_scores');
-- 2) Views:
--    select to_regclass('public.erp_mkt_sku_demand_latest_v1'), to_regclass('public.erp_mkt_city_demand_latest_v1');
-- 3) RPC:
--    select to_regprocedure('public.erp_mkt_demand_steering_refresh_v1(date)');
-- 4) Refresh run:
--    select public.erp_mkt_demand_steering_refresh_v1(null);
-- 5) Row count check:
--    select
--      (select count(*) from public.erp_mkt_sku_demand_latest_v1) as sku_rows,
--      (select count(*) from public.erp_mkt_city_demand_latest_v1) as city_rows;

commit;
