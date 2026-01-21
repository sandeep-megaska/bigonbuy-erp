-- RPC payload for finance note PDF rendering
create or replace function public.erp_finance_note_pdf_payload(p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  perform public.erp_require_finance_reader();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select jsonb_build_object(
    'note', jsonb_build_object(
      'id', n.id,
      'note_no', n.note_no,
      'party_type', n.party_type,
      'note_kind', n.note_kind,
      'status', n.status,
      'note_date', n.note_date,
      'party_id', n.party_id,
      'party_name', n.party_name,
      'currency', n.currency,
      'subtotal', n.subtotal,
      'tax_total', n.tax_total,
      'total', n.total,
      'source_type', n.source_type,
      'source_id', n.source_id,
      'cancel_reason', n.cancel_reason
    ),
    'party', jsonb_build_object(
      'name', coalesce(v.legal_name, n.party_name),
      'gstin', v.gstin,
      'contact_person', v.contact_person,
      'phone', v.phone,
      'email', v.email,
      'address', v.address,
      'address_line1', v.address_line1,
      'address_line2', v.address_line2,
      'city', v.city,
      'state', v.state,
      'pincode', v.pincode,
      'country', v.country
    ),
    'lines', coalesce(lines.lines, '[]'::jsonb),
    'company', jsonb_build_object(
      'company_id', c.id,
      'legal_name', c.legal_name,
      'brand_name', c.brand_name,
      'currency_code', c.currency_code,
      'gstin', cs.gstin,
      'address_text', cs.address_text,
      'bigonbuy_logo_path', cs.bigonbuy_logo_path,
      'megaska_logo_path', cs.megaska_logo_path
    )
  )
  into v_payload
  from public.erp_notes n
  left join public.erp_vendors v on v.id = n.party_id and n.party_type = 'vendor'
  left join public.erp_companies c on c.id = n.company_id
  left join public.erp_company_settings cs on cs.company_id = n.company_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'line_no', l.line_no,
        'item_type', l.item_type,
        'variant_id', l.variant_id,
        'sku', l.sku,
        'title', l.title,
        'hsn', l.hsn,
        'qty', l.qty,
        'unit_rate', l.unit_rate,
        'tax_rate', l.tax_rate,
        'line_subtotal', l.line_subtotal,
        'line_tax', l.line_tax,
        'line_total', l.line_total
      )
      order by l.line_no
    ) as lines
    from public.erp_note_lines l
    where l.note_id = n.id
  ) lines on true
  where n.id = p_note_id
    and n.company_id = v_company_id;

  if v_payload is null then
    raise exception 'Note not found';
  end if;

  return v_payload;
end;
$$;

revoke all on function public.erp_finance_note_pdf_payload(uuid) from public;
grant execute on function public.erp_finance_note_pdf_payload(uuid) to authenticated;
