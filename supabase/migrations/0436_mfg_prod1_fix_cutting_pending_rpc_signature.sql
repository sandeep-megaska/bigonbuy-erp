-- 0436_mfg_prod1_fix_cutting_pending_rpc_signature.sql
-- Fix Supabase RPC resolution: UI calls erp_mfg_cutting_stage_events_pending_list_v1(company_id, limit, vendor_id)
-- Existing function is (company_id, vendor_id, limit). Add overload wrapper (uuid, integer, uuid).

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
language sql
security definer
set search_path = public
as $$
  select *
  from public.erp_mfg_cutting_stage_events_pending_list_v1(
    p_company_id,
    p_vendor_id,
    p_limit
  );
$$;

-- Lock down + allow expected roles
revoke all on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid,_
