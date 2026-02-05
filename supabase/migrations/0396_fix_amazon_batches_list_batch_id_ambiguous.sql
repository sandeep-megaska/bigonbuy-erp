-- 0396_fix_amazon_batches_list_batch_id_ambiguous.sql
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
  with ch as (
    select sc.id as channel_id
    from public.erp_sales_channels sc
    where sc.company_id = v_company_id
      and lower(sc.code) = 'amazon'
    limit 1
  ),
  b0 as (
    select
      b.id as b_batch_id,
      b.batch_ref as b_batch_ref,
      b.period_start as b_period_start,
      b.period_end as b_period_end,
      b.currency as b_currency,
      b.created_at as b_created_at
    from public.erp_marketplace_settlement_batches b
    join ch on ch.channel_id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  tx as (
    select
      t.batch_id as tx_batch_id,
      count(*)::int as tx_txn_count,
      sum(t.net_payout) as tx_net_payout_sum
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select b0.b_batch_id from b0)
    group by t.batch_id
  ),
  post as (
    select
      fp.batch_id as fp_batch_id,
      fp.posting_state as fp_posting_state,
      fp.journal_id as fp_journal_id,
      j.doc_no as fp_journal_no
    from public.erp_marketplace_settlement_finance_posts fp
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = fp.journal_id
    where fp.company_id = v_company_id
      and fp.platform = 'amazon'
      and fp.batch_id in (select b0.b_batch_id from b0)
  ),
  rl_ranked as (
    select
      l.batch_id as rl_batch_id,
      l.report_id as rl_report_id,
      row_number() over (
        partition by l.batch_id
        order by l.created_at desc, l.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links l
    where l.company_id = v_company_id
      and l.batch_id in (select b0.b_batch_id from b0)
  ),
  rl as (
    select rr.rl_batch_id, rr.rl_report_id
    from rl_ranked rr
    where rr.rn = 1
  )
  select
    b0.b_batch_id as batch_id,
    b0.b_batch_ref as batch_ref,
    b0.b_period_start as settlement_start_date,
    b0.b_period_end as settlement_end_date,
    null::date as deposit_date,
    b0.b_currency as currency,
    tx.tx_net_payout_sum as net_payout,
    coalesce(post.fp_posting_state, 'missing') as posting_state,
    post.fp_journal_id as journal_id,
    post.fp_journal_no as journal_no,
    rl.rl_report_id as report_id,
    coalesce(tx.tx_txn_count, 0) as txn_count,
    coalesce(tx.tx_txn_count, 0) > 0 as has_txns
  from b0
  left join tx
    on tx.tx_batch_id = b0.b_batch_id
  left join post
    on post.fp_batch_id = b0.b_batch_id
  left join rl
    on rl.rl_batch_id = b0.b_batch_id
  where
    v_status = 'all'
    or coalesce(post.fp_posting_state, 'missing') = v_status
  order by coalesce(b0.b_period_end, b0.b_period_start) desc, b0.b_created_at desc
  limit p_limit offset p_offset;

end;
$$;

commit;
