-- 0188_doc_sequences_trigger_cleanup.sql
-- Remove redundant / unsafe triggers, keep only canonical legacy_all trigger

drop trigger if exists trg_erp_doc_sequences_sync_legacy on public.erp_doc_sequences;
drop function if exists public.erp_doc_sequences_sync_legacy();

drop trigger if exists trg_erp_doc_sequences_sync_fy_label on public.erp_doc_sequences;
drop function if exists public.erp_doc_sequences_sync_fy_label();
