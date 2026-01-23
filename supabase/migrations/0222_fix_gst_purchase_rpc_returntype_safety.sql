-- 0222_fix_gst_purchase_rpc_returntype_safety.sql
-- Ensure GST Purchase Phase-2B RPCs are safe to redeploy if return types change.
-- Forward-only, audit-safe.

drop function if exists public.erp_gst_purchase_revalidate_range(date, date);
drop function if exists public.erp_gst_purchase_invoice_void(uuid, text);
drop function if exists public.erp_vendor_state_code_from_gstin(text);

-- No CREATE here on purpose:
-- The canonical definitions live in 0220.
-- If you ever need to change return types, add a new migration that DROP+CREATE
-- the affected function(s) in the same migration.
