-- RPC payload for purchase order PDF rendering
create or replace function public.erp_proc_po_pdf_payload(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_payload jsonb;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select company_id
    into v_company_id
  from public.erp_purchase_orders
  where id = p_po_id;

  if v_company_id is null then
    raise exception 'Purchase order not found';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'po', jsonb_build_object(
      'id', po.id,
      'po_no', po.po_no,
      'status', po.status,
      'order_date', po.order_date,
      'expected_delivery_date', po.expected_delivery_date,
      'notes', po.notes,
      'deliver_to_warehouse_id', po.deliver_to_warehouse_id,
      'vendor_id', po.vendor_id
    ),
    'vendor', jsonb_build_object(
      'id', v.id,
      'legal_name', v.legal_name,
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
    'deliver_to',
      case
        when w.id is not null then jsonb_build_object('id', w.id, 'name', w.name)
        else null
      end,
    'lines', coalesce(lines.lines, '[]'::jsonb),
    'company', jsonb_build_object(
      'company_id', c.id,
      'legal_name', c.legal_name,
      'brand_name', c.brand_name,
      'currency_code', c.currency_code,
      'gstin', cs.gstin,
      'address_text', cs.address_text,
      'po_terms_text', cs.po_terms_text,
      'po_footer_address_text', cs.po_footer_address_text,
      'bigonbuy_logo_path', cs.bigonbuy_logo_path,
      'megaska_logo_path', cs.megaska_logo_path
    )
  )
  into v_payload
  from public.erp_purchase_orders po
  left join public.erp_vendors v on v.id = po.vendor_id
  left join public.erp_warehouses w on w.id = po.deliver_to_warehouse_id
  left join public.erp_companies c on c.id = po.company_id
  left join public.erp_company_settings cs on cs.company_id = po.company_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', pol.id,
        'variant_id', pol.variant_id,
        'ordered_qty', pol.ordered_qty,
        'unit_cost', pol.unit_cost,
        'sku', var.sku,
        'size', var.size,
        'color', var.color,
        'product_title', prod.title,
        'hsn_code', prod.hsn_code,
        'style_code', prod.style_code
      )
      order by pol.created_at
    ) as lines
    from public.erp_purchase_order_lines pol
    left join public.erp_variants var on var.id = pol.variant_id
    left join public.erp_products prod on prod.id = var.product_id
    where pol.purchase_order_id = po.id
      and pol.company_id = v_company_id
  ) lines on true
  where po.id = p_po_id;

  return v_payload;
end;
$$;

revoke all on function public.erp_proc_po_pdf_payload(uuid) from public;
grant execute on function public.erp_proc_po_pdf_payload(uuid) to authenticated;
