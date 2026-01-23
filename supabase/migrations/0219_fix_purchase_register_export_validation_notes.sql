-- 0219_fix_purchase_register_export_validation_notes.sql
-- Fix: text ->> unknown error by properly aliasing jsonb_array_elements output
-- Also keeps outputs CA-ready (validation_status + validation_notes_summary)

drop function if exists public.erp_gst_purchase_register_export(date, date);

create function public.erp_gst_purchase_register_export(p_from date, p_to date)
returns table(
  invoice_date date,
  invoice_no text,
  vendor_name text,
  vendor_gstin text,
  place_of_supply_state_code text,
  is_reverse_charge boolean,
  is_import boolean,
  taxable_total numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric,
  tax_total numeric,
  itc_eligible_tax numeric,
  invoice_total numeric,
  validation_status text,
  validation_notes_summary text
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
    i.invoice_date,
    i.invoice_no,
    v.legal_name as vendor_name,
    i.vendor_gstin,
    i.place_of_supply_state_code,
    i.is_reverse_charge,
    i.is_import,
    coalesce(sum(l.taxable_value), 0) as taxable_total,
    coalesce(sum(l.cgst), 0) as cgst,
    coalesce(sum(l.sgst), 0) as sgst,
    coalesce(sum(l.igst), 0) as igst,
    coalesce(sum(l.cess), 0) as cess,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0) as tax_total,
    coalesce(sum(case when l.itc_eligible then l.cgst + l.sgst + l.igst + l.cess else 0 end), 0) as itc_eligible_tax,
    coalesce(sum(l.taxable_value + l.cgst + l.sgst + l.igst + l.cess), 0) as invoice_total,
    i.validation_status,
    nullif(
      trim(
        concat_ws(
          '; ',
          (
            select string_agg(e.elem->>'message', '; ')
            from jsonb_array_elements(coalesce(i.validation_notes->'errors', '[]'::jsonb)) as e(elem)
          ),
          (
            select string_agg(w.elem->>'message', '; ')
            from jsonb_array_elements(coalesce(i.validation_notes->'warnings', '[]'::jsonb)) as w(elem)
          )
        )
      ),
      ''
    ) as validation_notes_summary
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  join public.erp_gst_purchase_invoice_lines l
    on l.invoice_id = i.id
    and l.company_id = i.company_id
    and l.is_void = false
  where i.company_id = v_company_id
    and i.is_void = false
    and i.invoice_date between p_from and p_to
  group by i.id, v.legal_name;
end;
$$;

grant execute on function public.erp_gst_purchase_register_export(date, date) to authenticated;
