-- 0387_marketplace_settlement_on_conflict_keys.sql
-- Fix 42P10 by adding non-partial unique indexes that match ON CONFLICT targets.

begin;

-- 1) Batches: allow ON CONFLICT (company_id, channel_id, batch_ref)
-- Non-partial unique index required (partial indexes don't match ON CONFLICT column lists).
create unique index if not exists erp_marketplace_settlement_batches_company_channel_batch_ref_uk
on public.erp_marketplace_settlement_batches (company_id, channel_id, batch_ref);

-- 2) Txns: allow ON CONFLICT (company_id, batch_id, row_hash)
create unique index if not exists erp_marketplace_settlement_txns_company_batch_row_hash_uk
on public.erp_marketplace_settlement_txns (company_id, batch_id, row_hash);

commit;
