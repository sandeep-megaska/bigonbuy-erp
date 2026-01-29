# Finance Ledger Readiness Audit (Payroll → Finance Posting)

## Overview
This audit summarizes what the repo already provides for finance-ledger readiness and what is still missing before implementing Payroll → Finance Posting (Step 2). The findings are grounded in the current migrations, RPCs, and UI routes. References include the payroll finance bridge tables/RPCs, finance document numbering, settlement ledger patterns, and inventory posting flows. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L1-L920】【F:supabase/migrations/0305_payroll_finance_posting_config.sql†L1-L214】【F:supabase/migrations/0171_unify_fy_document_numbering.sql†L1-L102】【F:supabase/migrations/0181_doc_numbering_enforcement.sql†L1-L119】【F:supabase/migrations/0196_fin_settlement_ledger.sql†L1-L200】【F:supabase/migrations/0235_fix_erp_post_grn_set_legacy_qty.sql†L1-L138】

## Current Finance Data Model (what exists, where)
- **Payroll finance journal header/lines (minimal GL-style tables).**
  - `public.erp_fin_journals`: header with `company_id`, `doc_no`, `journal_date`, `status`, `reference_type/reference_id`, totals, and audit fields (`created_at`, `created_by`). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L7-L27】
  - `public.erp_fin_journal_lines`: line items with account code/name placeholders and debit/credit checks. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L32-L51】
- **Payroll → finance posting tracking.**
  - `public.erp_payroll_finance_posts` links a payroll run to a finance document (`finance_doc_type` + `finance_doc_id`) with `status`, `posted_at`, and `posted_by_user_id`. Unique index prevents duplicate posting per payroll run. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L73-L90】
- **Payroll posting config (Phase 1 vs Phase 2).**
  - Phase 2 placeholder config (account code + name) lives in `public.erp_payroll_posting_config`. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L55-L70】
  - Phase 1 preview config uses account UUIDs (`erp_payroll_finance_posting_config`) and has RLS + RPCs for get/upsert/preview. 【F:supabase/migrations/0305_payroll_finance_posting_config.sql†L1-L214】
- **Finance-ledger-like operational tables (non-GL).**
  - Settlement ledger tables (`erp_settlement_batches`, `erp_settlement_events`, `erp_settlement_links`) store finance events and links with void metadata. 【F:supabase/migrations/0196_fin_settlement_ledger.sql†L1-L200】
  - Inventory ledger (`erp_inventory_ledger`) includes void flags and references for reversals. 【F:supabase/migrations/0231_inventory_ledger_canonical_columns.sql†L40-L74】
- **Not found in repo scan:** a dedicated chart-of-accounts table (`coa`, `gl_accounts`, etc.) or general ledger balances table; no explicit `erp_fin_ledger` table beyond journals and settlement ledgers.

## Current Posting / Journal Patterns (how other modules do it)
- **Inventory posting uses security-definer RPCs and status gating for idempotency.**
  - `erp_post_grn` posts only when a GRN is in `draft` status, inserts ledger lines, allocates doc number, and updates the GRN to `posted`. This pattern is idempotent by status + doc_no uniqueness rather than a formal idempotency key. 【F:supabase/migrations/0235_fix_erp_post_grn_set_legacy_qty.sql†L12-L121】
  - `erp_inventory_ledger_insert` is a raw insert RPC with no idempotency key or de-duplication. 【F:supabase/migrations/0180_rls_rpc_ui_writes.sql†L1027-L1087】
- **Settlement ledger event ingestion uses unique indices for de-duplication.**
  - `erp_settlement_events` has a unique index on `(company_id, platform, event_type, reference_no)` when `reference_no` is present and the row is not voided. 【F:supabase/migrations/0196_fin_settlement_ledger.sql†L118-L121】
- **Payroll posting RPCs already exist (Phase 2) but are minimal.**
  - Preview (`erp_payroll_finance_posting_preview`) computes debit/credit totals from payroll items and checks config + finalized status. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L430-L520】
  - Post (`erp_payroll_finance_post`) uses `FOR UPDATE` locking on payroll runs, checks finalized state, and short-circuits if a post already exists, then inserts journal header/lines and a finance post link. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L563-L700】

## Document Numbering & References
- **FY-based document numbering is centralized.**
  - `erp_doc_sequences` stores per-company, per-FY counters. 【F:supabase/migrations/0171_unify_fy_document_numbering.sql†L1-L29】
  - `erp_doc_allocate_number` allocates numbers as `FYxx-xx/<DOC_KEY>/000001` with row-level locks on `erp_doc_sequences`. 【F:supabase/migrations/0181_doc_numbering_enforcement.sql†L33-L114】
  - `erp_doc_no_is_valid` enforces the FY-based format. 【F:supabase/migrations/0181_doc_numbering_enforcement.sql†L1-L27】
- **Journal document key (JRN) support is added in payroll finance bridge.**
  - `erp_doc_allocate_number` is extended to handle `JRN` by reading `erp_fin_journals.journal_date`. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L275-L360】

## Security Model (RLS, SECURITY DEFINER, role guards)
- **Role guard functions for finance access.**
  - `erp_require_finance_reader()` and `erp_require_finance_writer()` gate finance RPCs to `owner/admin/finance`. 【F:supabase/migrations/0158_finance_bridge_reports.sql†L1-L30】【F:supabase/migrations/0159_expense_engine_phase1.sql†L1-L31】
- **RLS on finance/journal tables and payroll posting tables.**
  - `erp_fin_journals`, `erp_fin_journal_lines`, `erp_payroll_posting_config`, and `erp_payroll_finance_posts` enforce `company_id = erp_current_company_id()` and role checks. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L94-L236】
  - `erp_payroll_finance_posting_config` (Phase 1) has its own select/write policies. 【F:supabase/migrations/0305_payroll_finance_posting_config.sql†L1-L80】
- **Security definer RPCs.**
  - Payroll posting preview/post/get and config upserts are SECURITY DEFINER functions with explicit authorization checks. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L383-L820】【F:supabase/migrations/0305_payroll_finance_posting_config.sql†L78-L214】

## Gaps / Risks (what is missing for payroll posting)
- **No chart-of-accounts / GL master data.** Posting uses `account_code/account_name` or raw account UUIDs without validation; account master is not found in repo scan.
- **No journal UI or finance ledger list page.** Navigation contains a payroll posting settings route, but no `/erp/finance/journals` UI was found in repo scan. 【F:lib/erp/financeNav.ts†L186-L214】【F:pages/erp/finance/settings/payroll-posting.tsx†L1-L214】
- **No void/reversal RPC for finance journals.** Journals have a `status` column with `posted/void`, but no journal void RPC is present in migrations (not found in repo scan). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L7-L51】
- **Limited idempotency contract for payroll posting.** There is a unique index on `(company_id, payroll_run_id)` and a “return existing doc” guard, but no explicit external idempotency key field. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L73-L90】【F:supabase/migrations/0304_payroll_finance_bridge.sql†L597-L644】
- **No enforced debit=credit check at header level.** Totals are stored on `erp_fin_journals` but there is no database constraint ensuring `total_debit = total_credit`. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L7-L27】
- **No explicit posting lock flag on payroll runs.** Posting uses `FOR UPDATE` and checks `erp_payroll_run_is_finalized`, but there is no dedicated “posted/locked” flag on payroll runs. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L563-L618】

## Recommended Payroll Posting Contract (high level only)
> Conceptual guidance for Step 2 (no schema changes in this doc).

- **Proposed tables: `erp_payroll_finance_posts` (conceptual)**
  - Already exists and can be extended conceptually to store idempotency keys and void/reversal metadata (`voided_at`, `void_reason`) aligned with `erp_fin_journals.status`. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L73-L90】
- **Proposed RPCs: preview/post/status (conceptual)**
  - Preview: should continue to return `can_post`, config validation, totals, and draft journal lines (similar to existing preview). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L430-L520】
  - Post: should be idempotent and return the existing journal id if already posted (existing pattern). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L597-L644】
  - Status: should return posted state + journal link (existing `erp_payroll_finance_posting_get`). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L703-L820】
- **Idempotency key recommendation**
  - Use a unique key like `company_id + payroll_run_id + posting_version` or a client-supplied UUID; this complements the existing unique index on `(company_id, payroll_run_id)` and avoids double-posting when retries are more complex. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L73-L90】
- **Locking recommendation**
  - Continue `FOR UPDATE` locks on payroll runs (existing), and optionally add a “posting in progress” marker to avoid parallel posts across workers. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L563-L618】

## Acceptance Checklist for Step 2
- [ ] Journal tables exist with RLS and payroll posting link table in place (`erp_fin_journals`, `erp_fin_journal_lines`, `erp_payroll_finance_posts`). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L7-L172】
- [ ] Document numbering supports `JRN` via `erp_doc_allocate_number` and FY sequences are present (`erp_doc_sequences`). 【F:supabase/migrations/0171_unify_fy_document_numbering.sql†L1-L41】【F:supabase/migrations/0304_payroll_finance_bridge.sql†L275-L360】
- [ ] Payroll posting config uses account UUIDs (`erp_payroll_finance_posting_config`) and UI for settings exists. 【F:supabase/migrations/0305_payroll_finance_posting_config.sql†L1-L214】【F:pages/erp/finance/settings/payroll-posting.tsx†L1-L214】
- [ ] Finance role guards (`erp_require_finance_reader/writer`) and RLS policies are active for finance tables. 【F:supabase/migrations/0158_finance_bridge_reports.sql†L1-L30】【F:supabase/migrations/0159_expense_engine_phase1.sql†L1-L31】【F:supabase/migrations/0304_payroll_finance_bridge.sql†L94-L236】
- [ ] A clear idempotency policy is agreed (unique key + replay-safe RPC). Existing unique key is only `(company_id, payroll_run_id)`. 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L73-L90】
- [ ] A void/reversal plan exists (journals currently expose `status` but no void RPC found in repo scan). 【F:supabase/migrations/0304_payroll_finance_bridge.sql†L7-L27】
