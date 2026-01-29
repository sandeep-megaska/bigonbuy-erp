# Payroll → Finance Bridge: Existing Schema & Patterns

## Payroll module (runs/items/payslips)

### Payroll runs
- **Table:** `public.erp_payroll_runs` (table referenced across payroll RPCs/UI).
- **Key columns (observed):** `id`, `company_id`, `year`, `month`, `status`, `notes`, `finalized_at`, `finalized_by`, `attendance_period_status`, `attendance_snapshot_at`. These are used by the run APIs and finalize workflow. 【F:pages/api/erp/payroll/runs/get.ts†L4-L67】【F:supabase/migrations/0074_payroll_finalize_and_lock.sql†L8-L141】【F:supabase/migrations/0062_fix_payroll_run_create_columns.sql†L1-L48】
- **Lifecycle/status:** `draft → generated → finalized`, enforced by `erp_payroll_runs_status_check` and `erp_payroll_run_finalize` which sets `finalized_at/finalized_by`. Finalized runs are locked from edits. 【F:supabase/migrations/0074_payroll_finalize_and_lock.sql†L8-L226】

### Payroll items + lines
- **Table:** `public.erp_payroll_items` (referenced by payroll item RPCs).
- **Key columns (observed):** `id`, `company_id`, `payroll_run_id`, `employee_id`, `salary_basic`, `salary_hra`, `salary_allowances`, `gross`, `deductions`, `net_pay`. These fields drive the item recalculation and status checks. 【F:supabase/migrations/0086_payroll_run_items_status.sql†L1-L177】【F:supabase/migrations/0074_payroll_finalize_and_lock.sql†L152-L226】
- **Lines table:** `public.erp_payroll_item_lines` with `code`, `units`, `rate`, `amount`, `notes`, and payroll-item FK. Used for OT/earnings/deductions lines. 【F:supabase/migrations/0058_payroll_item_lines.sql†L1-L74】

### Payslips
- **Tables:** `public.erp_payroll_payslips` + `public.erp_payroll_payslip_lines` created for finalized payroll runs. Includes `payroll_run_id`, `payroll_item_id`, `employee_id`, totals, and line breakdowns. 【F:supabase/migrations/0087_payroll_payslips.sql†L1-L188】

### Payroll RPCs (existing)
- **Run create/generate:** `erp_payroll_run_create`, `erp_payroll_run_generate`, `erp_payroll_run_finalize` (finalize/lock). 【F:supabase/migrations/0061_payroll_run_generate_create.sql†L1-L75】【F:supabase/migrations/0074_payroll_finalize_and_lock.sql†L55-L105】
- **Authorization:** `erp_require_payroll_writer()` enforces payroll-role access for payroll writes. 【F:supabase/migrations/0061_payroll_run_generate_create.sql†L9-L41】

---

## Finance module (existing tables + document numbering)

### Core finance tables present
- **Expenses:** `erp_expense_categories` and `erp_expenses` (finance-managed). 【F:supabase/migrations/0159_expense_engine_phase1.sql†L10-L159】
- **Notes:** `erp_notes`, `erp_note_lines`, `erp_note_number_sequences`, `erp_note_settlements` (credit/debit notes). 【F:supabase/migrations/0166_erp_notes.sql†L1-L96】
- **Invoices:** `erp_invoices` and related invoice flows (invoice MVP). 【F:supabase/migrations/0189_invoices_mvp.sql†L1-L71】
- **Settlement ledger:** `erp_settlement_batches`, `erp_settlement_events`, `erp_settlement_links` (finance-ledger-like operational tables). 【F:supabase/migrations/0196_fin_settlement_ledger.sql†L1-L119】

### Finance authorization helpers
- `erp_require_finance_reader()` and `erp_require_finance_writer()` are the standard finance access guards. 【F:supabase/migrations/0158_finance_bridge_reports.sql†L3-L30】【F:supabase/migrations/0159_expense_engine_phase1.sql†L4-L31】

### Document numbering
- Finance document numbering uses `erp_doc_allocate_number(p_doc_id, p_doc_key)` and `erp_doc_sequences` (FY-based numbering) with enforced doc-key validation for standard docs (PO/GRN/CN/DN). 【F:supabase/migrations/0181_doc_numbering_enforcement.sql†L31-L118】

---

## Existing finance posting pattern (cross-module)
- Other modules generally **write via SECURITY DEFINER RPCs**, with finance access enforced in-function and RLS enabled on tables (ex: expenses/notes/invoices). 【F:supabase/migrations/0159_expense_engine_phase1.sql†L4-L31】【F:supabase/migrations/0166_erp_notes.sql†L160-L235】
- There is **no existing general ledger / journal table** in migrations; finance records are currently modeled via expenses, notes, invoices, and settlement ledger tables. 【F:supabase/migrations/0159_expense_engine_phase1.sql†L10-L159】【F:supabase/migrations/0166_erp_notes.sql†L1-L96】【F:supabase/migrations/0196_fin_settlement_ledger.sql†L1-L119】

---

## Gaps for payroll → finance bridge
- **No existing journal/GL document tables** to post payroll runs into (needs a minimal journal model or explicit finance doc table for payroll postings). 【F:supabase/migrations/0159_expense_engine_phase1.sql†L10-L159】【F:supabase/migrations/0166_erp_notes.sql†L1-L96】
- **No payroll-to-finance posting RPC** exists yet; posting must be added as new SECURITY DEFINER functions with finance authorization. 【F:supabase/migrations/0159_expense_engine_phase1.sql†L4-L31】
- **Document numbering support** currently doesn’t include a journal doc key; adding a journal doc key is needed if we introduce journal headers. 【F:supabase/migrations/0181_doc_numbering_enforcement.sql†L31-L118】
