-- 0349_fix_ap_vendor_payments_search_allocation_count_int.sql
begin;

drop function if exists public.erp_ap_vendor_payments_search(date, date, uuid, text, integer, integer);

create function public.erp_ap_vendor_payments_search(
  p_from date default null,
  p_to date default null,
  p_vendor_id uuid default null,
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
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
  with payments as (
    select
      p.*,
      v.legal_name as vendor_name,
      j.doc_no as journal_doc_no
    from public.erp_ap_vendor_payments p
    left join public.erp_vendors v
      on v.id = p.vendor_id
      and v.company_id = p.company_id
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
      and (
        p_q is null or btrim(p_q) = ''
        or coalesce(p.reference_no, '') ilike ('%' || p_q || '%')
        or coalesce(p.note, '') ilike ('%' || p_q || '%')
        or coalesce(p.mode, '') ilike ('%' || p_q || '%')
        or coalesce(p.source_ref, '') ilike ('%' || p_q || '%')
      )
  ),
  allocations as (
    select
      a.payment_id,
      a.company_id,
      ((count(*) filter (where a.is_void = false))::integer) as allocation_count
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
    group by a.payment_id, a.company_id
  ),
  matches as (
    select
      t.id as bank_txn_id,
      t.txn_date,
      t.amount,
      t.description,
      t.matched_entity_id
    from public.erp_bank_transactions t
    where t.company_id = public.erp_current_company_id()
      and t.is_matched = true
      and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
  )
  select
    p.id,
    p.company_id,
    p.vendor_id,
    p.vendor_name,
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
    p.journal_doc_no,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    coalesce(a.allocation_count, 0) as allocation_count,
    (m.bank_txn_id is not null) as matched,
    m.bank_txn_id,
    m.txn_date,
    m.amount,
    m.description
  from payments p
  left join allocations a
    on a.payment_id = p.id
    and a.company_id = p.company_id
  left join matches m
    on m.matched_entity_id = p.id
  order by p.payment_date desc, p.created_at desc
  limit p_limit
  offset p_offset;
end;
$function$;

revoke all on function public.erp_ap_vendor_payments_search(date, date, uuid, text, integer, integer) from public;
grant execute on function public.erp_ap_vendor_payments_search(date, date, uuid, text, integer, integer) to authenticated;

commit;
