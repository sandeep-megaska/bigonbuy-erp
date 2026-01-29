# HR Exit Record Fix Notes

## Scope

Phase A inspection notes for exit records, exit list, and employee profile exit flow.

## Exit tables and columns

**Primary table:** `public.erp_hr_employee_exits`

Key columns (subset):
- `id` (uuid, PK)
- `company_id`
- `employee_id`
- `exit_type_id`
- `exit_reason_id`
- `initiated_by_user_id`
- `status`
- `initiated_on`
- `last_working_day`
- `notice_period_days`
- `notice_waived`
- `manager_employee_id`
- `approved_by_user_id`, `approved_at`
- `rejected_by_user_id`, `rejected_at`, `rejection_reason`
- `completed_by_user_id`, `completed_at`
- `notes`
- `payment_notes`
- `created_at`, `updated_at`

Reference: base exit workflow table definition in `0122_employee_exit_workflow.sql`, with later status additions in `0124_hr_employee_exit_workflow_v2.sql`.

Related tables:
- `public.erp_hr_employee_exit_types`
- `public.erp_hr_employee_exit_reasons`

## RPCs related to exits

### Exits list (`/pages/erp/hr/exits/index.tsx`)
- **Data source:** direct `select` on `erp_hr_employee_exits` with joins to employee, manager, exit type, and exit reason.
- **Mutations:** `erp_hr_exit_set_status` for approve/reject/complete actions.

### Exit detail (`/pages/erp/hr/exits/[id].tsx`)
- **Data source:** `erp_hr_exit_get` RPC
- **Mutations:** `erp_hr_exit_set_status` for approve/reject/complete actions.

### Employee profile exit modal (`/pages/erp/hr/employees/[id]/index.js`)
- **Mutation:** `erp_hr_employee_exit_finalize` RPC (prior to this fix) which inserts a completed exit and marks employee lifecycle status as exited.

## Filters and visibility

- Exits list currently filters by **status** (server-side) and **employee search** (client-side).
- No month filter existed prior to this fix.
- Result visibility can be limited by status filter (e.g., `status=draft`) and employee search text.
