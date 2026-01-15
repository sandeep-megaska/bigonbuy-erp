# Sprint-2F QA: Attendance → Payroll Reports

## Scope
Read-only HR reports aligning attendance with payroll runs:
- Attendance → Payroll Summary (run-based)
- Attendance Exceptions (period-based)
- Attendance Register (period-based)

## Pre-checks
- Ensure you are logged in with HR/Admin role.
- Confirm the company has at least one payroll run and attendance data for the period.

## Attendance → Payroll Summary
1. Navigate to **HR → Reports → Attendance → Payroll Summary**.
2. Select a payroll run from the dropdown.
3. Confirm the report loads rows for each employee in the payroll run.
4. Validate totals row (present, leave, paid, OT, gross, net) matches expected sums.
5. Confirm manual OT hours are sourced from payroll items only.

## Attendance Exceptions
1. Navigate to **HR → Reports → Attendance Exceptions**.
2. Pick a date range and optionally select a payroll run.
3. Verify grouped exception sections load and can be expanded.
4. Export CSV and validate that issue details are preserved.

## Attendance Register
1. Navigate to **HR → Reports → Attendance Register**.
2. Pick a date range or month.
3. Apply employee name/code filter and optional designation filter.
4. Click **Print** and confirm the layout is print-friendly (filters hidden).
5. Export CSV and confirm fields match table columns.

## Scenario Validation
### Payroll employee with no attendance
- Create/choose a payroll run that includes an employee with no attendance records in the period.
- Expected: **Attendance Exceptions** should show `payroll_missing_attendance` for that employee.
- Expected: **Attendance → Payroll Summary** shows zeros for attendance counts but still includes the employee.

### Attendance employee not in payroll
- Select a period where attendance exists for an employee not included in the payroll run.
- Expected: **Attendance Exceptions** shows `attendance_missing_in_payroll` when a run is selected.

### Days exceed calendar
- Ensure attendance marks produce `present + leave > calendar days` for an employee.
- Expected: **Attendance Exceptions** shows `attendance_days_exceed_calendar`.

## Manual OT Verification
- Confirm no attendance-derived OT is used in any report.
- Verify **Attendance → Payroll Summary** OT hours match payroll item line entries (code `OT`).
- If payroll has no OT line for an employee, manual OT hours should be 0.
