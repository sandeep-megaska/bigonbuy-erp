# Payroll schema audit (Sprint 3 Phase 0)

## Scope & sources
This audit is based on the repository’s Supabase migrations and the UI/RPC usage in the payroll screens and APIs (no live DB introspection was performed in this environment).【F:supabase/migrations/0061_payroll_run_generate_create.sql†L1-L16】【F:supabase/migrations/0067_payroll_items_legacy_basic_cols.sql†L1-L58】【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L1-L26】【F:supabase/migrations/0058_payroll_item_lines.sql†L1-L36】【F:pages/api/hr/payroll/items/list.ts†L1-L92】【F:pages/api/hr/payroll/runs/get.ts†L1-L80】

## A) Actual tables (as defined/altered in migrations)

### `public.erp_payroll_runs`
**Observed columns** (from insert/update/alter usage in migrations):
- `id` (uuid, implied by foreign keys and inserts)
- `company_id`
- `year`, `month`
- `status`
- `notes`
- `created_at`
- `finalized_at`, `finalized_by`
- `attendance_month`, `attendance_period_status`, `attendance_snapshot_at`, `attendance_snapshot_by`

Sources: run create RPC and finalize workflow, plus attendance snapshot migration.【F:supabase/migrations/0062_fix_payroll_run_create_columns.sql†L1-L49】【F:supabase/migrations/0074_payroll_finalize_and_lock.sql†L1-L76】【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L1-L26】

### `public.erp_payroll_items`
**Observed columns** (from alter/insert/update usage in migrations and RPCs):
- `id` (uuid, implied by FKs)
- `company_id`
- `payroll_run_id`
- `employee_id`
- `salary_basic`, `salary_hra`, `salary_allowances`
- `basic`, `hra`, `allowances` (legacy sync columns)
- `gross`, `deductions`, `net_pay`
- `notes`
- `created_at`
- Attendance snapshot fields: `payable_days_suggested`, `lop_days_suggested`, `present_days_suggested`, `paid_leave_days_suggested`, `unpaid_leave_days_suggested`, `attendance_source`, `payable_days_override`, `lop_days_override`

Sources: payroll generate/recalc functions, legacy column sync, and attendance snapshot migration.【F:supabase/migrations/0061_payroll_run_generate_create.sql†L1-L19】【F:supabase/migrations/0067_payroll_items_legacy_basic_cols.sql†L1-L58】【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L9-L26】【F:supabase/migrations/0115_payroll_proration_effective_days.sql†L58-L156】

### `public.erp_payroll_item_lines`
**Definition** (created in migrations):
- `id`, `company_id`, `payroll_item_id`
- `code`, `name`, `units`, `rate`, `amount`, `notes`
- `created_at`, `created_by`, `updated_at`, `updated_by`

Source: table creation in migration 0058.【F:supabase/migrations/0058_payroll_item_lines.sql†L1-L18】

### `public.erp_hr_attendance_periods` (attendance link)
Payroll uses attendance periods and summaries for proration and snapshots.

**Definition (subset used by payroll)**:
- `company_id`, `month`, `status`, `created_at`, `updated_at` (from attendance period table)

Source: attendance periods migration and payroll snapshot RPC.【F:supabase/migrations/0102_attendance_periods_and_constraints.sql†L1-L15】【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L33-L76】

## B) What UI/RPC expects today

### Payroll run APIs
- **Runs list** expects: `id`, `year`, `month`, `status`, `finalized_at`, `notes`.【F:pages/api/hr/payroll/runs/list.ts†L5-L56】
- **Run detail** expects: `id`, `year`, `month`, `status`, `finalized_at`, `finalized_by`, `notes`, `attendance_period_status`, `attendance_snapshot_at`.【F:pages/api/hr/payroll/runs/get.ts†L5-L80】

### Payroll items API
- **Items list** (used by payroll run detail screen) expects fields including `gross`, `deductions`, `net_pay`, `notes`, `payslip_no`, `payable_days`, `lop_days`, `payable_days_override`, `lop_days_override`, plus salary columns (`salary_*` and legacy `basic/hra/allowances`).【F:pages/api/hr/payroll/items/list.ts†L5-L86】
- **Payroll run detail UI** displays `payable_days` and `lop_days` columns for each item row.【F:pages/erp/hr/payroll/runs/[id].js†L776-L784】

## C) Mismatches found

1) **`payable_days` / `lop_days` missing in DB schema**
- UI/API expects `payable_days` and `lop_days`, but migrations only define `payable_days_suggested` / `lop_days_suggested` with override fields (no `payable_days` / `lop_days` columns exist).【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L9-L26】【F:pages/api/hr/payroll/items/list.ts†L5-L86】

2) **Salary columns split between canonical (`salary_*`) and legacy (`basic/hra/allowances`)**
- Canonical columns are `salary_basic`, `salary_hra`, `salary_allowances`; legacy columns exist for backward compatibility and are synced by trigger, so this is *not* a breaking mismatch but is relevant for documentation and reads.【F:supabase/migrations/0061_payroll_run_generate_create.sql†L9-L13】【F:supabase/migrations/0067_payroll_items_legacy_basic_cols.sql†L1-L58】

## D) Canonical column decisions

- **Payroll items canonical salary fields**: `salary_basic`, `salary_hra`, `salary_allowances` remain canonical. Legacy `basic/hra/allowances` are kept via sync trigger for backward compatibility (no change).【F:supabase/migrations/0061_payroll_run_generate_create.sql†L9-L13】【F:supabase/migrations/0067_payroll_items_legacy_basic_cols.sql†L1-L58】
- **Payable days canonical fields**: use `payable_days_suggested`/`lop_days_suggested` plus `*_override` for effective value. Rather than introducing new DB columns, the API now exposes `payable_days` and `lop_days` computed from override → suggested to match UI expectations without altering the DB schema.【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L9-L26】【F:pages/api/hr/payroll/items/list.ts†L55-L91】

## E) Fix applied (minimal)
- Adjusted the payroll items API to fetch `payable_days_suggested` / `lop_days_suggested` and return `payable_days` / `lop_days` as derived values (override if set, else suggested), eliminating the runtime SQL error caused by selecting non-existent columns while keeping the UI contract stable.【F:pages/api/hr/payroll/items/list.ts†L55-L91】

## F) Remaining notes
- No finance module changes and no new finance tables were added (per constraints).
- No migrations were added because the schema mismatch was resolved at the API layer instead of altering the DB schema.
