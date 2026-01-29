# Final Settlement Phase 2A Notes

## Existing tables
- `public.erp_hr_final_settlements` (header)
- `public.erp_hr_final_settlement_items` (lines)
- `public.erp_hr_final_settlement_clearances` (checklist)

## Existing RPCs (before Phase 2A updates)
- `erp_hr_final_settlements_list(p_from date, p_to date, p_status text, p_query text)`
- `erp_hr_final_settlement_by_exit_get(p_exit_id uuid)`
- `erp_hr_final_settlement_get(p_exit_id uuid)` (exit-based JSON payload)
- `erp_hr_final_settlement_upsert(p_exit_id uuid, p_notes text)`
- `erp_hr_final_settlement_line_upsert(...)`
- `erp_hr_final_settlement_line_delete(...)`
- `erp_hr_final_settlement_finalize(p_settlement_id uuid)` (status -> `submitted`)
- `erp_hr_final_settlement_set_status(...)`

## Missing or changed for Phase 2A MVP
- Canonical settlement-detail getter by settlement id with employee + exit summary.
- Canonical header upsert RPC that accepts `p_settlement_id` + `p_exit_id` and prevents duplicates.
- Finalize flow that locks records with `status = 'finalized'` and captures finalized metadata.
- UI route should use settlement id (not exit id) for the detail view.
