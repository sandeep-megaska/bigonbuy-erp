-- Export GRN lines for CSV

drop function if exists public.erp_grn_export_csv_rows(uuid);

create function public.erp_grn_export_csv_rows(
  p_grn_id uuid
)
returns table (
  grn_id uuid,
  grn_no text,
  grn_date date,
  warehouse_id uuid,
  warehouse_name text,
  vendor_id uuid,
  vendor_name text,
  po_id uuid,
  po_no text,
  sku text,
  item_code text,
  item_name text,
  line_id uuid,
  qty_received integer,
  uom text,
  rate numeric,
  line_amount numeric,
  hsn text,
  batch_no text,
  lot_no text,
  expiry_date date,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_reader();

  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  return query
  select
    g.id as grn_id,
    g.grn_no,
    g.received_at::date as grn_date,
    gl.warehouse_id,
    w.name as warehouse_name,
    po.vendor_id,
    v.legal_name as vendor_name,
    po.id as po_id,
    po.po_no,
    vnt.sku,
    vnt.sku as item_code,
    p.title as item_name,
    gl.id as line_id,
    gl.received_qty as qty_received,
    null::text as uom,
    gl.unit_cost as rate,
    (gl.received_qty::numeric * coalesce(gl.unit_cost, 0)) as line_amount,
    p.hsn_code as hsn,
    null::text as batch_no,
    null::text as lot_no,
    null::date as expiry_date,
    gl.created_at
  from public.erp_grns g
  join public.erp_grn_lines gl
    on gl.grn_id = g.id
  join public.erp_purchase_orders po
    on po.id = g.purchase_order_id
  join public.erp_vendors v
    on v.id = po.vendor_id
  left join public.erp_warehouses w
    on w.id = gl.warehouse_id
  left join public.erp_variants vnt
    on vnt.id = gl.variant_id
  left join public.erp_products p
    on p.id = vnt.product_id
  where g.id = p_grn_id
    and g.company_id = public.erp_current_company_id()
    and gl.company_id = public.erp_current_company_id()
  order by gl.created_at, gl.id;
end;
$$;

revoke all on function public.erp_grn_export_csv_rows(uuid) from public;
grant execute on function public.erp_grn_export_csv_rows(uuid) to authenticated;
