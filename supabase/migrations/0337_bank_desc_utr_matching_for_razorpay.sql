-- 0337_bank_desc_utr_matching_for_razorpay.sql
-- Phase 2F.1: Match Razorpay settlements using UTR from bank description

begin;

create or replace function public.erp_razorpay_settlements_suggest_for_bank_txn(
  p_bank_txn_id uuid,
  p_query text default null
)
returns table(
  settlement_db_id uuid,
  settlement_id text,
  utr text,
  amount numeric,
  settled_at timestamptz,
  status text,
  journal_id uuid,
  journal_doc_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_txn record;
  v_query text := nullif(btrim(p_query), '');
  v_ref text;
  v_match_date date;
  v_bank_utr_candidate text;
  v_has_exact boolean := false;
begin
  perform public.erp_require_finance_reader();

  select
    t.id,
    t.txn_date,
    t.value_date,
    t.credit,
    t.reference_no,
    t.description
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
  into v_txn;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  v_ref := nullif(btrim(v_txn.reference_no), '');
  v_match_date := coalesce(v_txn.value_date, v_txn.txn_date);

  v_bank_utr_candidate := case
    when v_txn.description ilike 'NEFT-%' then nullif(btrim(split_part(v_txn.description, '-', 2)), '')
    when v_txn.description ilike 'IMPS-%' then nullif(btrim(split_part(v_txn.description, '-', 2)), '')
    when v_txn.description ilike 'RTGS-%' then nullif(btrim(split_part(v_txn.description, '-', 2)), '')
    else null
  end;

  select exists (
    select 1
      from public.erp_razorpay_settlements s
     where s.company_id = v_company_id
       and s.is_void = false
       and (
         (v_ref is not null and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) = v_ref)
         or (
           v_bank_utr_candidate is not null
           and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) = v_bank_utr_candidate
         )
         or (
           v_txn.description is not null
           and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) is not null
           and v_txn.description ilike '%' || coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) || '%'
         )
       )
  ) into v_has_exact;

  return query
  with base as (
    select
      s.id as settlement_db_id,
      s.razorpay_settlement_id as settlement_id,
      coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) as settlement_utr_canon,
      s.amount,
      s.settled_at,
      s.status,
      j.id as journal_id,
      j.doc_no as journal_doc_no
    from public.erp_razorpay_settlements s
    left join public.erp_fin_journals j
      on j.company_id = s.company_id
     and j.reference_type = 'razorpay_settlement'
     and j.reference_id = s.id
    left join public.erp_bank_recon_links l
      on l.company_id = s.company_id
     and l.entity_type = 'razorpay_settlement'
     and l.entity_id = s.id
     and l.status = 'matched'
     and l.is_void = false
    where s.company_id = v_company_id
      and s.is_void = false
      and l.id is null
      and (
        (
          v_has_exact
          and (
            (v_ref is not null and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) = v_ref)
            or (
              v_bank_utr_candidate is not null
              and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) = v_bank_utr_candidate
            )
            or (
              v_txn.description is not null
              and coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) is not null
              and v_txn.description ilike '%' || coalesce(nullif(btrim(s.utr), ''), nullif(btrim(s.settlement_utr), '')) || '%'
            )
          )
        )
        or (
          not v_has_exact
          and v_txn.credit is not null
          and s.amount between v_txn.credit - 1 and v_txn.credit + 1
          and s.settled_at is not null
          and s.settled_at::date between v_match_date - 7 and v_match_date + 7
        )
      )
  )
  select
    base.settlement_db_id,
    base.settlement_id,
    base.settlement_utr_canon as utr,
    base.amount,
    base.settled_at,
    base.status,
    base.journal_id,
    base.journal_doc_no
  from base
  where v_query is null
     or base.settlement_id ilike '%' || v_query || '%'
     or coalesce(base.settlement_utr_canon, '') ilike '%' || v_query || '%'
     or coalesce(base.journal_doc_no, '') ilike '%' || v_query || '%'
  order by base.settled_at desc nulls last
  limit 20;
end;
$$;

revoke all on function public.erp_razorpay_settlements_suggest_for_bank_txn(uuid, text) from public;
grant execute on function public.erp_razorpay_settlements_suggest_for_bank_txn(uuid, text) to authenticated;

commit;
