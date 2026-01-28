-- 0284_amazon_returns_reports.sql
-- Amazon returns ingestion + analytics summary

alter table public.erp_amazon_return_facts
  add column if not exists channel_account_id uuid null references public.erp_channel_accounts (id) on delete set null,
  add column if not exists source text null,
  add column if not exists rma_id text null,
  add column if not exists disposition text null,
  add column if not exists amount_reported numeric null,
  add column if not exists sku text null,
  add column if not exists return_key text null;

alter table public.erp_amazon_return_facts
  alter column quantity set default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_amazon_return_facts_source_chk'
  ) then
    alter table public.erp_amazon_return_facts
      add constraint erp_amazon_return_facts_source_chk
      check (source is null or source in ('mfn', 'fba'));
  end if;
end $$;

create index if not exists erp_amazon_return_facts_company_return_date_idx
  on public.erp_amazon_return_facts (company_id, return_date desc);

create index if not exists erp_amazon_return_facts_company_order_idx
  on public.erp_amazon_return_facts (company_id, amazon_order_id);

create index if not exists erp_amazon_return_facts_company_sku_idx
  on public.erp_amazon_return_facts (company_id, sku);

create index if not exists erp_amazon_return_facts_company_asin_idx
  on public.erp_amazon_return_facts (company_id, asin);

create unique index if not exists erp_amazon_return_facts_company_return_key_idx
  on public.erp_amazon_return_facts (company_id, return_key)
  where return_key is not null;

create or replace function public.erp_amazon_analytics_returns_summary(
  p_from date,
  p_to date,
  p_marketplace text default null,
  p_channel_account_id uuid default null
) returns table (
  returns_orders_count bigint,
  returns_units bigint,
  returns_value_estimated numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace text := nullif(trim(p_marketplace), '');
  v_channel_account_id uuid := p_channel_account_id;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with scoped_returns as (
    select
      rf.id,
      rf.amazon_order_id,
      rf.rma_id,
      rf.asin,
      rf.external_sku,
      rf.sku,
      rf.quantity,
      rf.return_date,
      rf.refund_date
    from public.erp_amazon_return_facts rf
    where rf.company_id = v_company_id
      and (v_marketplace is null or rf.marketplace_id = v_marketplace)
      and (v_channel_account_id is null or rf.channel_account_id = v_channel_account_id)
      and coalesce(rf.return_date, rf.refund_date)::date >= v_from
      and coalesce(rf.return_date, rf.refund_date)::date <= v_to
  ),
  return_values as (
    select
      sr.id,
      coalesce(sr.quantity, 0) as qty,
      case
        when o.id is null then 0::numeric
        else o.row_gross * (coalesce(sr.quantity, 0)::numeric / greatest(o.quantity, 1)::numeric)
      end as est_value
    from scoped_returns sr
    left join lateral (
      select
        o.id,
        o.quantity,
        (coalesce(o.item_amount, 0) + coalesce(o.shipping_amount, 0) + coalesce(o.gift_wrap_amount, 0)) as row_gross
      from public.erp_amazon_order_facts o
      where o.company_id = v_company_id
        and (v_marketplace is null or o.marketplace_id = v_marketplace)
        and (
          (sr.amazon_order_id is not null and o.amazon_order_id = sr.amazon_order_id)
          or (
            sr.amazon_order_id is null
            and sr.asin is not null
            and o.asin = sr.asin
            and coalesce(sr.sku, sr.external_sku) is not null
            and lower(coalesce(o.external_sku, '')) = lower(coalesce(sr.sku, sr.external_sku))
            and o.purchase_date::date >= v_from
            and o.purchase_date::date <= v_to
          )
        )
      order by
        case when sr.amazon_order_id is not null and o.amazon_order_id = sr.amazon_order_id then 0 else 1 end,
        o.purchase_date desc
      limit 1
    ) o on true
  )
  select
    coalesce(count(distinct coalesce(sr.amazon_order_id, sr.rma_id, sr.id::text)), 0)::bigint as returns_orders_count,
    coalesce(sum(coalesce(sr.quantity, 0)), 0)::bigint as returns_units,
    coalesce(sum(rv.est_value), 0)::numeric as returns_value_estimated
  from scoped_returns sr
  left join return_values rv on rv.id = sr.id;
end;
$$;

revoke all on function public.erp_amazon_analytics_returns_summary(date, date, text, uuid) from public;
grant execute on function public.erp_amazon_analytics_returns_summary(date, date, text, uuid) to authenticated;

create or replace function public.erp_amazon_analytics_returns_page(
  p_marketplace text,
  p_from date,
  p_to date,
  p_limit int default 50,
  p_offset int default 0,
  p_channel_account_id uuid default null
) returns table (
  id uuid,
  return_date timestamptz,
  source text,
  amazon_order_id text,
  rma_id text,
  asin text,
  sku text,
  quantity int,
  reason text,
  disposition text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace text := nullif(trim(p_marketplace), '');
  v_channel_account_id uuid := p_channel_account_id;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    rf.id,
    coalesce(rf.return_date, rf.refund_date) as return_date,
    rf.source,
    rf.amazon_order_id,
    rf.rma_id,
    rf.asin,
    coalesce(rf.sku, rf.external_sku) as sku,
    coalesce(rf.quantity, 0)::int as quantity,
    rf.reason,
    rf.disposition,
    rf.status
  from public.erp_amazon_return_facts rf
  where rf.company_id = v_company_id
    and (v_marketplace is null or rf.marketplace_id = v_marketplace)
    and (v_channel_account_id is null or rf.channel_account_id = v_channel_account_id)
    and coalesce(rf.return_date, rf.refund_date)::date >= v_from
    and coalesce(rf.return_date, rf.refund_date)::date <= v_to
  order by coalesce(rf.return_date, rf.refund_date) desc nulls last, rf.created_at desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_returns_page(text, date, date, int, int, uuid) from public;
grant execute on function public.erp_amazon_analytics_returns_page(text, date, date, int, int, uuid) to authenticated;

create or replace function public.erp_amazon_analytics_overview_v2(
  p_from date,
  p_to date,
  p_marketplace text default null,
  p_channel_account_id uuid default null,
  p_fulfillment_mode text default null
) returns table (
  gross_sales numeric,
  net_sales_estimated numeric,
  confirmed_orders_count bigint,
  confirmed_orders_value numeric,
  cancellations_count bigint,
  cancellations_value numeric,
  returns_count bigint,
  returns_value numeric,
  discount_value numeric,
  avg_per_day numeric,
  days_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace text := nullif(trim(p_marketplace), '');
  v_from date := p_from;
  v_to date := p_to;
  v_fulfillment_mode text := upper(nullif(trim(p_fulfillment_mode), ''));
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      f.amazon_order_id,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)) as row_gross,
      coalesce(f.promo_discount, 0) as discount,
      case
        when f.order_status is null then false
        when lower(f.order_status) like '%cancel%' then true
        else false
      end as is_cancelled
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and (v_marketplace is null or f.marketplace_id = v_marketplace)
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
      and (
        v_fulfillment_mode is null
        or (
          v_fulfillment_mode = 'FBA'
          and (
            lower(coalesce(f.fulfillment_channel, '')) in ('afn', 'fba')
            or lower(coalesce(f.fulfillment_channel, '')) like '%amazon%'
            or lower(coalesce(f.fulfillment_channel, '')) like '%fba%'
          )
        )
        or (
          v_fulfillment_mode = 'MFN'
          and (
            lower(coalesce(f.fulfillment_channel, '')) in ('mfn')
            or lower(coalesce(f.fulfillment_channel, '')) like '%merchant%'
          )
        )
        or (
          v_fulfillment_mode = 'SELLER_FLEX'
          and (
            lower(coalesce(f.fulfillment_channel, '')) like '%flex%'
            or lower(coalesce(f.fulfillment_channel, '')) like '%seller%'
          )
        )
        or v_fulfillment_mode not in ('FBA', 'MFN', 'SELLER_FLEX')
      )
  ),
  totals as (
    select
      coalesce(count(distinct amazon_order_id) filter (where not is_cancelled), 0)::bigint as confirmed_orders_count,
      coalesce(sum(row_gross) filter (where not is_cancelled), 0)::numeric as confirmed_orders_value,
      coalesce(count(distinct amazon_order_id) filter (where is_cancelled), 0)::bigint as cancellations_count,
      coalesce(sum(row_gross) filter (where is_cancelled), 0)::numeric as cancellations_value,
      coalesce(sum(discount) filter (where not is_cancelled), 0)::numeric as discount_value
    from scoped
  ),
  return_totals as (
    select
      r.returns_orders_count as returns_count,
      r.returns_value_estimated as returns_value
    from public.erp_amazon_analytics_returns_summary(v_from, v_to, v_marketplace, p_channel_account_id) r
  ),
  range_days as (
    select greatest((v_to - v_from + 1), 0)::int as calc_days
  ),
  agg as (
    select
      totals.confirmed_orders_value::numeric as gross_sales,
      (totals.confirmed_orders_value - return_totals.returns_value - totals.discount_value)::numeric
        as net_sales_estimated,
      totals.confirmed_orders_count::bigint as confirmed_orders_count,
      totals.confirmed_orders_value::numeric as confirmed_orders_value,
      totals.cancellations_count::bigint as cancellations_count,
      totals.cancellations_value::numeric as cancellations_value,
      return_totals.returns_count::bigint as returns_count,
      return_totals.returns_value::numeric as returns_value,
      totals.discount_value::numeric as discount_value,
      range_days.calc_days::int as calc_days
    from totals, return_totals, range_days
  )
  select
    agg.gross_sales::numeric,
    agg.net_sales_estimated::numeric,
    agg.confirmed_orders_count::bigint,
    agg.confirmed_orders_value::numeric,
    agg.cancellations_count::bigint,
    agg.cancellations_value::numeric,
    agg.returns_count::bigint,
    agg.returns_value::numeric,
    agg.discount_value::numeric,
    case
      when agg.calc_days = 0 then 0::numeric
      else agg.net_sales_estimated / nullif(agg.calc_days, 0)
    end as avg_per_day,
    agg.calc_days::int as days_count
  from agg;
end;
$$;

revoke all on function public.erp_amazon_analytics_overview_v2(date, date, text, uuid, text) from public;
grant execute on function public.erp_amazon_analytics_overview_v2(date, date, text, uuid, text) to authenticated;
