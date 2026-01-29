# Final Settlement Phase 2C Notes

## What exists today
- Tables:
  - `public.erp_hr_final_settlements` (header) with core fields: `company_id`, `exit_id`, `status`, notes, timestamps, and finalized metadata.
  - `public.erp_hr_final_settlement_items` (lines) with `kind` (`earning`/`deduction`), `amount`, notes, and ordering.
  - `public.erp_hr_final_settlement_clearances` (checklist items).
- RLS enforced on all three tables, company scoping via `erp_current_company_id()`.
- RPCs used by the UI:
  - `erp_hr_final_settlement_get` (JSON payload for detail page).
  - `erp_hr_final_settlements_list` (list view).
  - `erp_hr_final_settlement_upsert_header` (header upsert).
  - `erp_hr_final_settlement_line_upsert` / `erp_hr_final_settlement_line_delete` (line edit).
  - `erp_hr_final_settlement_finalize` (lock/finalize).

## Guardrails needed for Phase 2C
- Duplicate prevention per exit:
  - Verify if any duplicates exist before adding a DB-level unique constraint.
  - If duplicates exist, enforce uniqueness through RPC checks and log a notice for remediation.
- DB-level locking:
  - Prevent header updates, line upserts, and deletes when settlement status is not `draft`.
  - RPCs should raise a consistent `Final settlement is locked` exception.
- Consistent totals:
  - `erp_hr_final_settlement_get` should return `earnings_total`, `deductions_total`, and `net_amount` computed from line items using the same kind mapping as the list RPC (`earning/earnings/credit` vs `deduction/deductions/debit`).
- UI polish:
  - Detail page should display DB-provided totals when available and disable edits/finalize once locked.
  - List page should show consistent status labels, aligned net amount, and a clearer empty state.
