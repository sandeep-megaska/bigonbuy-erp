begin;

create or replace function public.erp_amazon_settlement_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_count int,
  posted_count int,
  missing_count int,
  excluded_count int,
  total_amount numeric,
  posted_amount numeric,
  missing_amount numeric,
  excluded_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = v_company_id
      and lower(code) = 'amazon'
    limit 1
  ),
  base as (
    select b.id
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(
        sum(coalesce(t.gross_sales, 0) + coalesce(t.total_fees, 0) + coalesce(t.refund_amount, 0) + coalesce(t.other_charges, 0)),
        0
      ) as net_payout
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select id from base)
    group by t.batch_id
  ),
  posts as (
    select
      p.batch_id,
      p.posting_state
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  )
  select
    count(*)::int as total_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'posted' then 1 else 0 end), 0)::int as posted_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'missing' then 1 else 0 end), 0)::int as missing_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then 1 else 0 end), 0)::int as excluded_count,
    coalesce(sum(coalesce(t.net_payout, 0)), 0) as total_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'posted' then coalesce(t.net_payout, 0) else 0 end), 0) as posted_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'missing' then coalesce(t.net_payout, 0) else 0 end), 0) as missing_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then coalesce(t.net_payout, 0) else 0 end), 0) as excluded_amount
  from base b
  left join totals t
    on t.batch_id = b.id
  left join posts p
    on p.batch_id = b.id;
end;
$$;

revoke all on function public.erp_amazon_settlement_posting_summary(date, date) from public;
grant execute on function public.erp_amazon_settlement_posting_summary(date, date) to authenticated;

commit;
