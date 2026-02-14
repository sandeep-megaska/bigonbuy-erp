-- 0509_mkt_channel_revenue_daily_amazon_oms_dedup_fix.sql
-- Fix Amazon daily revenue to aggregate from OMS orders totals without item join duplication.

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

  -- Shopify aggregation (unchanged)
  insert into public.erp_mkt_channel_revenue_daily (
    company_id, rev_date, channel, orders_count, units_count, net_revenue, updated_at
  )
  select
    v_company_id,
    o.order_created_at::date as rev_date,
    'shopify'::text as channel,
    count(distinct o.shopify_order_id)::int as orders_count,
    coalesce(sum(coalesce(l.quantity,0)),0)::int as units_count,
    coalesce(sum(greatest((coalesce(l.price,0)*coalesce(l.quantity,0)) - coalesce(l.line_discount,0),0)),0)::numeric as net_revenue,
    now() as updated_at
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
        net_revenue = excluded.net_revenue,
        updated_at = now();

  -- Amazon aggregation from OMS orders (no join duplication)
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
    v_company_id,
    o.purchase_date::date as rev_date,
    'amazon'::text as channel,
    count(*)::int as orders_count,
    coalesce(sum(coalesce(o.number_of_items_shipped, 0) + coalesce(o.number_of_items_unshipped, 0)), 0)::int as units_count,
    coalesce(sum(coalesce(o.order_total, 0)), 0)::numeric(14,2) as gross_revenue,
    coalesce(sum(coalesce(o.order_total, 0)), 0)::numeric(14,2) as net_revenue,
    coalesce(max(nullif(trim(o.currency), '')), 'INR')::text as currency,
    jsonb_build_object(
      'source', 'erp_amazon_orders',
      'method', 'order_total',
      'note', 'no join duplication'
    ) as source,
    now() as updated_at
  from public.erp_amazon_orders o
  where o.company_id = v_company_id
    and o.purchase_date::date between v_from and v_to
  group by o.purchase_date::date
  on conflict (company_id, rev_date, channel) do update
    set orders_count = excluded.orders_count,
        units_count = excluded.units_count,
        gross_revenue = excluded.gross_revenue,
        net_revenue = excluded.net_revenue,
        currency = excluded.currency,
        source = excluded.source,
        updated_at = now();
end;
$$;

-- Acceptance SQL:
-- select public.erp_mkt_channel_revenue_daily_refresh_v1(current_date-14, current_date);
-- select rev_date, gross_revenue
-- from public.erp_mkt_channel_revenue_daily
-- where company_id=public.erp_current_company_id()
--   and channel='amazon'
-- order by rev_date desc
-- limit 14;
--
-- should match:
-- select purchase_date::date dt, sum(order_total) gross
-- from public.erp_amazon_orders
-- where company_id=public.erp_current_company_id()
--   and marketplace_id='A21TJRUUN4KGV'
--   and purchase_date::date >= current_date-14
-- group by 1 order by 1 desc;

commit;
