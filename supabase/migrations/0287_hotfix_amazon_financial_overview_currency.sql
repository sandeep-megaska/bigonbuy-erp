-- 0287_hotfix_amazon_financial_overview_currency.sql
-- Fix currency ambiguity in financial overview RPC.

create or replace function public.erp_amazon_financial_overview_v1(
  p_from date,
  p_to date,
  p_marketplace text default null,
  p_channel_account_id uuid default null
)
returns table (
  settlement_gross_sales numeric,
  settlement_refunds_returns numeric,
  settlement_fees numeric,
  settlement_withholdings numeric,
  settlement_net_payout numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  -- Uses erp_marketplace_settlement_txns.txn_date for date filtering.
  return query
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = v_company_id
      and lower(code) = 'amazon'
    limit 1
  ),
  scoped as (
    select
      t.gross_sales,
      t.refund_amount,
      t.total_fees,
      t.other_charges,
      t.net_payout,
      t.settlement_type,
      b.currency as v_currency
    from public.erp_marketplace_settlement_txns t
    join public.erp_marketplace_settlement_batches b
      on b.id = t.batch_id
    join channel ch
      on ch.id = b.channel_id
    where t.company_id = v_company_id
      and b.company_id = v_company_id
      and t.txn_date >= p_from
      and t.txn_date <= p_to
      and b.status = 'processed'
  ),
  totals as (
    select
      coalesce(sum(coalesce(gross_sales, 0)), 0)::numeric as settlement_gross_sales,
      coalesce(sum(coalesce(refund_amount, 0)), 0)::numeric as settlement_refunds_returns,
      coalesce(sum(coalesce(total_fees, 0)), 0)::numeric as settlement_fees,
      coalesce(
        sum(
          case
            when lower(coalesce(settlement_type, '')) like '%withhold%'
              or lower(coalesce(settlement_type, '')) like '%reserve%'
              or lower(coalesce(settlement_type, '')) like '%hold%'
            then coalesce(other_charges, 0)
            else 0
          end
        ),
        0
      )::numeric as settlement_withholdings,
      coalesce(sum(coalesce(net_payout, 0)), 0)::numeric as settlement_net_payout,
      case
        when count(*) = 0 then 'INR'
        when count(distinct v_currency) = 1 then max(v_currency)
        else 'MULTI'
      end::text as v_currency
    from scoped
  )
  select
    totals.settlement_gross_sales,
    totals.settlement_refunds_returns,
    totals.settlement_fees,
    totals.settlement_withholdings,
    totals.settlement_net_payout,
    totals.v_currency::text as currency
  from totals;
end;
$$;

revoke all on function public.erp_amazon_financial_overview_v1(date, date, text, uuid) from public;
grant execute on function public.erp_amazon_financial_overview_v1(date, date, text, uuid) to authenticated;
