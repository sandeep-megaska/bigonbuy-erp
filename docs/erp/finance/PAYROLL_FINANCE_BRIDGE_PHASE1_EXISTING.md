# Payroll → Finance Bridge Phase 1 (Existing Finance Model)

## Finance document model

**Journals**
- `public.erp_fin_journals` is the finance header table for journal entries.
  - Stores `company_id`, `doc_no`, `journal_date`, `status`, `narration`, `reference_type`, and `reference_id`.
  - Totals are captured in `total_debit` and `total_credit`.
- `public.erp_fin_journal_lines` stores journal lines for each journal.
  - Each line has `account_code`, `account_name`, `description`, `debit`, and `credit`.

**Payroll → Finance tracking**
- `public.erp_payroll_finance_posts` stores a link between a payroll run and a finance document once posting is enabled in Phase 2.
  - References `finance_doc_type` (currently `journal`) and `finance_doc_id`.
  - Includes `meta` for document numbers and other metadata.

## Account table + how accounts are selected

No dedicated chart-of-accounts table is present in the migrations. The existing payroll finance bridge uses a lightweight config table:
- `public.erp_payroll_posting_config` stores **account code + name** placeholders (`salary_expense_account_code/name`, `payroll_payable_account_code/name`).

Phase 1 introduces a new config table for account **IDs** (UUIDs):
- `public.erp_payroll_finance_posting_config` will store `salary_expense_account_id`, `payroll_payable_account_id`, and `default_cost_center_id` per company.
- These account IDs are supplied directly via configuration UI (no account table lookup is available in this repo).

## Phase 2 target posting

When posting is enabled in Phase 2, payroll runs will target:
- `public.erp_fin_journals` for the journal header (one per payroll run).
- `public.erp_fin_journal_lines` for debit/credit lines.
- `public.erp_payroll_finance_posts` to link the payroll run to the finance document and prevent duplicate posting.

The preview in Phase 1 produces the same debit/credit structure without writing to any finance tables.
