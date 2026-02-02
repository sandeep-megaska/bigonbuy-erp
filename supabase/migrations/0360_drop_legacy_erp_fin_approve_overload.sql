-- 0360_drop_legacy_erp_fin_approve_overload.sql
-- Kill broken overload so only canonical signature exists

drop function if exists public.erp_fin_approve(uuid, text, uuid, text);
