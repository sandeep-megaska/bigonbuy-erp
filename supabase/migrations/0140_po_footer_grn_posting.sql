-- Add PO footer address text to company settings
alter table public.erp_company_settings
  add column if not exists po_footer_address_text text;

-- Update GRN posting RPC to align with inventory ledger constraints
create or replace function public.erp_post_grn(p_grn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_grn record;
  v_po_no text;
  v_over_count integer;
  v_total_lines integer;
  v_received_lines integer;
begin
  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Only owner/admin can post GRNs';
  end if;

  select * into v_grn
    from public.erp_grns
   where id = p_grn_id
     and company_id = v_company_id
   for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted';
  end if;

  select po.po_no
    into v_po_no
    from public.erp_purchase_orders po
   where po.id = v_grn.purchase_order_id
     and po.company_id = v_company_id;

  select count(*) into v_over_count
    from public.erp_grn_lines gl
    join public.erp_purchase_order_lines pol on pol.id = gl.purchase_order_line_id
   where gl.grn_id = p_grn_id
     and pol.company_id = v_company_id
     and (pol.received_qty + abs(gl.received_qty)) > pol.ordered_qty;

  if v_over_count > 0 then
    raise exception 'GRN quantities exceed ordered quantities';
  end if;

  select count(*) into v_total_lines
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and abs(gl.received_qty) > 0;

  if v_total_lines = 0 then
    raise exception 'GRN has no lines to post';
  end if;

  update public.erp_purchase_order_lines pol
     set received_qty = pol.received_qty + abs(gl.received_qty),
         updated_at = now(),
         updated_by = auth.uid()
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and pol.id = gl.purchase_order_line_id
     and pol.company_id = v_company_id
     and abs(gl.received_qty) > 0;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    gl.warehouse_id,
    gl.variant_id,
    abs(gl.received_qty),
    'purchase_in',
    case
      when v_po_no is not null then 'PO ' || v_po_no
      else null
    end,
    'GRN:' || p_grn_id::text,
    auth.uid(),
    now()
  from public.erp_grn_lines gl
  where gl.grn_id = p_grn_id
    and abs(gl.received_qty) > 0;

  select count(*) into v_total_lines
    from public.erp_purchase_order_lines pol
   where pol.purchase_order_id = v_grn.purchase_order_id
     and pol.company_id = v_company_id;

  select count(*) into v_received_lines
    from public.erp_purchase_order_lines pol
   where pol.purchase_order_id = v_grn.purchase_order_id
     and pol.company_id = v_company_id
     and pol.received_qty >= pol.ordered_qty;

  update public.erp_purchase_orders po
     set status = case
       when v_total_lines > 0 and v_total_lines = v_received_lines then 'received'
       else 'partially_received'
     end,
         updated_at = now(),
         updated_by = auth.uid()
   where po.id = v_grn.purchase_order_id
     and po.company_id = v_company_id;

  update public.erp_grns
     set status = 'posted',
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_grn_id
     and company_id = v_company_id;

  return jsonb_build_object('status', 'posted', 'grn_id', p_grn_id);
end;
$$;

revoke all on function public.erp_post_grn(uuid) from public;
grant execute on function public.erp_post_grn(uuid) to authenticated;
