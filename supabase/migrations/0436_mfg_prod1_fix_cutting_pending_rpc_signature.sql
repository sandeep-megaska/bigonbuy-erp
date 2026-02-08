-- 0436_mfg_prod1_fix_cutting_pending_rpc_signature.sql
-- Resilient RPC for ERP UI: returns cutting events pending consumption.
-- IMPORTANT: Must not fail migration even if MFG-PROD-1 tables were not created yet.
-- So we use dynamic SQL and table-existence checks.

create or replace function public.erp_mfg_cutting_stage_events_pending_list_v1(
  p_company_id uuid,
  p_limit integer default 100,
  p_vendor_id uuid default null
) returns table(
  stage_event_id uuid,
  vendor_id uuid,
  vendor_name text,
  po_line_id uuid,
  po_id uuid,
  po_number text,
  sku text,
  completed_qty_delta numeric(18,6),
  created_at timestamptz,
  consumption_status text,
  consumption_batch_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_has_events boolean;
  v_has_batches boolean;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  -- If the MFG-PROD-1 tables are not present yet, return empty set (migration-safe).
  select to_regclass('public.erp_mfg_po_line_stage_events') is not null into v_has_events;
  select to_regclass('public.erp_mfg_consumption_batches') is not null into v_has_batches;

  if not v_has_events then
    return; -- empty result
  end if;

  -- If batches table missing, still list events with status=pending and batch_id null.
  if not v_has_batches then
    return query execute
      format($SQL$
        with events as (
          select
            e.id as stage_event_id,
            e.company_id,
            e.vendor_id,
            e.po_line_id,
            e.po_id,
            e.completed_qty_delta,
            e.created_at
          from public.erp_mfg_po_line_stage_events e
          where e.company_id = $1
            and upper(e.stage_code) = 'CUTTING'
            and e.completed_qty_delta > 0
            and ($2::uuid is null or e.vendor_id = $2::uuid)
        )
        select
          e.stage_event_id,
          e.vendor_id,
          v.legal_name as vendor_name,
          e.po_line_id,
          e.po_id,
          coalesce(nullif(trim(po.doc_no), ''), nullif(trim(po.po_no), '')) as po_number,
          coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
          e.completed_qty_delta,
          e.created_at,
          'pending'::text as consumption_status,
          null::uuid as consumption_batch_id
        from events e
        left join public.erp_vendors v
          on v.id = e.vendor_id
         and v.company_id = e.company_id
        left join public.erp_purchase_orders po
          on po.id = e.po_id
         and po.company_id = e.company_id
        left join public.erp_purchase_order_lines pol
          on pol.id = e.po_line_id
         and pol.company_id = e.company_id
        left join public.erp_variants vr
          on vr.id = pol.variant_id
         and vr.company_id = e.company_id
        order by e.created_at desc
        limit %s
      $SQL$, v_limit)
    using p_company_id, p_vendor_id;

    return;
  end if;

  -- Normal case: both tables exist
  return query execute
    format($SQL$
      with events as (
        select
          e.id as stage_event_id,
          e.company_id,
          e.vendor_id,
          e.po_line_id,
          e.po_id,
          e.completed_qty_delta,
          e.created_at,
          b.id as consumption_batch_id,
          b.status as batch_status
        from public.erp_mfg_po_line_stage_events e
        left join public.erp_mfg_consumption_batches b
          on b.stage_event_id = e.id
        where e.company_id = $1
          and upper(e.stage_code) = 'CUTTING'
          and e.completed_qty_delta > 0
          and ($2::uuid is null or e.vendor_id = $2::uuid)
      )
      select
        e.stage_event_id,
        e.vendor_id,
        v.legal_name as vendor_name,
        e.po_line_id,
        e.po_id,
        coalesce(nullif(trim(po.doc_no), ''), nullif(trim(po.po_no), '')) as po_number,
        coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
        e.completed_qty_delta,
        e.created_at,
        coalesce(e.batch_status, 'pending') as consumption_status,
        e.consumption_batch_id
      from events e
      left join public.erp_vendors v
        on v.id = e.vendor_id
       and v.company_id = e.company_id
      left join public.erp_purchase_orders po
        on po.id = e.po_id
       and po.company_id = e.company_id
      left join public.erp_purchase_order_lines pol
        on pol.id = e.po_line_id
       and pol.company_id = e.company_id
      left join public.erp_variants vr
        on vr.id = pol.variant_id
       and vr.company_id = e.company_id
      order by e.created_at desc
      limit %s
    $SQL$, v_limit)
  using p_company_id, p_vendor_id;

end;
$$;

revoke all on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, integer, uuid) from public;
grant execute on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, integer, uuid) to authenticated, service_role;

-- Ask PostgREST to reload schema cache (Supabase)
select pg_notify('pgrst', 'reload schema');
