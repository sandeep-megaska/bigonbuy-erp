# Attendance month override — existing computed totals

## Current computed fields and sources

### Daily source table
- Attendance is stored in `public.erp_hr_attendance_days`, keyed by `company_id`, `employee_id`, and `day` with `status` values constrained to `present`, `absent`, `weekly_off`, `holiday`, and `leave` (plus later `unmarked`).【F:supabase/migrations/0031_hr_attendance_leave_foundation.sql†L33-L57】
- Time metrics and `day_fraction`/`ot_minutes` are attached to each day in `erp_hr_attendance_days`, with non-negative constraints for minutes and `day_fraction` in `{0.5, 1.0}`.【F:supabase/migrations/0107_attendance_time_metrics_and_shifts.sql†L3-L44】

### Month summary (attendance grid)
- `public.erp_hr_attendance_monthly_summary_v` is a month aggregation directly from `erp_hr_attendance_days` and counts per-status days: present, leave, absent, holiday, weekly off, and unmarked.【F:supabase/migrations/0103_attendance_rpcs_generate_mark_freeze.sql†L439-L459】

### Payroll-oriented month summary (attendance + leave types)
- `public.erp_attendance_payroll_month_summary_v` aggregates attendance using the **official payroll logic**:
  - `present_days` uses `day_fraction` for `status = 'present'`.
  - `leave_paid_days` and `leave_unpaid_days` are derived from leave request/type payability when the day is `status = 'leave'` or `source = 'leave'`.
  - `absent_days`, `holiday_days`, `weekly_off_days`, and `unmarked_days` are counted as 1 per day.
  - `lop_days = absent + unpaid leave`; `payable_days = present + paid leave + holiday + weekly off`.
  - Attendance period status (open/frozen) is joined for reporting.【F:supabase/migrations/0110_attendance_payroll_month_summary_view.sql†L1-L83】

### OT minutes (computed from attendance days)
- The OT minutes used by attendance metrics come from `erp_hr_attendance_days.ot_minutes`. The existing OT aggregation view `erp_payroll_attendance_inputs_v` sums `ot_minutes` for present days, but it is distinct from the payroll snapshot logic below.【F:supabase/migrations/0107_attendance_time_metrics_and_shifts.sql†L3-L44】【F:supabase/migrations/0109_payroll_attendance_ot_inputs_view.sql†L1-L21】

## What payroll currently consumes
- Payroll snapshots are attached via `public.erp_payroll_run_attach_attendance`, which **pulls from** `erp_attendance_payroll_month_summary_v` and stores:
  - `present_days_suggested`
  - `paid_leave_days_suggested`
  - `unpaid_leave_days_suggested`
  - `lop_days_suggested`
  - `payable_days_suggested`
- The attendance period status is also copied onto the payroll run record during the snapshot attach.【F:supabase/migrations/0111_payroll_attach_attendance_snapshot.sql†L1-L76】

## Status and source conventions used today
- Status values include `present`, `absent`, `weekly_off`, `holiday`, and `leave` (plus `unmarked` in later attendance workflows).【F:supabase/migrations/0031_hr_attendance_leave_foundation.sql†L33-L57】【F:supabase/migrations/0103_attendance_rpcs_generate_mark_freeze.sql†L439-L459】
- Leave payability is determined by leave request/type metadata and can override attendance-day `status` via `source = 'leave'` in the payroll month summary logic.【F:supabase/migrations/0110_attendance_payroll_month_summary_view.sql†L1-L38】
