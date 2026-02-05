-- 0395_restore_amazon_batches_list_with_posting.sql
begin;

drop function if exists public.erp_amazon_settlement_batches_list_with_posting(date, date, text, integer, integer);

create function public.erp_amazon_settlement_batches_list_with_posting(
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
      b.id as batch_id,
      b.batch_ref,
      b.period_start,
      b.period_end,
      b.currency,
      b.created_at
    from public.erp_marketplace_settlement_batches b
    join channel ch on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  tx as (
    select
      t.batch_id,
      count(*)::int as txn_count,
      -- Stage-1: net_payout may not be populated; keep as NULL for now.
      -- If you already store net_payout in txns later, this will start working automatically.
      sum(t.net_payout) as net_payout_sum
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select base.batch_id from base)
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
  report_links_ranked as (
    select
      l.batch_id,
      l.report_id,
      row_number() over (
        partition by l.batch_id
        order by l.created_at desc, l.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links l
    where l.company_id = v_company_id
      and l.batch_id in (select base.batch_id from base)
  ),
  report_latest as (
    select batch_id, report_id
    from report_links_ranked
    where rn = 1
  )
  select
    b.batch_id,
    b.batch_ref,
    b.period_start as settlement_start_date,
    b.period_end as settlement_end_date,
    null::date as deposit_date,
    b.currency,
    tx.net_payout_sum as net_payout,
    coalesce(p.posting_state, 'missing') as posting_state,
    p.journal_id,
    p.journal_no,
    rl.report_id,
    coalesce(tx.txn_count, 0) as txn_count,
    coalesce(tx.txn_count, 0) > 0 as has_txns
  from base b
  left join tx
    on tx.batch_id = b.batch_id
  left join posts p
    on p.batch_id = b.batch_id
  left join report_latest rl
    on rl.batch_id = b.batch_id
  where
    v_status = 'all'
    or coalesce(p.posting_state, 'missing') = v_status
  order by coalesce(b.period_end, b.period_start) desc, b.created_at desc
  limit p_limit offset p_offset;

end;
$$;

commit;
