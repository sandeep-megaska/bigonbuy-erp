-- 0437_mfg_prod1_fix_stage_post_rpc_visibility_signature.sql
-- Fix Vendor Portal RPC resolution:
-- UI calls erp_mfg_po_line_stage_post_v1(client_event_id, completed_qty_abs, event_note, po_line_id, session_token, stage_code)
-- Ensure that signature exists and is executable by anon.

create or replace function public.erp_mfg_po_line_stage_post_v1(
  p_client_event_id uuid,
  p_completed_qty_abs numeric,
  p_event_note text,
  p_po_line_id uuid,
  p_session_token text,
  p_stage_code text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Delegate to canonical implementation (the “real” one) if it exists.
  -- If your canonical function is the one you wrote earlier:
  --   erp_mfg_po_line_stage_post_v1(p_session_token, p_po_line_id, p_stage_code, p_completed_qty_abs, p_event_note, p_client_event_id)
  return public.erp_mfg_po_line_stage_post_v1(
    p_session_token,
    p_po_line_id,
    p_stage_code,
    p_completed_qty_abs,
    p_event_note,
    p_client_event_id
  );
end;
$$;

-- Permissions: Vendor portal uses anon + cookie session token
revoke all on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) from public;
grant execute on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) to anon;

-- Also allow service_role just in case (safe)
grant execute on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) to service_role;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
