-- 0234_fix_erp_post_grn_insert.sql
-- Fix erp_post_grn(): insert/select column mismatch causing "more expressions than target columns".
-- Forward-only, audit-safe. Recreate function (drop+create).

begin;

drop function if exists public.erp_post_grn(uuid);

create function public.erp_post_grn(p_grn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_grn public.erp_grns%rowtype;
  v_exists boolean;
  v_grn_no text;
begin
  perform public.erp_require_inventory_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_grn
  from public.erp_grns g
  where g.id = p_grn_id
    and g.company_id = v_company_id
  for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted';
  end if;

  -- Ledger posting (FIXED): exactly 9 select expressions for 9 target columns
  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty_in,
    qty_out,
    unit_cost,
    entry_type,
    reference,
    created_by
  )
  select
    gl.company_id,
    gl.warehouse_id,
    gl.variant_id,
    gl.received_qty,
    0,
    coalesce(gl.unit_cost, 0),
    'grn_in',
    'GRN:' || p_grn_id::text,
    v_actor
  from public.erp_grn_lines gl
  where gl.grn_id = p_grn_id
    and gl.company_id = v_company_id;

  -- Update PO line received qty
  update public.erp_purchase_order_lines pol
     set received_qty = coalesce(pol.received_qty, 0) + gl.received_qty,
         updated_at = now()
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and gl.company_id = v_company_id
     and pol.id = gl.purchase_order_line_id;

  -- Update PO status
  update public.erp_purchase_orders po
     set status = case
                    when (
                      select count(*)
                      from public.erp_purchase_order_lines pol2
                      where pol2.purchase_order_id = po.id
                        and coalesce(pol2.received_qty, 0) < pol2.ordered_qty
                    ) = 0 then 'received'
                    when po.status = 'approved' then 'partially_received'
                    else po.status
                  end,
         updated_at = now()
   where po.id = v_grn.purchase_order_id
     and po.company_id = v_company_id;

  -- Ensure GRN number exists + uniqueness (keep behavior consistent)
  v_grn_no := coalesce(v_grn.grn_no, public.erp_doc_allocate_number(p_grn_id, 'GRN'));

  if not public.erp_doc_no_is_valid(v_grn_no, 'GRN') then
    raise exception 'Invalid GRN number format. Expected FYxx-xx/GRN/000001';
  end if;

  select exists(
    select 1
    from public.erp_grns g2
    where g2.company_id = v_company_id
      and g2.grn_no = v_grn_no
      and g2.id <> p_grn_id
  ) into v_exists;

  if v_exists then
    raise exception 'GRN number already in use';
  end if;

  -- Mark GRN posted
  update public.erp_grns
     set status = 'posted',
         grn_no = v_grn_no,
         received_at = now(),
         updated_at = now(),
         updated_by = v_actor
   where id = p_grn_id
     and company_id = v_company_id;

  return jsonb_build_object('status', 'posted', 'grn_id', p_grn_id);
end;
$$;

revoke all on function public.erp_post_grn(uuid) from public;
grant execute on function public.erp_post_grn(uuid) to authenticated;

commit;
