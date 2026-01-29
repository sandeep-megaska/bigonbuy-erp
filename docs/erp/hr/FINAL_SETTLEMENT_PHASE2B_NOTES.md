# Final Settlement Phase 2B Notes

## Relevant schema (list view)
- `public.erp_hr_final_settlements`
  - `id`, `company_id`, `exit_id`, `status`
  - `created_at`, `updated_at`
  - status metadata columns: `submitted_at`, `approved_at`, `paid_at`, `finalized_at`
- `public.erp_hr_final_settlement_items`
  - `settlement_id`, `kind`, `amount`
- `public.erp_hr_employee_exits`
  - `id`, `employee_id`, `last_working_day`
- `public.erp_employees`
  - `id`, `employee_code`, `full_name`

## Net amount computation
- The items table enforces `kind in ('earning', 'deduction')`, so net can be computed as:
  - `sum(earning amounts) - sum(deduction amounts)`.
- If additional kind aliases appear in data, map them to the same earning/deduction buckets.

## RPC inventory
- Existing list RPC (pre-Phase 2B): `erp_hr_final_settlements_list(p_from date, p_to date, p_status text, p_query text)`.
- Detail RPCs (Phase 2A): `erp_hr_final_settlement_get`, `erp_hr_final_settlement_upsert_header`, `erp_hr_final_settlement_finalize`.
- Phase 2B need: canonical list RPC with `p_month`, `p_status`, `p_query` and `YYYY-MM` month filtering, so the existing date-range list RPC needs replacement.
