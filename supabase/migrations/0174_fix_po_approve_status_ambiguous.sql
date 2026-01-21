-- Fix ambiguous status references in PO approval RPC
create or replace function public.erp_proc_po_approve(p_po_id uuid)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_status text;
  v_doc_no text;
  v_order_date date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select po.company_id, po.status, po.doc_no, po.order_date
    into v_company_id, v_status, v_doc_no, v_order_date
    from public.erp_purchase_orders po
    where po.id = p_po_id
    for update;

  if v_company_id is null then
    raise exception 'Purchase order not found';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'procurement')
  ) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'draft' then
    raise exception 'Purchase order is not in draft status';
  end if;

  if v_doc_no is null then
    v_doc_no := public.erp_doc_allocate_number('PO', coalesce(v_order_date, current_date));
  end if;

  update public.erp_purchase_orders po
     set po.status = 'approved',
         doc_no = coalesce(po.doc_no, v_doc_no),
         po_no = coalesce(po.po_no, v_doc_no),
         updated_at = now()
   where po.id = p_po_id
     and po.company_id = v_company_id;

  return query
  select po.id, po.status
  from public.erp_purchase_orders po
  where po.id = p_po_id;
end;
$$;

revoke all on function public.erp_proc_po_approve(uuid) from public;
grant execute on function public.erp_proc_po_approve(uuid) to authenticated;

-- Smoke test (manual):
-- 1) create draft PO
-- 2) select * from public.erp_proc_po_approve('<po_id>');
-- 3) verify erp_purchase_orders.status = 'approved'
