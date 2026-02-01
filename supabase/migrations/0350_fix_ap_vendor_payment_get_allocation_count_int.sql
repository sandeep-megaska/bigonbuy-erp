-- 0350_fix_ap_vendor_payment_get_allocation_count_int.sql
-- Fix: count(*) returns bigint, but function return column allocation_count is integer (col 22)

begin;

drop function if exists public.erp_ap_vendor_payment_get(uuid);

create function public.erp_ap_vendor_payment_get(p_id uuid)
returns table (
  id uuid,
  company_id uuid,
  vendor_id uuid,
  vendor_name text,
  payment_date date,
  amount numeric,
  currency text,
  mode text,
  reference_no text,
  note text,
  source text,
  source_ref text,
  payment_instrument_id uuid,
  status text,
  finance_journal_id uuid,
  journal_doc_no text,
  is_void boolean,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  allocation_count integer,
  matched boolean,
  matched_bank_txn_id uuid,
  matched_bank_txn_date date,
  matched_bank_txn_amount numeric,
  matched_bank_txn_description text
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.erp_require_finance_reader();

  return query
  with allocations as (
    select
      a.payment_id,
      a.company_id,
      ((count(*) filter (where a.is_void = false))::integer) as allocation_count
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
    group by a.payment_id, a.company_id
  )
  select
    p.id,
    p.company_id,
    p.vendor_id,
    v.legal_name as vendor_name,
    p.payment_date,
    p.amount,
    p.currency,
    p.mode,
    p.reference_no,
    p.note,
    p.source,
    p.source_ref,
    p.payment_instrument_id,
    p.status,
    p.finance_journal_id,
    j.doc_no as journal_doc_no,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    coalesce(a.allocation_count, 0) as allocation_count,
    (t.id is not null) as matched,
    t.id as matched_bank_txn_id,
    t.txn_date as matched_bank_txn_date,
    t.amount as matched_bank_txn_amount,
    t.description as matched_bank_txn_description
  from public.erp_ap_vendor_payments p
  left join public.erp_vendors v
    on v.id = p.vendor_id
    and v.company_id = p.company_id
  left join public.erp_fin_journals j
    on j.id = p.finance_journal_id
    and j.company_id = p.company_id
  left join allocations a
    on a.payment_id = p.id
    and a.company_id = p.company_id
  left join public.erp_bank_transactions t
    on t.company_id = p.company_id
    and t.is_matched = true
    and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
    and t.matched_entity_id = p.id
  where p.company_id = public.erp_current_company_id()
    and p.id = p_id;
end;
$function$;

revoke all on function public.erp_ap_vendor_payment_get(uuid) from public;
grant execute on function public.erp_ap_vendor_payment_get(uuid) to authenticated;

commit;
