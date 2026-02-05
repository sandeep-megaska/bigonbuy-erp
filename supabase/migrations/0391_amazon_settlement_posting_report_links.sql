-- 0391_amazon_settlement_posting_report_links.sql
-- Add report linkage + normalized state to Amazon settlement posting list RPC.

create or replace function public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text default 'all',
  p_limit int default 50,
  p_offset int default 0
) returns table (
  batch_id uuid,
  batch_ref text,
  settlement_start_date date,
  settlement_end_date date,
  deposit_date date,
  currency text,
  net_payout numeric,
  posting_state text,
  journal_id uuid,
  journal_no text,
  report_id text,
  txn_count int,
  normalized_state boolean,
  has_txns boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
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
    select
      b.id,
      b.batch_ref,
      b.period_start,
      b.period_end,
      b.currency,
      b.created_at
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(sum(coalesce(t.net_payout, 0)), 0) as net_payout,
      count(*)::int as txn_count
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select id from base)
    group by t.batch_id
  ),
  posts as (
    select
      p.batch_id,
      p.posting_state,
      p.journal_id,
      j.doc_no as journal_no
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  ),
  report_links as (
    select
      l.batch_id,
      l.report_id,
      row_number() over (
        partition by l.batch_id
        order by p.updated_at desc nulls last, l.created_at desc, l.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links l
    left join public.erp_marketplace_settlement_report_payloads p
      on p.company_id = v_company_id
     and p.report_id = l.report_id
    where l.company_id = v_company_id
      and l.batch_id in (select id from base)
  ),
  reports as (
    select batch_id, report_id
    from report_links
    where rn = 1
  )
  select
    b.id as batch_id,
    b.batch_ref,
    b.period_start as settlement_start_date,
    b.period_end as settlement_end_date,
    null::date as deposit_date,
    b.currency,
    coalesce(t.net_payout, 0) as net_payout,
    coalesce(p.posting_state, 'missing') as posting_state,
    p.journal_id,
    p.journal_no,
    r.report_id,
    coalesce(t.txn_count, 0) as txn_count,
    coalesce(t.txn_count, 0) > 0 as normalized_state,
    coalesce(t.txn_count, 0) > 0 as has_txns
  from base b
  left join totals t
    on t.batch_id = b.id
  left join posts p
    on p.batch_id = b.id
  left join reports r
    on r.batch_id = b.id
  where
    v_status = 'all'
    or coalesce(p.posting_state, 'missing') = v_status
  order by coalesce(b.period_end, b.period_start) desc, b.created_at desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.erp_amazon_settlement_batches_list_with_posting(date, date, text, int, int) from public;
grant execute on function public.erp_amazon_settlement_batches_list_with_posting(date, date, text, int, int) to authenticated;
