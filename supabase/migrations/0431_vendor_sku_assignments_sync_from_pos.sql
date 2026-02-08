-- 0431_vendor_sku_assignments_sync_from_pos.sql
-- Auto-assign vendor SKUs from historical purchase orders.

create or replace function public.erp_vendor_sku_assignments_sync_from_pos_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_since date default null
)
returns table (
  inserted_count integer,
  updated_count integer,
  total_distinct_skus integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted integer := 0;
  v_updated integer := 0;
  v_total integer := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized: owner/admin only';
  end if;

  if not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = p_company_id
  ) then
    raise exception 'Vendor not found for this company';
  end if;

  with po_skus as (
    select distinct trim(vr.sku) as sku
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.purchase_order_id = po.id
     and pol.company_id = po.company_id
    join public.erp_variants vr
      on vr.id = pol.variant_id
     and vr.company_id = po.company_id
    where po.company_id = p_company_id
      and po.vendor_id = p_vendor_id
      and po.status in ('approved', 'partially_received', 'received')
      and (p_since is null or po.order_date >= p_since)
      and nullif(trim(vr.sku), '') is not null
  ), inserted as (
    insert into public.erp_vendor_sku_assignments (
      company_id,
      vendor_id,
      sku,
      is_active,
      source,
      created_by
    )
    select
      p_company_id,
      p_vendor_id,
      ps.sku,
      true,
      'po_auto',
      v_actor
    from po_skus ps
    on conflict (company_id, vendor_id, sku) do nothing
    returning sku
  ), updated as (
    update public.erp_vendor_sku_assignments a
       set is_active = true,
           source = 'po_auto'
      from po_skus ps
     where a.company_id = p_company_id
       and a.vendor_id = p_vendor_id
       and a.sku = ps.sku
       and (a.is_active is distinct from true or a.source is distinct from 'po_auto')
    returning a.sku
  )
  select
    (select count(*)::integer from inserted),
    (select count(*)::integer from updated),
    (select count(*)::integer from po_skus)
  into v_inserted, v_updated, v_total;

  return query
  select v_inserted, v_updated, v_total;
end;
$$;

revoke all on function public.erp_vendor_sku_assignments_sync_from_pos_v1(uuid, uuid, date) from public;
grant execute on function public.erp_vendor_sku_assignments_sync_from_pos_v1(uuid, uuid, date) to authenticated;
grant execute on function public.erp_vendor_sku_assignments_sync_from_pos_v1(uuid, uuid, date) to service_role;
