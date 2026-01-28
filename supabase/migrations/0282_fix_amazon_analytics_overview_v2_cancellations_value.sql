-- 0282_fix_amazon_analytics_overview_v2_cancellations_value.sql
-- Fix: compute cancellations_value from row_gross using same gross expression as confirmed orders

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
      coalesce(count(distinct rf.amazon_order_id), 0)::bigint as returns_count,
      coalesce(sum(coalesce(rf.refund_amount, 0)), 0)::numeric as returns_value
    from public.erp_amazon_return_facts rf
    where rf.company_id = v_company_id
      and (v_marketplace is null or rf.marketplace_id = v_marketplace)
      and coalesce(rf.return_date, rf.refund_date)::date >= v_from
      and coalesce(rf.return_date, rf.refund_date)::date <= v_to
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
