begin;

create materialized view if not exists public.erp_mkt_scaling_signals_campaign_mv as
with campaign_daily as (
  select
    i.company_id,
    i.insight_date as dt,
    i.meta_campaign_id as campaign_id,
    sum(coalesce(i.spend, 0))::numeric as spend,
    sum(coalesce(i.purchases, 0))::numeric as purchases
  from public.erp_mkt_meta_insights_daily i
  where i.meta_campaign_id is not null
  group by i.company_id, i.insight_date, i.meta_campaign_id
),
channel_daily as (
  select
    r.company_id,
    r.rev_date as dt,
    sum(case when r.channel = 'shopify' then coalesce(r.net_revenue, 0) else 0 end)::numeric as shopify_revenue,
    sum(case when r.channel = 'amazon' then coalesce(r.net_revenue, 0) else 0 end)::numeric as amazon_revenue
  from public.erp_mkt_channel_revenue_daily r
  group by r.company_id, r.rev_date
),
base as (
  select
    c.company_id,
    c.dt,
    c.campaign_id,
    c.spend,
    c.purchases,
    coalesce(ch.shopify_revenue, 0)::numeric as shopify_revenue,
    coalesce(ch.amazon_revenue, 0)::numeric as amazon_revenue,
    (coalesce(ch.shopify_revenue, 0) + coalesce(ch.amazon_revenue, 0))::numeric as total_revenue,
    ((coalesce(ch.shopify_revenue, 0) + coalesce(ch.amazon_revenue, 0)) / nullif(c.spend, 0))::numeric as blended_roas
  from campaign_daily c
  left join channel_daily ch
    on ch.company_id = c.company_id
   and ch.dt = c.dt
)
select
  b.company_id,
  b.dt,
  b.campaign_id,
  b.spend,
  b.purchases,
  b.shopify_revenue,
  b.amazon_revenue,
  b.total_revenue,
  b.blended_roas,
  avg(b.blended_roas) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  )::numeric as blended_roas_3d,
  avg(b.blended_roas) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 6 preceding and current row
  )::numeric as blended_roas_7d,
  sum(b.spend) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  )::numeric as spend_3d,
  sum(b.spend) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 6 preceding and current row
  )::numeric as spend_7d,
  sum(b.total_revenue) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  )::numeric as revenue_3d,
  sum(b.total_revenue) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 6 preceding and current row
  )::numeric as revenue_7d,
  sum(b.purchases) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  )::numeric as orders_3d,
  sum(b.purchases) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 6 preceding and current row
  )::numeric as orders_7d,
  count(*) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  )::integer as data_days_3d,
  (sum(b.spend) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  ) >= 1500::numeric) as has_min_spend_3d,
  (count(*) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 2 preceding and current row
  ) >= 3) as has_min_days,
  stddev_samp(b.blended_roas) over (
    partition by b.company_id, b.campaign_id
    order by b.dt
    rows between 6 preceding and current row
  )::numeric as roas_volatility_7d
from base b;

create unique index if not exists erp_mkt_scaling_signals_campaign_mv_company_dt_campaign_idx
  on public.erp_mkt_scaling_signals_campaign_mv(company_id, dt, campaign_id);

create index if not exists erp_mkt_scaling_signals_campaign_mv_company_dt_idx
  on public.erp_mkt_scaling_signals_campaign_mv(company_id, dt desc);

create table if not exists public.erp_mkt_scaling_recommendations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  dt date not null,
  campaign_id text not null,
  recommendation text not null,
  pct_change numeric not null,
  reason text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, dt, campaign_id)
);

create index if not exists erp_mkt_scaling_recommendations_company_dt_idx
  on public.erp_mkt_scaling_recommendations(company_id, dt desc);

create or replace function public.erp_mkt_scaling_recommendations_refresh_v1(
  p_from date default null,
  p_to date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_to date := coalesce(p_to, current_date);
  v_from date := coalesce(p_from, v_to - 14);
  v_target_roas numeric := 3.0;
  v_lower_roas numeric := 2.0;
  v_scale_up_pct numeric := 0.20;
  v_scale_down_pct numeric := 0.15;
  v_inserted integer := 0;
begin
  refresh materialized view public.erp_mkt_scaling_signals_campaign_mv;

  delete from public.erp_mkt_scaling_recommendations r
  where r.company_id = v_company_id
    and r.dt between v_from and v_to;

  with latest_signal_dt as (
    select
      s.company_id,
      s.campaign_id,
      max(s.dt) as dt
    from public.erp_mkt_scaling_signals_campaign_mv s
    where s.company_id = v_company_id
      and s.dt between v_from and v_to
    group by s.company_id, s.campaign_id
  ),
  signals as (
    select s.*
    from public.erp_mkt_scaling_signals_campaign_mv s
    join latest_signal_dt l
      on l.company_id = s.company_id
     and l.campaign_id = s.campaign_id
     and l.dt = s.dt
  )
  insert into public.erp_mkt_scaling_recommendations (
    company_id,
    dt,
    campaign_id,
    recommendation,
    pct_change,
    reason,
    context
  )
  select
    s.company_id,
    s.dt,
    s.campaign_id,
    case
      when coalesce(s.roas_volatility_7d, 0) > 1.0 then 'HOLD'
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) >= v_target_roas
        and coalesce(s.blended_roas_3d, 0) >= v_target_roas then 'SCALE_UP'
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) < v_lower_roas
        and coalesce(s.blended_roas_3d, 0) < v_lower_roas then 'SCALE_DOWN'
      else 'HOLD'
    end as recommendation,
    case
      when coalesce(s.roas_volatility_7d, 0) > 1.0 then 0::numeric
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) >= v_target_roas
        and coalesce(s.blended_roas_3d, 0) >= v_target_roas then v_scale_up_pct
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) < v_lower_roas
        and coalesce(s.blended_roas_3d, 0) < v_lower_roas then -v_scale_down_pct
      else 0::numeric
    end as pct_change,
    case
      when coalesce(s.roas_volatility_7d, 0) > 1.0 then 'high_volatility_hold'
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) >= v_target_roas
        and coalesce(s.blended_roas_3d, 0) >= v_target_roas then 'roas_strong_stable'
      when s.has_min_spend_3d
        and coalesce(s.blended_roas_7d, 0) < v_lower_roas
        and coalesce(s.blended_roas_3d, 0) < v_lower_roas then 'roas_weak_stable'
      else 'insufficient_signal_or_mixed'
    end as reason,
    jsonb_build_object(
      'blended_roas_3d', s.blended_roas_3d,
      'blended_roas_7d', s.blended_roas_7d,
      'spend_3d', s.spend_3d,
      'spend_7d', s.spend_7d,
      'revenue_7d', s.revenue_7d,
      'volatility_7d', s.roas_volatility_7d,
      'target_roas', v_target_roas
    ) as context
  from signals s;

  get diagnostics v_inserted = row_count;

  return json_build_object(
    'ok', true,
    'company_id', v_company_id,
    'from', v_from,
    'to', v_to,
    'recommendations_inserted', v_inserted
  );
end;
$$;

grant execute on function public.erp_mkt_scaling_recommendations_refresh_v1(date, date)
  to authenticated, service_role;

grant select on public.erp_mkt_scaling_signals_campaign_mv to authenticated, service_role;
grant select, insert, delete on public.erp_mkt_scaling_recommendations to authenticated, service_role;

commit;

-- Acceptance checks (manual)
-- refresh materialized view public.erp_mkt_scaling_signals_campaign_mv;
-- select * from public.erp_mkt_scaling_signals_campaign_mv
--   where company_id = public.erp_current_company_id()
--   order by dt desc, spend desc
--   limit 20;

-- select public.erp_mkt_scaling_recommendations_refresh_v1(current_date - 14, current_date);
-- select * from public.erp_mkt_scaling_recommendations
--   where company_id = public.erp_current_company_id()
--   order by dt desc, recommendation desc, pct_change desc
--   limit 50;
