-- 0392_fix_amazon_settlement_batches_list_with_posting.sql
-- Fix ambiguous batch_id references by dropping + recreating the list RPC with safe aliases.

begin;

drop function if exists public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text,
  p_limit integer,
  p_offset integer
);

create function public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text default 'all',
  p_limit int default 50,
  p_offset int default 0
)
returns table (
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
    select ch.id
    from public.erp_sales_channels ch
    where ch.company_id = v_company_id
      and lower(ch.code) = 'amazon'
    limit 1
  ),
  base as (
    select
      b.id        as batch_id,
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
      and t.batch_id in (select b.batch_id from base b)
    group by t.batch_id
  ),
  posts as (
    select
      fp.batch_id,
      fp.posting_state,
      fp.journal_id,
      j.doc_no as journal_no
    from public.erp_marketplace_settlement_finance_posts fp
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = fp.journal_id
    where fp.company_id = v_company_id
      and fp.platform = 'amazon'
  ),
  report_links_ranked as (
    select
      rl.batch_id,
      rl.report_id,
      row_number() over (
        partition by rl.batch_id
        order by
          rp.updated_at desc nulls last,
          rl.created_at desc,
          rl.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links rl
    left join public.erp_marketplace_settlement_report_payloads rp
      on rp.company_id = v_company_id
     and rp.report_id = rl.report_id
    where rl.company_id = v_company_id
      and rl.batch_id in (select b.batch_id from base b)
  ),
  reports as (
    select
      rlr.batch_id,
      rlr.report_id
    from report_links_ranked rlr
    where rlr.rn = 1
  )
  select
    b.batch_id,
    b.batch_ref,
    b.period_start as settlement_start_date,
    b.period_end   as settlement_end_date,
    null::date     as deposit_date,
    b.currency,
    coalesce(t.net_payout, 0) as net_payout,
    coalesce(fp.posting_state, 'missing') as posting_state,
    fp.journal_id,
    fp.journal_no,
    r.report_id,
    coalesce(t.txn_count, 0) as txn_count,
    (coalesce(t.txn_count, 0) > 0) as normalized_state,
    (coalesce(t.txn_count, 0) > 0) as has_txns
  from base b
  left join totals t
    on t.batch_id = b.batch_id
  left join posts fp
    on fp.batch_id = b.batch_id
  left join reports r
    on r.batch_id = b.batch_id
  where
    v_status = 'all'
    or coalesce(fp.posting_state, 'missing') = v_status
  order by
    coalesce(b.period_end, b.period_start) desc,
    b.created_at desc nulls last
  limit p_limit
  offset p_offset;

end;
$$;

commit;
