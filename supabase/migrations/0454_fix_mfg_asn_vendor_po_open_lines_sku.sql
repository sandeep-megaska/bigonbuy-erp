-- Fix ASN vendor PO open lines RPC: PO lines do not store sku directly.
-- Resolve SKU from erp_variants via purchase_order_lines.variant_id.

create or replace function public.erp_mfg_vendor_po_open_lines_v1(
  p_session_token text,
  p_po_id uuid default null
) returns table(
  po_id uuid,
  po_number text,
  po_line_id uuid,
  sku text,
  ordered_qty numeric,
  received_qty numeric,
  asn_submitted_qty numeric,
  open_qty numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
begin
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  return query
  with submitted as (
    select al.po_line_id, sum(al.qty)::numeric(18,6) as asn_qty
    from public.erp_mfg_asn_lines al
    join public.erp_mfg_asns a on a.id = al.asn_id and a.company_id = al.company_id
    where al.company_id = v_company_id
      and a.vendor_id = v_vendor_id
      and a.status = 'SUBMITTED'
    group by al.po_line_id
  )
  select
    po.id as po_id,
    coalesce(po.doc_no, po.po_no, '') as po_number,
    pol.id as po_line_id,
    v.sku,
    pol.ordered_qty::numeric(18,6) as ordered_qty,
    coalesce(pol.received_qty,0)::numeric(18,6) as received_qty,
    coalesce(s.asn_qty,0)::numeric(18,6) as asn_submitted_qty,
    greatest(pol.ordered_qty::numeric(18,6) - coalesce(s.asn_qty,0)::numeric(18,6), 0::numeric) as open_qty
  from public.erp_purchase_orders po
  join public.erp_purchase_order_lines pol
    on pol.purchase_order_id = po.id
   and pol.company_id = po.company_id
  join public.erp_variants v
    on v.id = pol.variant_id
   and v.company_id = pol.company_id
  left join submitted s on s.po_line_id = pol.id
  where po.company_id = v_company_id
    and po.vendor_id = v_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void', 'closed')
    and (p_po_id is null or po.id = p_po_id)
  order by po.created_at desc, pol.created_at asc;
end;
$$;
