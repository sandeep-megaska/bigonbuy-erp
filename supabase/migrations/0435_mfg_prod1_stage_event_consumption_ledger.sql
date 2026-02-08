-- IMPORTANT:
-- Do NOT CREATE OR REPLACE erp_vendor_readiness_list_v1 because Postgres forbids changing return type.
-- Create v2 with the extended return columns instead.

create or replace function public.erp_vendor_readiness_list_v2(
  p_company_id uuid,
  p_from date default null,
  p_to date default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  vendor_code text,
  readiness_status text,
  reasons text[],
  open_po_lines integer,
  bom_missing_skus integer,
  shortage_materials integer,
  cutting_events_pending_consumption integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Not authorized for this company';
  end if;

  return query
  with vendor_base as (
    select
      v.id as vendor_id,
      v.legal_name as vendor_name,
      v.vendor_code,
      coalesce(v.is_active, false) as vendor_is_active,
      coalesce(v.portal_enabled, false) as portal_enabled,
      lower(coalesce(v.portal_status, '')) as portal_status
    from public.erp_vendors v
    where v.company_id = p_company_id
  ), open_line_sku as (
    select
      po.vendor_id,
      pol.id as po_line_id,
      coalesce(nullif(trim(vr.sku), ''), '') as sku,
      greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as open_qty
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.company_id = po.company_id
     and pol.purchase_order_id = po.id
    left join public.erp_variants vr
      on vr.company_id = po.company_id
     and vr.id = pol.variant_id
    where po.company_id = p_company_id
      and coalesce(lower(po.status), '') in ('open', 'issued', 'approved', 'partially_received')
      and greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) > 0
      and (p_from is null or po.order_date >= p_from)
      and (p_to is null or po.order_date <= p_to)
      and nullif(trim(vr.sku), '') is not null
  ), open_line_counts as (
    select
      o.vendor_id,
      count(*)::integer as open_po_lines
    from open_line_sku o
    group by o.vendor_id
  ), bom_missing as (
    select
      o.vendor_id,
      count(distinct lower(o.sku))::integer as bom_missing_skus
    from open_line_sku o
    left join public.erp_mfg_boms b
      on b.company_id = p_company_id
     and b.vendor_id = o.vendor_id
     and lower(b.sku) = lower(o.sku)
     and b.status = 'active'
    where b.id is null
    group by o.vendor_id
  ), demand_by_material as (
    select
      o.vendor_id,
      bl.material_id,
      sum(o.open_qty * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric as demand_qty_next
    from open_line_sku o
    join public.erp_mfg_boms b
      on b.company_id = p_company_id
     and b.vendor_id = o.vendor_id
     and lower(b.sku) = lower(o.sku)
     and b.status = 'active'
    join public.erp_mfg_bom_lines bl
      on bl.company_id = b.company_id
     and bl.vendor_id = b.vendor_id
     and bl.bom_id = b.id
    group by o.vendor_id, bl.material_id
  ), shortage_rollup as (
    select
      mb.vendor_id,
      count(*) filter (
        where (coalesce(mb.on_hand_qty, 0) - coalesce(dm.demand_qty_next, 0)) < 0
      )::integer as shortage_materials,
      count(*) filter (
        where (coalesce(mb.on_hand_qty, 0) - coalesce(dm.demand_qty_next, 0)) <= coalesce(mb.reorder_point, 0)
      )::integer as near_reorder_materials
    from public.erp_mfg_material_balances_v mb
    left join demand_by_material dm
      on dm.vendor_id = mb.vendor_id
     and dm.material_id = mb.material_id
    where mb.company_id = p_company_id
      and mb.is_active = true
    group by mb.vendor_id
  ), pending_cutting as (
    select
      e.vendor_id,
      count(*)::integer as cutting_events_pending_consumption
    from public.erp_mfg_po_line_stage_events e
    left join public.erp_mfg_consumption_batches b
      on b.stage_event_id = e.id
    where e.company_id = p_company_id
      and upper(e.stage_code) = 'CUTTING'
      and e.completed_qty_delta > 0
      and b.id is null
    group by e.vendor_id
  ), merged as (
    select
      vb.vendor_id,
      vb.vendor_name,
      vb.vendor_code,
      vb.vendor_is_active,
      vb.portal_enabled,
      vb.portal_status,
      coalesce(olc.open_po_lines, 0) as open_po_lines,
      coalesce(bm.bom_missing_skus, 0) as bom_missing_skus,
      coalesce(sr.shortage_materials, 0) as shortage_materials,
      coalesce(sr.near_reorder_materials, 0) as near_reorder_materials,
      coalesce(pc.cutting_events_pending_consumption, 0) as cutting_events_pending_consumption
    from vendor_base vb
    left join open_line_counts olc
      on olc.vendor_id = vb.vendor_id
    left join bom_missing bm
      on bm.vendor_id = vb.vendor_id
    left join shortage_rollup sr
      on sr.vendor_id = vb.vendor_id
    left join pending_cutting pc
      on pc.vendor_id = vb.vendor_id
  )
  select
    m.vendor_id,
    m.vendor_name,
    m.vendor_code,
    case
      when not m.vendor_is_active
        or not m.portal_enabled
        or m.portal_status not in ('active', 'enabled')
      then 'red'
      when m.shortage_materials > 2 then 'red'
      when m.bom_missing_skus > 0
        or m.shortage_materials > 0
        or m.near_reorder_materials > 0
        or m.cutting_events_pending_consumption > 0
      then 'amber'
      else 'green'
    end as readiness_status,
    array_remove(array[
      case when not m.vendor_is_active then 'Vendor is inactive' end,
      case when not m.portal_enabled then 'Vendor portal is disabled' end,
      case when m.portal_enabled and m.portal_status not in ('active', 'enabled') then 'Vendor portal status is not active' end,
      case when m.bom_missing_skus > 0 then format('Missing active BOM for %s open PO SKU(s)', m.bom_missing_skus) end,
      case when m.shortage_materials > 2 then format('Severe shortages across %s materials', m.shortage_materials) end,
      case when m.shortage_materials between 1 and 2 then format('Shortages across %s materials', m.shortage_materials) end,
      case when m.shortage_materials = 0 and m.near_reorder_materials > 0 then format('%s materials are at or below reorder point', m.near_reorder_materials) end,
      case when m.cutting_events_pending_consumption > 0 then format('%s cutting stage event(s) pending consumption posting', m.cutting_events_pending_consumption) end
    ], null)::text[] as reasons,
    m.open_po_lines,
    m.bom_missing_skus,
    m.shortage_materials,
    m.cutting_events_pending_consumption
  from merged m
  order by
    case
      when not m.vendor_is_active
        or not m.portal_enabled
        or m.portal_status not in ('active', 'enabled')
      then 1
      when m.shortage_materials > 2 then 1
      when m.bom_missing_skus > 0
        or m.shortage_materials > 0
        or m.near_reorder_materials > 0
        or m.cutting_events_pending_consumption > 0
      then 2
      else 3
    end,
    lower(m.vendor_name);
end;
$$;
-- Safe privilege wiring: only revoke/grant if the exact function signature exists.
do $$
begin
  -- erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_mfg_po_line_stage_post_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_session_token text, p_po_line_id uuid, p_stage_code text, p_completed_qty_abs numeric, p_event_note text, p_client_event_id uuid'
  ) then
    execute 'revoke all on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) from public';
    execute 'grant execute on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) to anon';
  end if;

  -- erp_mfg_stage_consumption_preview_v1(uuid)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_mfg_stage_consumption_preview_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_stage_event_id uuid'
  ) then
    execute 'revoke all on function public.erp_mfg_stage_consumption_preview_v1(uuid) from public';
    execute 'grant execute on function public.erp_mfg_stage_consumption_preview_v1(uuid) to authenticated, service_role';
  end if;

  -- erp_mfg_stage_consumption_post_v1(uuid, uuid, text)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_mfg_stage_consumption_post_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_stage_event_id uuid, p_actor_user_id uuid, p_reason text'
  ) then
    execute 'revoke all on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) from public';
    execute 'grant execute on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) to authenticated, service_role';
  end if;

  -- erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_mfg_stage_consumption_reverse_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_consumption_batch_id uuid, p_actor_user_id uuid, p_reason text, p_client_reverse_id uuid'
  ) then
    execute 'revoke all on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid) from public';
    execute 'grant execute on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid) to authenticated, service_role';
  end if;

  -- erp_mfg_cutting_stage_events_pending_list_v1(uuid, uuid, integer)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_mfg_cutting_stage_events_pending_list_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_vendor_id uuid, p_limit integer'
  ) then
    execute 'revoke all on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, uuid, integer) from public';
    execute 'grant execute on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, uuid, integer) to authenticated, service_role';
  end if;

  -- readiness list v2 (if you added it)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_vendor_readiness_list_v2'
      and pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_from date, p_to date'
  ) then
    execute 'revoke all on function public.erp_vendor_readiness_list_v2(uuid, date, date) from public';
    execute 'grant execute on function public.erp_vendor_readiness_list_v2(uuid, date, date) to authenticated';
  end if;

end $$;

