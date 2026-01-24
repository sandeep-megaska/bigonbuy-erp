-- 0243_finance_recon_rpcs.sql
-- Phase-3C: Finance recon dashboard RPC

------------------------------------------------------------
-- RPC: Finance reconciliation summary
------------------------------------------------------------

drop function if exists public.erp_finance_recon_summary(date, date, uuid, text, int, int);

create function public.erp_finance_recon_summary(
  p_from date,
  p_to date,
  p_vendor_id uuid,
  p_q text,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_limit int := coalesce(p_limit, 50);
  v_offset int := coalesce(p_offset, 0);
begin
  perform public.erp_require_finance_reader();

  return (
    with bank_base as (
      select
        t.id as bank_txn_id,
        t.txn_date,
        t.amount,
        t.debit,
        t.credit,
        coalesce(t.currency, 'INR') as currency,
        t.description,
        t.reference_no,
        t.account_ref
      from public.erp_bank_transactions t
      where t.company_id = v_company_id
        and t.is_void = false
        and t.is_matched = false
        and (p_from is null or t.txn_date >= p_from)
        and (p_to is null or t.txn_date <= p_to)
    ),
    bank_list as (
      select *
      from bank_base
      order by (case when coalesce(debit, 0) > 0 then 0 else 1 end),
        txn_date desc,
        bank_txn_id desc
      limit v_limit
      offset v_offset
    ),
    payment_matches as (
      select
        t.id as bank_txn_id,
        t.txn_date,
        t.description,
        t.matched_entity_id
      from public.erp_bank_transactions t
      where t.company_id = v_company_id
        and t.is_matched = true
        and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
    ),
    payments_filtered as (
      select
        p.id as payment_id,
        p.payment_date,
        p.vendor_id,
        v.legal_name as vendor_name,
        p.amount,
        coalesce(p.currency, 'INR') as currency,
        p.mode,
        p.reference_no,
        p.note,
        p.source_ref,
        p.is_void
      from public.erp_ap_vendor_payments p
      left join public.erp_vendors v
        on v.id = p.vendor_id
        and v.company_id = p.company_id
      where p.company_id = v_company_id
        and p.is_void = false
        and (p_from is null or p.payment_date >= p_from)
        and (p_to is null or p.payment_date <= p_to)
        and (p_vendor_id is null or p.vendor_id = p_vendor_id)
        and (
          p_q is null
          or btrim(p_q) = ''
          or coalesce(p.reference_no, '') ilike ('%' || p_q || '%')
          or coalesce(p.note, '') ilike ('%' || p_q || '%')
          or coalesce(p.source_ref, '') ilike ('%' || p_q || '%')
          or coalesce(p.mode, '') ilike ('%' || p_q || '%')
          or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
        )
    ),
    payments_unmatched_base as (
      select
        p.payment_id,
        p.payment_date,
        p.vendor_id,
        p.vendor_name,
        p.amount,
        p.currency,
        p.mode,
        p.reference_no,
        p.note,
        p.is_void,
        false as matched
      from payments_filtered p
      left join payment_matches m
        on m.matched_entity_id = p.payment_id
      where m.bank_txn_id is null
    ),
    payments_unmatched_list as (
      select *
      from payments_unmatched_base
      order by payment_date desc, payment_id desc
      limit v_limit
      offset v_offset
    ),
    allocations_by_payment as (
      select
        a.payment_id,
        a.company_id,
        coalesce(sum(a.allocated_amount), 0) as allocated_total
      from public.erp_ap_vendor_payment_allocations a
      where a.company_id = v_company_id
        and a.is_void = false
      group by a.payment_id, a.company_id
    ),
    payments_unallocated_base as (
      select
        p.payment_id,
        p.payment_date,
        p.vendor_id,
        p.vendor_name,
        p.amount,
        coalesce(a.allocated_total, 0) as allocated_total,
        greatest(p.amount - coalesce(a.allocated_total, 0), 0) as unallocated_amount,
        (m.bank_txn_id is not null) as matched,
        m.bank_txn_id as matched_bank_txn_id,
        m.txn_date as matched_bank_txn_date,
        m.description as matched_bank_txn_description
      from payments_filtered p
      left join allocations_by_payment a
        on a.payment_id = p.payment_id
      left join payment_matches m
        on m.matched_entity_id = p.payment_id
      where greatest(p.amount - coalesce(a.allocated_total, 0), 0) > 0
    ),
    payments_unallocated_list as (
      select *
      from payments_unallocated_base
      order by matched desc, unallocated_amount desc, payment_date desc, payment_id desc
      limit v_limit
      offset v_offset
    ),
    allocations_by_invoice as (
      select
        a.invoice_id,
        a.company_id,
        coalesce(sum(a.allocated_amount), 0) as allocated_total
      from public.erp_ap_vendor_payment_allocations a
      where a.company_id = v_company_id
        and a.is_void = false
      group by a.invoice_id, a.company_id
    ),
    invoices_base as (
      select
        i.id as invoice_id,
        i.invoice_no,
        i.invoice_date,
        i.vendor_id,
        v.legal_name as vendor_name,
        coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
        coalesce(a.allocated_total, 0) as allocated_total,
        greatest(
          coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
            - coalesce(a.allocated_total, 0),
          0
        ) as outstanding_amount,
        i.validation_status
      from public.erp_gst_purchase_invoices i
      left join public.erp_vendors v
        on v.id = i.vendor_id
        and v.company_id = i.company_id
      left join allocations_by_invoice a
        on a.invoice_id = i.id
        and a.company_id = i.company_id
      where i.company_id = v_company_id
        and i.is_void = false
        and (p_vendor_id is null or i.vendor_id = p_vendor_id)
        and (p_from is null or i.invoice_date >= p_from)
        and (p_to is null or i.invoice_date <= p_to)
        and (
          p_q is null
          or btrim(p_q) = ''
          or coalesce(i.invoice_no, '') ilike ('%' || p_q || '%')
          or coalesce(i.note, '') ilike ('%' || p_q || '%')
          or coalesce(i.source_ref, '') ilike ('%' || p_q || '%')
          or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
        )
        and greatest(
          coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
            - coalesce(a.allocated_total, 0),
          0
        ) > 0
    ),
    invoices_list as (
      select *
      from invoices_base
      order by invoice_date desc, invoice_id desc
      limit v_limit
      offset v_offset
    )
    select jsonb_build_object(
      'counters',
      jsonb_build_object(
        'bank_unmatched_count', (select count(*) from bank_base),
        'payments_unmatched_count', (select count(*) from payments_unmatched_base),
        'payments_unallocated_count', (select count(*) from payments_unallocated_base),
        'invoices_outstanding_count', (select count(*) from invoices_base),
        'invoices_outstanding_total', (select coalesce(sum(outstanding_amount), 0) from invoices_base),
        'payments_unallocated_total', (select coalesce(sum(unallocated_amount), 0) from payments_unallocated_base)
      ),
      'bank_unmatched', coalesce((select jsonb_agg(to_jsonb(bank_list)) from bank_list), '[]'::jsonb),
      'payments_unmatched',
        coalesce((select jsonb_agg(to_jsonb(payments_unmatched_list)) from payments_unmatched_list), '[]'::jsonb),
      'payments_unallocated',
        coalesce((select jsonb_agg(to_jsonb(payments_unallocated_list)) from payments_unallocated_list), '[]'::jsonb),
      'invoices_outstanding',
        coalesce((select jsonb_agg(to_jsonb(invoices_list)) from invoices_list), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.erp_finance_recon_summary(date, date, uuid, text, int, int) to authenticated;
