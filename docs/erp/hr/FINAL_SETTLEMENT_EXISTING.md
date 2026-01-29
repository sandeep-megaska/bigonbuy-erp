# Final Settlement — Existing Schema & RPCs

## Tables

### `public.erp_hr_final_settlements`
- **Keys**: `id` (PK), `exit_id` (unique FK to `erp_hr_employee_exits`), `company_id` (FK to `erp_companies`).
- **Status**: `status` constrained to `draft`, `submitted`, `approved`, `paid`.
- **Fields**: `notes`, `submitted_at/by`, `approved_at/by`, `paid_at/by`, `payment_mode`, `payment_reference`, `created_at`, `updated_at`.
- **Relationship**: 1:1 with employee exit via `exit_id` (unique).

### `public.erp_hr_final_settlement_items`
- **Keys**: `id` (PK), `settlement_id` (FK to `erp_hr_final_settlements`), `company_id`.
- **Fields**: `kind` (`earning`/`deduction`), `code`, `name`, `amount`, `notes`, `sort_order`, `created_at`, `updated_at`.
- **Relationship**: many line items per settlement.

### `public.erp_hr_final_settlement_clearances`
- **Keys**: `id` (PK), `settlement_id` (FK to `erp_hr_final_settlements`), `company_id`.
- **Fields**: `department`, `item`, `is_done`, `done_at/by`, `notes`, `sort_order`, timestamps.
- **Relationship**: optional clearance checklist rows per settlement.

## Existing RPCs (from applied migrations)

### `public.erp_hr_final_settlement_get(p_exit_id uuid) -> json`
- Returns: JSON with `settlement`, `items`, `clearances` by `exit_id` (company scoped).
- Permission: `SECURITY DEFINER` with company scoping via `erp_current_company_id()`.
- **Used by**: currently no references in the codebase.

### `public.erp_hr_final_settlement_upsert(p_exit_id uuid, p_notes text)`
- Creates or updates a **draft** settlement header for an approved/completed exit.
- Prevents edits when status is not `draft`.
- Permission: HR admin only via `erp_is_hr_admin`.
- **Used by**: currently no references in the codebase.

### `public.erp_hr_final_settlement_set_status(p_settlement_id uuid, p_status text, p_payment_mode text, p_payment_reference text)`
- Moves status through `draft` → `submitted` → `approved` → `paid`.
- Requires exit status `approved`/`completed`.
- Permission: HR admin only via `erp_is_hr_admin`.
- **Used by**: currently no references in the codebase.

### `public.erp_hr_final_settlements_list(p_from date, p_to date, p_status text, p_query text) -> table`
- Lists settlements with employee + exit metadata and aggregated totals (earnings/deductions/net) for the index UI.

### `public.erp_hr_final_settlement_line_upsert(...) -> uuid`
- Inserts or updates settlement line items (earning/deduction).
- Enforces draft-only edits.

### `public.erp_hr_final_settlement_line_delete(p_settlement_id uuid, p_line_id uuid)`
- Deletes a line item for a draft settlement.

### `public.erp_hr_final_settlement_finalize(p_settlement_id uuid)`
- Finalizes draft settlement by setting status to `submitted`.

### `public.erp_hr_final_settlement_by_exit_get(p_exit_id uuid) -> uuid`
- Returns settlement id for a given exit.

## Gaps Identified
- `erp_hr_final_settlement_get` continues to be exit-id based (not settlement-id based). UI routes should pass exit id accordingly.

## Recommended Minimal Additions
- No table changes required; keep status enum (`draft`/`submitted`/`approved`/`paid`) intact to avoid breaking existing workflow.
