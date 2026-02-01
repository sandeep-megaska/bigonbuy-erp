-- 0347_vendor_advances_list_journal_doc_no.sql
-- Fix: Postgres cannot change function return row type via CREATE OR REPLACE when OUT/RETURNS TABLE changes.
-- Solution: DROP the existing function signature first, then CREATE it again.

begin;

drop function if exists public.erp_ap_vendor_advances_list(uuid, text);

create function public.erp_ap_vendor_advances_list(
  p_vendor_id uuid default null,
  p_status text default null
) returns table (
  advance_id uuid,
  vendor_id uuid,
  vendor_name text,
  advance_date date,
  amount numeric,
  status text,
  reference text,
  payment_instrument_id uuid,
  finance_journal_id uuid,
  journal_doc_no text,
  is_void boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  select
    a.id as advance_id,
    a.vendor_id,
    v.legal_name as vendor_name,
    a.advance_date,
    a.amount,
    a.status,
    a.reference,
    a.payment_instrument_id,
    a.finance_journal_id,
    j.doc_no as journal_doc_no,
    a.is_void
  from public.erp_ap_vendor_advances a
  join public.erp_vendors v
    on v.id = a.vendor_id
    and v.company_id = a.company_id
  left join public.erp_fin_journals j
    on j.id = a.finance_journal_id
  where a.company_id = v_company_id
    and (p_vendor_id is null or a.vendor_id = p_vendor_id)
    and (p_status is null or a.status = p_status)
  order by a.advance_date desc, a.created_at desc;
end;
$$;

revoke all on function public.erp_ap_vendor_advances_list(uuid, text) from public;
grant execute on function public.erp_ap_vendor_advances_list(uuid, text) to authenticated;

commit;
