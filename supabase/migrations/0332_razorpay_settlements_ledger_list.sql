-- 0332_razorpay_settlements_ledger_list.sql

create or replace function public.erp_razorpay_settlements_list(
  p_from date,
  p_to date,
  p_query text default null,
  p_posted_only boolean default false
)
returns table(
  settlement_id text,
  settled_at timestamptz,
  amount numeric,
  currency text,
  utr text,
  status text,
  journal_id uuid,
  doc_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(p_query), '');
begin
  perform public.erp_require_finance_reader();

  return query
  select
    s.razorpay_settlement_id,
    coalesce(s.settled_at, s.created_at),
    s.amount,
    s.currency,
    s.settlement_utr,
    case
      when p.finance_journal_id is not null then 'posted'
      else 'imported'
    end as status,
    p.finance_journal_id,
    j.doc_no
  from public.erp_razorpay_settlements s
  left join public.erp_razorpay_settlement_posts p
    on p.company_id = s.company_id
   and p.razorpay_settlement_id = s.razorpay_settlement_id
   and p.is_void = false
  left join public.erp_fin_journals j
    on j.company_id = s.company_id
   and j.id = p.finance_journal_id
  where s.company_id = public.erp_current_company_id()
    and s.is_void = false
    and (p_from is null or coalesce(s.settled_at, s.created_at)::date >= p_from)
    and (p_to is null or coalesce(s.settled_at, s.created_at)::date <= p_to)
    and (
      v_query is null
      or s.razorpay_settlement_id ilike '%' || v_query || '%'
      or s.settlement_utr ilike '%' || v_query || '%'
    )
    and (not p_posted_only or p.finance_journal_id is not null)
  order by coalesce(s.settled_at, s.created_at) desc nulls last, s.created_at desc;
end;
$$;

revoke all on function public.erp_razorpay_settlements_list(date, date, text, boolean) from public;
grant execute on function public.erp_razorpay_settlements_list(date, date, text, boolean) to authenticated;
