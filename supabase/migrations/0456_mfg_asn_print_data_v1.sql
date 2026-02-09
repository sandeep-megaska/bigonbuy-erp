-- 0456_mfg_asn_print_data_v1.sql
-- Read-only printable ASN packing payload for vendor portal PDF generation.

create or replace function public.erp_mfg_asn_print_data_v1(
  p_session_token text,
  p_asn_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_asn record;
begin
  if p_asn_id is null or coalesce(trim(p_session_token), '') = '' then
    raise exception 'session_token and asn_id are required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select
    a.id,
    a.dispatch_date,
    a.eta_date,
    a.status,
    a.vendor_id,
    coalesce(po.doc_no, po.po_no, '') as po_number,
    v.code as vendor_code,
    coalesce(v.name, v.display_name, v.code, '') as vendor_name
  into v_asn
  from public.erp_mfg_asns a
  join public.erp_purchase_orders po on po.id = a.po_id and po.company_id = a.company_id
  join public.erp_vendors v on v.id = a.vendor_id and v.company_id = a.company_id
  where a.id = p_asn_id
    and a.company_id = v_company_id
    and a.vendor_id = v_vendor_id;

  if not found then
    raise exception 'ASN not found for vendor';
  end if;

  return jsonb_build_object(
    'asn', jsonb_build_object(
      'id', v_asn.id,
      'asn_no', left(v_asn.id::text, 8),
      'dispatch_date', v_asn.dispatch_date,
      'eta_date', v_asn.eta_date,
      'status', v_asn.status
    ),
    'vendor', jsonb_build_object(
      'vendor_code', v_asn.vendor_code,
      'vendor_name', v_asn.vendor_name
    ),
    'po', jsonb_build_object(
      'po_no', v_asn.po_number,
      'code', v_asn.po_number
    ),
    'cartons', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'carton_id', c.id,
          'carton_no', c.carton_no,
          'total_qty', coalesce((
            select sum(cl.qty_packed)::integer
            from public.erp_mfg_asn_carton_lines cl
            where cl.carton_id = c.id
          ), 0),
          'lines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'po_line_id', cl.po_line_id,
                'sku', vr.sku,
                'product_name', prod.name,
                'size', vr.size,
                'color', vr.color,
                'qty', cl.qty_packed
              ) order by vr.sku
            )
            from public.erp_mfg_asn_carton_lines cl
            join public.erp_purchase_order_lines pol on pol.id = cl.po_line_id and pol.company_id = cl.company_id
            join public.erp_variants vr on vr.id = pol.variant_id and vr.company_id = pol.company_id
            left join public.erp_products prod on prod.id = vr.product_id and prod.company_id = vr.company_id
            where cl.carton_id = c.id
          ), '[]'::jsonb)
        )
        order by c.carton_no
      )
      from public.erp_mfg_asn_cartons c
      where c.asn_id = p_asn_id and c.company_id = v_company_id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_cartons', (
        select count(*)::integer
        from public.erp_mfg_asn_cartons c
        where c.asn_id = p_asn_id and c.company_id = v_company_id
      ),
      'total_qty', (
        select coalesce(sum(cl.qty_packed), 0)::integer
        from public.erp_mfg_asn_carton_lines cl
        join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
        where c.asn_id = p_asn_id and c.company_id = v_company_id
      ),
      'sku_count', (
        select count(distinct cl.po_line_id)::integer
        from public.erp_mfg_asn_carton_lines cl
        join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
        where c.asn_id = p_asn_id and c.company_id = v_company_id
      )
    )
  );
end;
$$;

revoke all on function public.erp_mfg_asn_print_data_v1(text, uuid) from public;
grant execute on function public.erp_mfg_asn_print_data_v1(text, uuid) to anon, service_role;

select pg_notify('pgrst', 'reload schema');
