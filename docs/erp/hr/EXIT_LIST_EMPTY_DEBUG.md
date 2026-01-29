# HR Exits list empty debug notes

## Current list implementation (before fix)
- UI: `pages/erp/hr/exits/index.tsx` loads exits using `supabase.from("erp_hr_employee_exits")` with a client-side `.select(...)` and optional status filter. It does **not** enforce company scoping via `erp_current_company_id()` and relies on client-side joins to `erp_employees`/exit metadata. (Source: page file inspection.)
- Source table used: `public.erp_hr_employee_exits` (direct table read).

## Why it can return empty
- RLS: direct table access can be blocked by row-level security, which results in empty results or permission errors in the UI.
- Company scoping: the current query does not apply `erp_current_company_id()` server-side, so company filtering depends on client-side RLS policy correctness.
- Filter mismatch: only status is applied server-side, while month/employee search are client-side, which can be misleading if the returned rows are already empty.

## Confirmed canonical table
- The exits data is stored in `public.erp_hr_employee_exits` and the DB already has completed rows for the current company. The new canonical list RPC should read from this table with `erp_current_company_id()` scoping.
