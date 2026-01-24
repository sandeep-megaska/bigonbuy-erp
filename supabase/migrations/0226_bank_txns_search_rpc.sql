-- 0226_bank_txns_search_rpc.sql
-- Phase-2D-A: Bank transactions search RPC (date range + string query + optional source/amount filters)

drop function if exists public.erp_bank_txns_search(date, date, text, text, numeric, numeric);

create function public.erp_bank_txns_search(
  p_from date,
  p_to date,
  p_source text default null,
  p_query text default null,
  p_min_amount numeric default null,
  p_max_amount numeric default null
)
returns table (
  id uuid,
  source text,
  account_ref text,
  txn_date date,
  value_date date,
  description text,
  reference_no text,
  debit numeric,
  credit numeric,
  amount numeric,
  balance numeric,
  currency text,
  is_matched boolean,
  matched_entity_type text,
  matched_entity_id uuid,
  match_confidence text,
  match_notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    t.id,
    t.source,
    t.account_ref,
    t.txn_date,
    t.value_date,
    t.description,
    t.reference_no,
    t.debit,
    t.credit,
    t.amount,
    t.balance,
    t.currency,
    t.is_matched,
    t.matched_entity_type,
    t.matched_entity_id,
    t.match_confidence,
    t.match_notes,
    t.created_at
  from public.erp_bank_transactions t
  where t.company_id = public.erp_current_company_id()
    and t.is_void = false
    and t.txn_date >= p_from
    and t.txn_date <= p_to
    and (p_source is null or btrim(p_source) = '' or t.source = p_source)
    and (
      p_query is null or btrim(p_query) = ''
      or t.description ilike ('%' || p_query || '%')
      or coalesce(t.reference_no, '') ilike ('%' || p_query || '%')
    )
    and (p_min_amount is null or t.amount >= p_min_amount)
    and (p_max_amount is null or t.amount <= p_max_amount)
  order by t.txn_date desc, t.created_at desc;
end;
$$;

grant execute on function public.erp_bank_txns_search(date, date, text, text, numeric, numeric) to authenticated;
