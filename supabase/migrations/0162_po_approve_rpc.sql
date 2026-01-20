-- RPC to approve draft purchase orders
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
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select company_id, status
    into v_company_id, v_status
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
      and cu.role_key in ('owner', 'admin', 'procurement')
  ) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'draft' then
    raise exception 'Purchase order is not in draft status';
  end if;

  update public.erp_purchase_orders
     set status = 'approved',
         updated_at = now()
   where id = p_po_id
     and company_id = v_company_id;

  return query
  select po.id, po.status
  from public.erp_purchase_orders po
  where po.id = p_po_id;
end;
$$;

revoke all on function public.erp_proc_po_approve(uuid) from public;
grant execute on function public.erp_proc_po_approve(uuid) to authenticated;
