-- 0486_mkt_daily_refresh_and_cron.sql
-- Marketing daily refresh + scheduler (KPI cards auto-population)

begin;

-- Ensure canonical uniqueness for idempotent upserts.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'erp_mkt_channel_revenue_daily'
      and c.contype = 'u'
      and c.conkey = array[
        (select attnum from pg_attribute where attrelid = t.oid and attname = 'company_id' and not attisdropped),
        (select attnum from pg_attribute where attrelid = t.oid and attname = 'rev_date' and not attisdropped),
        (select attnum from pg_attribute where attrelid = t.oid and attname = 'channel' and not attisdropped)
      ]::int2[]
  ) then
    alter table public.erp_mkt_channel_revenue_daily
      add constraint erp_mkt_channel_revenue_daily_company_date_channel_uniq
      unique (company_id, rev_date, channel);
  end if;
end;
$$;

create or replace function public.erp_mkt_channel_revenue_daily_refresh_v1(
  p_from date default null,
  p_to date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_from date := coalesce(p_from, current_date - 60);
  v_to date := coalesce(p_to, current_date);
begin
  if v_company_id is null then
    raise exception 'Company context is required';
  end if;

  if v_from > v_to then
    raise exception 'Invalid date range: from % > to %', v_from, v_to;
  end if;

  -- Keep the window exact and idempotent for channels populated by this refresh.
  delete from public.erp_mkt_channel_revenue_daily d
  where d.company_id = v_company_id
    and d.rev_date between v_from and v_to
    and d.channel in ('shopify', 'amazon');

  with shopify_order_rollup as (
    select
      o.company_id,
      o.order_created_at::date as rev_date,
      o.id as order_pk,
      coalesce(sum(greatest(coalesce(l.quantity, 0), 0)), 0)::numeric as units_count,
      coalesce(sum(greatest(coalesce(l.price, 0) * coalesce(l.quantity, 0), 0)), 0)::numeric(14,2) as gross_revenue,
      coalesce(sum(greatest((coalesce(l.price, 0) * coalesce(l.quantity, 0)) - coalesce(l.line_discount, 0), 0)), 0)::numeric(14,2) as net_revenue
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_lines l
      on l.company_id = o.company_id
     and l.order_id = o.id
    where o.company_id = v_company_id
      and coalesce(o.is_cancelled, false) = false
      and o.order_created_at::date between v_from and v_to
    group by o.company_id, o.order_created_at::date, o.id
  ),
  shopify_daily as (
    select
      company_id,
      rev_date,
      'shopify'::text as channel,
      count(*)::int as orders_count,
      coalesce(sum(units_count), 0)::int as units_count,
      coalesce(sum(gross_revenue), 0)::numeric(14,2) as gross_revenue,
      coalesce(sum(net_revenue), 0)::numeric(14,2) as net_revenue,
      'INR'::text as currency,
      jsonb_build_object('source_table', 'erp_shopify_orders + erp_shopify_order_lines') as source
    from shopify_order_rollup
    group by company_id, rev_date
  ),
  amazon_daily as (
    select
      f.company_id,
      f.purchase_date::date as rev_date,
      'amazon'::text as channel,
      count(distinct f.amazon_order_id)::int as orders_count,
      coalesce(sum(greatest(coalesce(f.quantity, 0), 0)), 0)::int as units_count,
      coalesce(sum(greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0), 0)), 0)::numeric(14,2) as gross_revenue,
      coalesce(sum(greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)), 0)::numeric(14,2) as net_revenue,
      'INR'::text as currency,
      jsonb_build_object('source_table', 'erp_amazon_order_facts') as source
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.purchase_date::date between v_from and v_to
    group by f.company_id, f.purchase_date::date
  ),
  src as (
    select * from shopify_daily
    union all
    select * from amazon_daily
  )
  insert into public.erp_mkt_channel_revenue_daily (
    company_id,
    rev_date,
    channel,
    orders_count,
    units_count,
    gross_revenue,
    net_revenue,
    currency,
    source,
    updated_at
  )
  select
    s.company_id,
    s.rev_date,
    s.channel,
    s.orders_count,
    s.units_count,
    s.gross_revenue,
    s.net_revenue,
    s.currency,
    s.source,
    now()
  from src s
  on conflict (company_id, rev_date, channel)
  do update
  set
    orders_count = excluded.orders_count,
    units_count = excluded.units_count,
    gross_revenue = excluded.gross_revenue,
    net_revenue = excluded.net_revenue,
    currency = excluded.currency,
    source = excluded.source,
    updated_at = now();
end;
$$;

create or replace function public.erp_mkt_daily_refresh_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_mkt_channel_revenue_daily_refresh_v1(current_date - 60, current_date);
  perform public.erp_growth_cockpit_snapshot_refresh_v1();
end;
$$;

create extension if not exists pg_cron;

-- Schedule hourly jobs; replace existing jobs with same names.
do $cron$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in ('mkt_daily_refresh_hourly', 'growth_cockpit_snapshot_refresh_hourly')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
      and p.pronargs = 3
  ) then
    perform cron.schedule(
      'mkt_daily_refresh_hourly',
      '5 * * * *',
      $cmd$select public.erp_mkt_daily_refresh_v1();$cmd$
    );

    perform cron.schedule(
      'growth_cockpit_snapshot_refresh_hourly',
      '10 * * * *',
      $cmd$select public.erp_growth_cockpit_snapshot_refresh_v1();$cmd$
    );
  else
    perform cron.schedule('5 * * * *', $cmd$select public.erp_mkt_daily_refresh_v1();$cmd$);
    perform cron.schedule('10 * * * *', $cmd$select public.erp_growth_cockpit_snapshot_refresh_v1();$cmd$);
  end if;
end;
$cron$;

-- Troubleshooting: inspect cron.job and cron.job_run_details for schedule/run failures.

commit;
