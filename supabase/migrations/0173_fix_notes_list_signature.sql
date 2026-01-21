-- 0173_fix_notes_list_signature.sql
-- Fix-forward: stabilize erp_notes_list return type and filtering.
-- (Deactivates any conflicting 0172 behavior by drop+create.)

begin;

drop function if exists public.erp_notes_list(
  p_party_type text,
  p_note_kind text,
  p_status text,
  p_from date,
  p_to date,
  p_doc_no text,
  p_limit integer,
  p_offset integer
);

create function public.erp_notes_list(
  p_party_type text default null,
  p_note_kind text default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_doc_no text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  company_id uuid,
  doc_no text,
  fiscal_year text,
  note_number text,
  note_no text,
  party_type text,
  note_kind text,
  status text,
  note_date date,
  party_id uuid,
  party_name text,
  currency text,
  subtotal numeric,
  tax_total numeric,
  total numeric,
  reference_invoice_number text,
  reference_invoice_date date,
  reason text,
  place_of_supply text,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    n.id,
    n.company_id,
    n.doc_no,
    n.fiscal_year,
    n.note_number,
    n.note_no,
    n.party_type,
    n.note_kind,
    n.status,
    n.note_date,
    n.party_id,
    n.party_name,
    n.currency,
    n.subtotal,
    n.tax_total,
    n.total,
    n.reference_invoice_number,
    n.reference_invoice_date,
    n.reason,
    n.place_of_supply,
    n.created_at,
    n.created_by,
    n.updated_at
  from public.erp_notes n
  where n.company_id = public.erp_current_company_id()
    and (p_party_type is null or p_party_type = '' or n.party_type = p_party_type)
    and (p_note_kind is null or p_note_kind = '' or n.note_kind = upper(p_note_kind))
    and (p_status is null or p_status = '' or n.status = p_status)
    and (p_from is null or n.note_date >= p_from)
    and (p_to is null or n.note_date <= p_to)
    and (
      p_doc_no is null or p_doc_no = ''
      or n.doc_no ilike '%' || p_doc_no || '%'
      or n.note_number ilike '%' || p_doc_no || '%'
      or n.note_no ilike '%' || p_doc_no || '%'
    )
  order by n.note_date desc, n.created_at desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.erp_notes_list(
  text, text, text, date, date, text, integer, integer
) to authenticated;

commit;
