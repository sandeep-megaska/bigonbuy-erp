-- 0218_fix_gst_purchase_invoices_list_rpc_ambiguity.sql

drop function if exists public.erp_gst_purchase_invoices_list(date, date, uuid);

-- (Re)create the canonical 4-arg function if needed (optional if already correct)
-- Ensure grants exist:
revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) from public;
grant execute on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) to authenticated;
