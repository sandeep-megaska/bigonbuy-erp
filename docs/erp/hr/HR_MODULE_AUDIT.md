# BIGONBUY ERP — HR Module Audit (Documentation Only)

## 1) Executive Summary

### HR modules present today
- **HR Home/Dashboard** (quick actions, status cards, company setup reminder).
- **Employee directory & profile management** (add/edit employees, manager assignment, role assignment, user linking, profile tabs, salary assignment, document uploads, exits).
- **HR Masters** (departments, designations, locations, employment types; employee titles, genders, exit types, exit reasons).
- **Attendance** (monthly generation, marking, per-day edits, freeze status; shifts, location shifts, calendars, weekly off rules).
- **Leave** (legacy leave page; dedicated leave types + leave requests pages with preview/submit/approve workflows).
- **Payroll** (salary structures, components, OT rules; payroll runs, items, overrides, OT lines, payslips).
- **Reports** (attendance register, attendance exceptions, attendance/payroll summary, attendance/payroll reconciliation view).
- **Roles & Access** (HR roles CRUD, employee logins linkage).
- **Schema viewer** (dev-only schema inspector page).

### What appears complete vs partial vs planned
- **Relatively complete**: employee lifecycle basics (create → assign job/salary → attendance → payroll → exit), HR masters, attendance workflows, payroll run generation & payslips, role access enforcement.
- **Partial/overlapping**: leave has both a legacy page (`/erp/hr/leave`) and newer pages (`/erp/hr/leaves/*`); recruitment module not found; some data tables exist without UI (e.g., final settlements, statutory/bank profiles, emergency contacts).
- **Planned/DB-only**: final settlement tables & RPCs exist, but no UI/API wiring found in HR routes.

### Constraints / assumptions observed in code & migrations
- **Company scoping**: nearly all HR data is scoped by `company_id` with RLS and helpers like `erp_current_company_id()` and `erp_require_hr_writer()` / `erp_is_hr_admin()` (RLS enforced across HR tables).
- **RPC-heavy UI writes**: HR pages invoke Supabase RPCs for writes (e.g., `erp_hr_*` functions), especially for masters, attendance, exits, and payroll.
- **Role enforcement**: UI gates HR actions by role (`owner/admin/hr/payroll`) and the backend enforces the same via RLS and security definer RPCs.


## 2) Navigation Map (UI Routes)

> **All routes under `/pages/erp/hr/**`**

| Route | Page file | Purpose | Key actions | Calls these APIs/RPCs |
|---|---|---|---|---|
| `/erp/hr` | `pages/erp/hr/index.tsx` | HR landing page with metrics & quick actions | View HR status cards; jump to common workflows | `supabase.from('erp_employees')`, `supabase.from('erp_hr_attendance_days')`, `supabase.from('erp_payroll_runs')` |
| `/erp/hr/attendance` | `pages/erp/hr/attendance/index.tsx` | Monthly attendance marking | Generate month; bulk mark; edit per-day status; recompute; freeze/lock | `erp_attendance_generate_month`, `erp_attendance_mark_bulk`, `erp_attendance_mark`, `erp_attendance_upsert_check_times`, `erp_hr_attendance_day_status_update`, `erp_attendance_recompute_month` |
| `/erp/hr/calendars` | `pages/erp/hr/calendars/index.tsx` | Attendance calendars list | View calendars; link to new/edit | `supabase.from('erp_calendars')` |
| `/erp/hr/calendars/new` | `pages/erp/hr/calendars/new.tsx` | Create a calendar | Save calendar; set default | `erp_hr_calendar_upsert`, `erp_hr_calendar_set_default` |
| `/erp/hr/calendars/[id]` | `pages/erp/hr/calendars/[id].tsx` | Edit calendar | Update calendar; add/remove holidays; map locations; set default | `erp_hr_calendar_upsert`, `erp_hr_calendar_set_default`, `erp_hr_calendar_holiday_create`, `erp_hr_calendar_holiday_delete`, `erp_hr_calendar_location_add`, `erp_hr_calendar_location_delete` |
| `/erp/hr/employee-logins` | `pages/erp/hr/employee-logins.js` | Link employees to auth users | Invite/link employee login via email | `/api/hr/link-employee-user` → `erp_link_employee_login` |
| `/erp/hr/employees` | `pages/erp/hr/employees.js` | Employee directory | Create/edit employee; assign manager; assign role; link user | RPCs: `erp_hr_employees_list`, `erp_hr_employees_managers_list`, `erp_hr_employee_upsert`, `erp_hr_employee_assign_manager`, `erp_hr_assign_user_role`, `erp_hr_employee_link_user`, `erp_hr_employee_profile_update`; API: `/api/hr/employees/job` |
| `/erp/hr/employees/[id]` | `pages/erp/hr/employees/[id]/index.js` | Employee profile (tabs) | Overview; Job; Contacts; Addresses; Documents; Exit; Salary | APIs: `/api/hr/employees/[id]`, `/api/hr/employees/job-history`, `/api/hr/masters`, `/api/hr/employees/documents`, `/api/hr/employees/documents/upload-url`; RPCs: `erp_employee_profile`, `erp_employee_salary_current`, `erp_employee_salary_assign`, `erp_hr_employee_activate`, `erp_hr_employee_exit_finalize` |
| `/erp/hr/exits` | `pages/erp/hr/exits/index.tsx` | Exit requests list | Filter by status; approve/reject/complete exits | RPC: `erp_hr_exit_set_status` (via `supabase.rpc`) |
| `/erp/hr/exits/[id]` | `pages/erp/hr/exits/[id].tsx` | Exit request detail | View exit; set status transitions | RPCs: `erp_hr_exit_get`, `erp_hr_exit_set_status` |
| `/erp/hr/leave` | `pages/erp/hr/leave.js` | Legacy leave management | Create leave types & requests; approve/reject | RPCs: `erp_leave_type_upsert`, `erp_leave_request_submit`, `erp_leave_request_set_status` |
| `/erp/hr/leaves/types` | `pages/erp/hr/leaves/types.tsx` | Leave types (new) | Create/edit leave types | RPC: `erp_hr_leave_type_upsert` |
| `/erp/hr/leaves/requests` | `pages/erp/hr/leaves/requests.tsx` | Leave requests (new) | Draft/preview/submit requests; approve/reject/cancel | RPCs: `erp_leave_request_preview`, `erp_leave_request_decide`, `erp_hr_leave_request_draft_upsert`, `erp_leave_request_submit`, `erp_leave_request_cancel` |
| `/erp/hr/location-shifts` | `pages/erp/hr/location-shifts.tsx` | Assign shifts to locations | Create location shifts | RPC: `erp_hr_location_shift_create` |
| `/erp/hr/masters` | `pages/erp/hr/masters.js` | Core HR masters | Manage departments, designations, locations, employment types | RPCs: `erp_hr_departments_list`, `erp_hr_designations_list`, `erp_hr_locations_list`, `erp_hr_employment_types_list`, `erp_hr_department_upsert`, `erp_hr_designation_upsert`, `erp_hr_location_upsert`, `erp_hr_employment_type_upsert` |
| `/erp/hr/masters/employee-titles` | `pages/erp/hr/masters/employee-titles.tsx` | Employee titles master | Create/activate titles | RPCs: `erp_hr_employee_title_upsert`, `erp_hr_employee_title_set_active` |
| `/erp/hr/masters/employee-genders` | `pages/erp/hr/masters/employee-genders.tsx` | Employee genders master | Create/activate genders | RPCs: `erp_hr_employee_gender_upsert`, `erp_hr_employee_gender_set_active` |
| `/erp/hr/masters/employee-exit-types` | `pages/erp/hr/masters/employee-exit-types.tsx` | Exit types master | Create/activate exit types | RPCs: `erp_hr_employee_exit_type_upsert`, `erp_hr_employee_exit_type_set_active` |
| `/erp/hr/masters/employee-exit-reasons` | `pages/erp/hr/masters/employee-exit-reasons.tsx` | Exit reasons master | Create/activate exit reasons | RPCs: `erp_hr_employee_exit_reason_upsert`, `erp_hr_employee_exit_reason_set_active` |
| `/erp/hr/payroll` | `pages/erp/hr/payroll.js` | Redirect to payroll runs | Redirect | None |
| `/erp/hr/payroll/runs` | `pages/erp/hr/payroll/runs/index.js` | Payroll run list | Create payroll runs | `/api/hr/payroll/runs/list`, `/api/hr/payroll/runs/create` (RPC-backed) |
| `/erp/hr/payroll/runs/[id]` | `pages/erp/hr/payroll/runs/[id].js` | Payroll run detail | Generate items, OT overrides, attendance attach, finalize | API: `/api/hr/payroll/runs/get`, `/api/hr/payroll/items/list`, `/api/hr/payroll/item-lines/list`, `/api/hr/payroll/item-lines/upsert`; RPCs: `erp_payroll_run_items_status`, `erp_payroll_run_payslips`, `erp_payroll_run_attach_attendance`, `erp_payroll_item_override_update`, `erp_payroll_run_finalize` |
| `/erp/hr/payroll/payslips/[id]` | `pages/erp/hr/payroll/payslips/[id].js` | Payslip detail | View payslip; download PDF | RPC: `erp_payslip_get`; API: `/api/hr/payslips/[id]/pdf` |
| `/erp/hr/payslips/[runId]/[employeeId]` | `pages/erp/hr/payslips/[runId]/[employeeId].js` | Payslip view (run/employee) | View printable payslip | `supabase.from('erp_payroll_runs')`, `supabase.from('erp_employees')`, `supabase.from('erp_payroll_items')` |
| `/erp/hr/reports/attendance-exceptions` | `pages/erp/hr/reports/attendance-exceptions.tsx` | Attendance exceptions report | Filter exceptions | RPC: `erp_report_attendance_exceptions` |
| `/erp/hr/reports/attendance-payroll-summary` | `pages/erp/hr/reports/attendance-payroll-summary.tsx` | Attendance/payroll summary | Summarize attendance vs payroll | RPC: `erp_report_attendance_payroll_summary` |
| `/erp/hr/reports/attendance-payroll` | `pages/erp/hr/reports/attendance-payroll.tsx` | Attendance vs payroll reconciliation | Reconciliation view | `erp_attendance_payroll_reconciliation_v` view (via report RPC) |
| `/erp/hr/reports/attendance-register` | `pages/erp/hr/reports/attendance-register.tsx` | Attendance register | Printable register | RPC: `erp_report_attendance_register` |
| `/erp/hr/roles` | `pages/erp/hr/roles.js` | Role administration | Create/update/delete roles | API: `/api/hr/roles/*` → `erp_hr_role_create/update/delete` |
| `/erp/hr/salary` | `pages/erp/hr/salary.js` | Salary structure setup | Create/update structures, components, OT rules | RPCs: `erp_salary_structure_upsert`, `erp_salary_structure_component_upsert`, `erp_salary_structure_ot_rule_upsert` |
| `/erp/hr/schema` | `pages/erp/hr/schema.tsx` | Schema inspector (dev tool) | Inspect schema columns | RPC: `erp_dev_schema_columns` |
| `/erp/hr/shifts` | `pages/erp/hr/shifts.tsx` | Shift master | Create/edit shifts | RPC: `erp_hr_shift_upsert` |
| `/erp/hr/weekly-off` | `pages/erp/hr/weekly-off/index.tsx` | Weekly off rules | Create/delete weekly-off rules (by location/employee) | RPCs: `erp_hr_weekly_off_rule_create`, `erp_hr_weekly_off_rule_delete` |


## 3) Data Model Inventory (Tables / Views)

> **Sources:** Supabase migrations + usage in HR pages/API. Grouped by masters, transactions, and link tables.

### A) Masters
| Table | Purpose | Key columns (top 8–12) | Relationships | RLS notes |
|---|---|---|---|---|
| `erp_hr_departments` | Department master | `id`, `company_id`, `name`, `code`, `is_active`, `created_at`, `updated_at`, `created_by`, `updated_by` | Referenced by `erp_employee_jobs.department_id` | RLS: company scoped; HR admin write |
| `erp_hr_designations` | Designation master | `id`, `company_id`, `name`, `code`, `description`, `is_active`, `created_at`, `updated_at` | Referenced by `erp_employee_jobs.designation_id`, `erp_employees.designation_id` | RLS: company scoped; HR admin write |
| `erp_hr_grades` | Grade master | `id`, `company_id`, `name`, `code`, `is_active`, `created_at`, `updated_at` | Referenced by `erp_employee_jobs.grade_id` | RLS: company scoped; HR admin write |
| `erp_hr_locations` | Location master | `id`, `company_id`, `name`, `code`, `country`, `state`, `city`, `is_active` | Referenced by `erp_employee_jobs.location_id`, `erp_hr_location_shifts` | RLS: company scoped; HR admin write |
| `erp_hr_cost_centers` | Cost center master | `id`, `company_id`, `name`, `code`, `is_active`, `created_at`, `updated_at` | Referenced by `erp_employee_jobs.cost_center_id` | RLS: company scoped; HR admin write |
| `erp_hr_employment_types` | Employment type master | `id`, `company_id`, `key`, `name`, `is_active`, `created_at`, `updated_at` | Referenced by `erp_employees.employment_type_id` | RLS: company scoped; HR admin write |
| `erp_hr_job_titles` | Job title master (legacy) | `id`, `company_id`, `title`, `level`, `is_active`, `created_at`, `updated_at` | Referenced by job upsert RPCs | RLS: company scoped; HR admin write |
| `erp_hr_employee_titles` | Title master | `id`, `company_id`, `code`, `name`, `sort_order`, `is_active` | Referenced by `erp_employees.title_id` | RLS: company scoped; HR admin write |
| `erp_hr_employee_genders` | Gender master | `id`, `company_id`, `code`, `name`, `sort_order`, `is_active` | Referenced by `erp_employees.gender_id` | RLS: company scoped; HR admin write |
| `erp_hr_employee_exit_types` | Exit type master | `id`, `company_id`, `code`, `name`, `sort_order`, `is_active` | Referenced by `erp_hr_employee_exits.exit_type_id` | RLS: company scoped; HR admin write |
| `erp_hr_employee_exit_reasons` | Exit reason master | `id`, `company_id`, `code`, `name`, `sort_order`, `is_active` | Referenced by `erp_hr_employee_exits.exit_reason_id` | RLS: company scoped; HR admin write |
| `erp_hr_leave_types` | Leave type master | `id`, `company_id`, `key`, `name`, `is_paid`, `is_active`, `allows_half_day`, `requires_approval`, `counts_weekly_off`, `counts_holiday`, `display_order` | Referenced by `erp_hr_leave_requests.leave_type_id` | RLS: company scoped; HR admin write |
| `erp_hr_shifts` | Shift master | `id`, `company_id`, `code`, `name`, `start_time`, `end_time`, `break_minutes`, `grace_minutes`, `min_half_day_minutes`, `min_full_day_minutes`, `ot_after_minutes`, `is_night_shift`, `is_active` | Referenced by `erp_hr_employee_shifts`, `erp_hr_location_shifts` | RLS: company scoped; HR admin write |
| `erp_calendars` | Attendance calendars | `id`, `company_id`, `code`, `name`, `timezone`, `is_default`, `created_at`, `updated_at` | Linked via `erp_calendar_locations`, `erp_calendar_holidays` | RLS: company scoped; HR admin write |
| `erp_salary_structures` | Salary structures (company templates) | `id`, `company_id`, `name`, `code`, `currency`, `is_active`, `basic_pct`, `hra_pct_of_basic`, `allowances_mode`, `effective_from`, `created_at` | Referenced by salary assignments & payroll items | RLS: company scoped; HR/payroll write |
| `erp_salary_structure_components` | Salary structure components | `id`, `company_id`, `structure_id`, `code`, `name`, `component_type`, `calc_mode`, `value`, `is_active` | FK to `erp_salary_structures` | RLS: company scoped; HR/payroll write |
| `erp_salary_structure_ot_rules` | OT rules per structure | `id`, `company_id`, `structure_id`, `ot_type`, `multiplier`, `base`, `hours_per_day`, `is_active` | FK to `erp_salary_structures` | RLS: company scoped; HR/payroll write |

### B) Transactions
| Table | Purpose | Key columns (top 8–12) | Relationships | RLS notes |
|---|---|---|---|---|
| `erp_employees` | Employee master record | `id`, `company_id`, `employee_code`, `employee_no`, `full_name`, `work_email`, `personal_email`, `phone`, `joining_date`, `lifecycle_status`, `manager_employee_id`, `designation_id`, `title_id`, `gender_id`, `employment_type_id`, `created_at`, `updated_at` | Self-FK for manager; references to HR masters | RLS: company scoped; self-read, HR/admin write |
| `erp_employee_contacts` | Employee contacts | `id`, `company_id`, `employee_id`, `contact_type`, `email`, `phone`, `is_primary`, `created_at`, `updated_at` | FK to `erp_employees` | RLS: HR reader + self | 
| `erp_employee_addresses` | Employee addresses | `id`, `company_id`, `employee_id`, `address_type`, `line1`, `city`, `state`, `postal_code`, `country`, `is_primary`, `created_at`, `updated_at` | FK to `erp_employees` | RLS: HR reader + self |
| `erp_employee_emergency_contacts` | Employee emergency contacts | `id`, `company_id`, `employee_id`, `full_name`, `relationship`, `phone`, `email`, `is_primary` | FK to `erp_employees` | RLS: HR reader + self |
| `erp_employee_documents` | Employee documents | `id`, `company_id`, `employee_id`, `doc_type`, `file_name`, `storage_path`, `notes`, `is_deleted`, `created_at`, `updated_at` | FK to `erp_employees`; storage bucket `erp-employee-docs` | RLS: HR reader; limited self-view |
| `erp_employee_jobs` | Effective-dated job history | `id`, `company_id`, `employee_id`, `effective_from`, `effective_to`, `manager_employee_id`, `department_id`, `designation_id`, `grade_id`, `location_id`, `cost_center_id`, `notes`, `created_at` | FK to `erp_employees` + masters | RLS: HR reader + self |
| `erp_employee_compensations` | Effective-dated compensation | `id`, `company_id`, `employee_id`, `salary_structure_id`, `effective_from`, `effective_to`, `currency`, `gross_annual`, `notes` | FK to `erp_employees`, `erp_salary_structures` | RLS: payroll/HR write |
| `erp_employee_compensation_components` | Compensation overrides | `id`, `company_id`, `employee_compensation_id`, `component_id`, `amount`, `percentage`, `is_override` | FK to compensation + salary components | RLS: payroll/HR write |
| `erp_employee_statutory` | Statutory details | `id`, `company_id`, `employee_id`, `pan`, `uan`, `pf_number`, `esic_number`, `professional_tax_number` | FK to `erp_employees` | RLS: HR/admin write |
| `erp_employee_bank_accounts` | Bank accounts | `id`, `company_id`, `employee_id`, `bank_name`, `branch_name`, `account_number`, `ifsc_code`, `account_type`, `is_primary` | FK to `erp_employees` | RLS: payroll/HR write |
| `erp_hr_attendance_days` | Daily attendance | `id`, `company_id`, `employee_id`, `day`, `status`, `check_in_at`, `check_out_at`, `notes`, `source`, `work_minutes`, `late_minutes`, `early_leave_minutes`, `ot_minutes`, `day_fraction`, `shift_id` | FK to `erp_employees`, `erp_hr_shifts` | RLS: company scoped; HR/admin write |
| `erp_hr_attendance_periods` | Attendance periods (month) | `id`, `company_id`, `month_start`, `status`, `frozen_at`, `frozen_by` | Linked to attendance days | RLS: company scoped; HR/admin write |
| `erp_hr_leave_requests` | Leave requests | `id`, `company_id`, `employee_id`, `leave_type_id`, `date_from`, `date_to`, `status`, `submitted_at`, `approver_user_id`, `decided_at`, `decision_note` | FK to employees + leave types | RLS: company scoped; HR reader + self |
| `erp_hr_leave_request_days` | Leave day splits | `id`, `company_id`, `leave_request_id`, `leave_date`, `day_fraction`, `is_weekly_off`, `is_holiday` | FK to `erp_hr_leave_requests` | RLS: company scoped; HR reader + self |
| `erp_weekly_off_rules` | Weekly off rules | `id`, `company_id`, `scope_type`, `location_id`, `employee_id`, `weekday`, `week_of_month`, `is_off`, `effective_from`, `effective_to` | FK to locations/employees | RLS: company scoped; HR admin write |
| `erp_hr_location_shifts` | Shift assignment by location | `id`, `company_id`, `location_id`, `shift_id`, `effective_from`, `effective_to` | FK to locations + shifts | RLS: company scoped; HR admin write |
| `erp_hr_employee_shifts` | Shift assignment by employee | `id`, `company_id`, `employee_id`, `shift_id`, `effective_from`, `effective_to` | FK to employees + shifts | RLS: company scoped; HR admin write |
| `erp_hr_employee_exits` | Exit requests & lifecycle | `id`, `company_id`, `employee_id`, `exit_type_id`, `exit_reason_id`, `status`, `initiated_on`, `last_working_day`, `notice_period_days`, `notice_waived`, `notes`, `approved_by`, `completed_by` | FK to employees + exit masters | RLS: company scoped; HR admin write |
| `erp_hr_final_settlements` | Final settlement header | `id`, `company_id`, `exit_id`, `status`, `total_amount`, `notes` | FK to `erp_hr_employee_exits` | RLS: company scoped |
| `erp_hr_final_settlement_items` | Settlement line items | `id`, `company_id`, `settlement_id`, `item_type`, `amount`, `notes`, `status` | FK to settlement | RLS: company scoped |
| `erp_hr_final_settlement_clearances` | Clearance tasks | `id`, `company_id`, `settlement_id`, `department`, `status`, `notes` | FK to settlement | RLS: company scoped |
| `erp_payroll_runs` | Payroll run header | `id`, `company_id`, `year`, `month`, `status`, `attendance_period_id`, `attendance_period_status`, `notes`, `finalized_at` | FK to attendance periods | RLS: company scoped; payroll/HR write |
| `erp_payroll_items` | Payroll item per employee | `id`, `company_id`, `payroll_run_id`, `employee_id`, `basic`, `hra`, `allowances`, `gross`, `deductions`, `net_pay`, `payable_days`, `lop_days`, `*_override`, `payslip_no` | FK to runs + employees | RLS: company scoped; payroll/HR write |
| `erp_payroll_item_lines` | Payroll variable lines | `id`, `company_id`, `payroll_item_id`, `code`, `units`, `rate`, `amount`, `notes` | FK to payroll items | RLS: company scoped; payroll/HR write |
| `erp_payroll_payslips` | Payslip header | `id`, `company_id`, `payroll_run_id`, `payroll_item_id`, `employee_id`, `payslip_no`, `gross`, `deductions`, `net_pay`, `notes` | FK to runs/items/employees | RLS: company scoped; payroll/HR read |
| `erp_payroll_payslip_lines` | Payslip line items | `id`, `company_id`, `payslip_id`, `code`, `name`, `amount` | FK to payslips | RLS: company scoped; payroll/HR read |

### C) Link tables & views
| Table/View | Purpose | Key columns | Relationships | Notes |
|---|---|---|---|---|
| `erp_employee_users` | Employee ↔ auth user mapping | `company_id`, `employee_id`, `user_id`, `email`, `is_active` | FK to employees/auth.users | Used by employee login linking |
| `erp_company_users` | User ↔ company membership | `company_id`, `user_id`, `role_key`, `is_active` | FK to companies/roles | Primary access control |
| `erp_calendar_holidays` | Calendar holidays | `calendar_id`, `holiday_date`, `name`, `type` | FK to calendars | Used by attendance calendar |
| `erp_calendar_locations` | Calendar ↔ location mapping | `calendar_id`, `location_id` | FK to calendars + locations | Used by attendance calendar |
| `erp_employee_current_jobs` (view) | Current job snapshot | `employee_id`, `department_id`, `designation_id`, `location_id`, `manager_employee_id` | From `erp_employee_jobs` | Used for job summaries |
| `erp_employee_current_compensation` (view) | Current compensation snapshot | `employee_id`, `salary_structure_id`, `effective_from`, `gross_annual` | From `erp_employee_compensations` | Payroll generation input |
| `erp_payroll_eligible_employees_v` (view) | Employees eligible for payroll | `company_id`, `employee_id`, `full_name`, `employee_code` | Joins employees + status | Used in payroll run UI |
| `erp_payroll_attendance_inputs_v` (view) | Attendance inputs to payroll | Attendance day aggregates | Joins attendance days, leave days | Used for OT/attendance calcs |
| `erp_hr_attendance_monthly_summary_v` (view) | Monthly attendance summary | `employee_id`, `month`, `present/absent/leave` counts | Aggregates attendance | Used in reports |
| `erp_attendance_payroll_month_summary_v` (view) | Attendance vs payroll summary | `employee_id`, `month`, `attendance`, `payroll` | Used in reports |
| `erp_attendance_payroll_reconciliation_v` (view) | Attendance vs payroll reconciliation | `employee_id`, `payroll_run_id`, `attendance_days`, `payable_days`, `lop_days` | Used in reports |
| `erp_attendance_month_print_v` (view) | Attendance register | `employee_id`, `day`, `status` | Used in register report |


## 4) RPC / API Contract Inventory

### HR-related RPCs (security definer)
| Function | Signature (from migrations) | Purpose | Called from which page/API | Permissions/guards |
|---|---|---|---|---|
| `erp_hr_department_upsert` | `(p_id uuid, p_name text, p_code text, p_is_active boolean)` | Upsert department | `/erp/hr/masters` | HR writer check + company scope |
| `erp_hr_designation_upsert` | `(p_id uuid, p_code text, p_name text, p_description text, p_is_active boolean)` | Upsert designation | `/erp/hr/masters` | HR writer |
| `erp_hr_location_upsert` | `(p_id uuid, p_name text, p_country text, p_state text, p_city text, p_is_active boolean)` | Upsert location | `/erp/hr/masters` | HR writer |
| `erp_hr_employment_type_upsert` | `(p_id uuid, p_key text, p_name text, p_is_active boolean)` | Upsert employment type | `/erp/hr/masters` | HR writer |
| `erp_hr_departments_list` | `()` | List departments | `/erp/hr/masters` | Company scoped select |
| `erp_hr_designations_list` | `(p_include_inactive boolean)` | List designations | `/erp/hr/masters` | Company scoped select |
| `erp_hr_locations_list` | `()` | List locations | `/erp/hr/masters` | Company scoped select |
| `erp_hr_employment_types_list` | `()` | List employment types | `/erp/hr/masters` | Company scoped select |
| `erp_hr_employee_upsert` | `(p_id uuid, p_full_name text, p_employee_code text, p_user_id uuid, p_manager_employee_id uuid, p_is_active boolean)` | Create/edit employee | `/erp/hr/employees` | HR writer |
| `erp_hr_employee_assign_manager` | `(p_employee_id uuid, p_manager_employee_id uuid)` | Assign manager | `/erp/hr/employees` | HR writer |
| `erp_hr_employee_link_user` | `(p_employee_id uuid, p_user_id uuid)` | Link employee to user | `/erp/hr/employees` | HR writer |
| `erp_hr_assign_user_role` | `(p_user_id uuid, p_role_key text)` | Assign user role | `/erp/hr/employees` | HR writer |
| `erp_hr_employee_profile_update` | `(p_employee_id uuid, p_joining_date date, p_title_id uuid, p_gender_id uuid)` | Update profile fields | `/erp/hr/employees` | HR writer |
| `erp_employee_profile` | `(p_employee_id uuid)` | Fetch employee profile + contacts | `/api/hr/employees/[id]` | Company scope + RLS |
| `erp_employee_job_upsert` | `(p_employee_id uuid, p_effective_from date, p_department_id uuid, p_designation_id uuid, p_manager_employee_id uuid, p_location_id uuid, p_grade_id uuid, p_cost_center_id uuid, p_notes text)` | Upsert job history | `/api/hr/employees/job` | HR writer |
| `erp_hr_employee_title_upsert` | `(p_id uuid, p_code text, p_name text, p_is_active boolean, p_sort_order int)` | Upsert employee title | `/erp/hr/masters/employee-titles` | HR writer |
| `erp_hr_employee_title_set_active` | `(p_id uuid, p_is_active boolean)` | Activate/deactivate title | `/erp/hr/masters/employee-titles` | HR writer |
| `erp_hr_employee_gender_upsert` | `(p_id uuid, p_code text, p_name text, p_is_active boolean, p_sort_order int)` | Upsert employee gender | `/erp/hr/masters/employee-genders` | HR writer |
| `erp_hr_employee_gender_set_active` | `(p_id uuid, p_is_active boolean)` | Activate/deactivate gender | `/erp/hr/masters/employee-genders` | HR writer |
| `erp_hr_employee_exit_type_upsert` | `(p_id uuid, p_code text, p_name text, p_is_active boolean, p_sort_order int)` | Upsert exit type | `/erp/hr/masters/employee-exit-types` | HR writer |
| `erp_hr_employee_exit_type_set_active` | `(p_id uuid, p_is_active boolean)` | Activate/deactivate exit type | `/erp/hr/masters/employee-exit-types` | HR writer |
| `erp_hr_employee_exit_reason_upsert` | `(p_id uuid, p_code text, p_name text, p_is_active boolean, p_sort_order int)` | Upsert exit reason | `/erp/hr/masters/employee-exit-reasons` | HR writer |
| `erp_hr_employee_exit_reason_set_active` | `(p_id uuid, p_is_active boolean)` | Activate/deactivate exit reason | `/erp/hr/masters/employee-exit-reasons` | HR writer |
| `erp_hr_employee_exit_finalize` | `(p_employee_id uuid, p_exit_type_id uuid, p_exit_reason_id uuid, p_last_working_day date, p_notes text)` | Finalize exit + mark inactive | `/erp/hr/employees/[id]` | HR writer + exit rules |
| `erp_hr_exit_get` | `(p_exit_id uuid)` | Fetch exit detail | `/erp/hr/exits/[id]` | HR reader |
| `erp_hr_exit_set_status` | `(p_exit_id uuid, p_status text, p_note text)` | Update exit status | `/erp/hr/exits`, `/erp/hr/exits/[id]` | HR writer |
| `erp_hr_leave_type_upsert` | `(p_id uuid, p_key text, p_name text, p_is_paid bool, p_is_active bool, p_allows_half_day bool, p_requires_approval bool, p_counts_weekly_off bool, p_counts_holiday bool, p_display_order int)` | Upsert leave types | `/erp/hr/leaves/types` | HR writer |
| `erp_hr_leave_request_draft_upsert` | `(p_id uuid, p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date, p_reason text, p_start_session text, p_end_session text)` | Draft leave request | `/erp/hr/leaves/requests` | HR writer |
| `erp_leave_request_preview` | `(p_employee_id uuid, p_leave_type_id uuid, p_date_from date, p_date_to date, p_start_session text, p_end_session text)` | Preview leave days | `/erp/hr/leaves/requests` | Company scope |
| `erp_leave_request_submit` | `(p_request_id uuid)` | Submit leave | `/erp/hr/leaves/requests`, `/erp/hr/leave` | HR writer / employee self |
| `erp_leave_request_cancel` | `(p_request_id uuid, p_cancel_note text)` | Cancel leave | `/erp/hr/leaves/requests` | Self |
| `erp_leave_request_decide` | `(p_request_id uuid, p_decision text, p_note text)` | Approve/reject leave | `/erp/hr/leaves/requests` | HR writer |
| `erp_attendance_generate_month` | `(p_month date, p_employee_ids uuid[])` | Generate monthly attendance grid | `/erp/hr/attendance` | HR writer |
| `erp_attendance_mark_bulk` | `(p_month date, p_employee_ids uuid[], p_action text, p_days date[], p_note text)` | Bulk mark attendance | `/erp/hr/attendance` | HR writer |
| `erp_attendance_mark` | `(p_employee_id uuid, p_day date, p_status text, p_note text)` | Mark single day | `/erp/hr/attendance` | HR writer |
| `erp_attendance_upsert_check_times` | `(p_employee_id uuid, p_day date, p_check_in timestamptz, p_check_out timestamptz, p_notes text)` | Set check-in/out | `/erp/hr/attendance` | HR writer |
| `erp_hr_attendance_day_status_update` | `(p_attendance_day_id uuid, p_status text)` | Update status on day row | `/erp/hr/attendance` | HR writer |
| `erp_attendance_recompute_month` | `(p_month date, p_employee_ids uuid[])` | Recompute derived metrics | `/erp/hr/attendance` | HR writer |
| `erp_hr_shift_upsert` | `(p_id uuid, p_code text, p_name text, p_start_time time, p_end_time time, p_break_minutes int, p_grace_minutes int, p_min_half_day_minutes int, p_min_full_day_minutes int, p_ot_after_minutes int, p_is_night_shift bool, p_is_active bool)` | Upsert shifts | `/erp/hr/shifts` | HR writer |
| `erp_hr_location_shift_create` | `(p_location_id uuid, p_shift_id uuid, p_effective_from date, p_effective_to date)` | Assign shift to location | `/erp/hr/location-shifts` | HR writer |
| `erp_hr_weekly_off_rule_create` | `(p_scope_type text, p_location_id uuid, p_employee_id uuid, p_weekday int, p_week_of_month int, p_is_off bool, p_effective_from date, p_effective_to date)` | Create weekly-off rule | `/erp/hr/weekly-off` | HR writer |
| `erp_hr_weekly_off_rule_delete` | `(p_rule_id uuid)` | Delete weekly-off rule | `/erp/hr/weekly-off` | HR writer |
| `erp_hr_calendar_upsert` | `(p_id uuid, p_code text, p_name text, p_timezone text, p_is_default bool)` | Upsert calendar | `/erp/hr/calendars/*` | HR writer |
| `erp_hr_calendar_set_default` | `(p_calendar_id uuid)` | Mark default calendar | `/erp/hr/calendars/*` | HR writer |
| `erp_hr_calendar_holiday_create` | `(p_calendar_id uuid, p_date date, p_name text, p_type text)` | Add holiday | `/erp/hr/calendars/[id]` | HR writer |
| `erp_hr_calendar_holiday_delete` | `(p_calendar_holiday_id uuid)` | Remove holiday | `/erp/hr/calendars/[id]` | HR writer |
| `erp_hr_calendar_location_add` | `(p_calendar_id uuid, p_location_id uuid)` | Map location | `/erp/hr/calendars/[id]` | HR writer |
| `erp_hr_calendar_location_delete` | `(p_calendar_location_id uuid)` | Unmap location | `/erp/hr/calendars/[id]` | HR writer |
| `erp_hr_employee_document_create` | `(p_employee_id uuid, p_doc_type text, p_file_name text, p_storage_path text, p_notes text)` | Save document metadata | `/api/hr/employees/documents` | HR writer |
| `erp_hr_employee_document_delete` | `(p_document_id uuid)` | Delete document metadata | `/api/hr/employees/documents` | HR writer |
| `erp_salary_structure_upsert` | `(p_name text, p_is_active bool, p_notes text, p_basic_pct numeric, p_hra_pct_of_basic numeric, p_allowances_mode text, p_effective_from date, p_id uuid)` | Upsert salary structure | `/erp/hr/salary` | Payroll/HR writer |
| `erp_salary_structure_component_upsert` | `(p_structure_id uuid, p_code text, p_name text, p_component_type text, p_calc_mode text, p_value numeric, p_is_active bool)` | Upsert salary component | `/erp/hr/salary` | Payroll/HR writer |
| `erp_salary_structure_ot_rule_upsert` | `(p_structure_id uuid, p_ot_type text, p_multiplier numeric, p_base text, p_is_active bool, p_hours_per_day numeric)` | Upsert OT rules | `/erp/hr/salary` | Payroll/HR writer |
| `erp_employee_salary_current` | `(p_employee_id uuid)` | Fetch salary assignment history | `/erp/hr/employees/[id]` | Payroll/HR reader |
| `erp_employee_salary_assign` | `(p_employee_id uuid, p_salary_structure_id uuid, p_effective_from date, p_ctc_monthly numeric, p_notes text)` | Assign salary | `/erp/hr/employees/[id]` | Payroll/HR writer |
| `erp_payroll_run_create` | `(p_year int, p_month int, p_notes text)` | Create payroll run | `/api/hr/payroll/runs/create` | Payroll writer |
| `erp_payroll_run_generate` | `(p_run_id uuid)` | Generate run items | `/api/hr/payroll/runs/generate` | Payroll writer |
| `erp_payroll_run_items_status` | `(p_payroll_run_id uuid)` | Run readiness/status check | `/erp/hr/payroll/runs/[id]` | Payroll writer |
| `erp_payroll_item_override_update` | `(p_payroll_item_id uuid, p_payable_days_override numeric, p_lop_days_override numeric)` | Override payable/LOP | `/erp/hr/payroll/runs/[id]` | Payroll writer |
| `erp_payroll_run_attach_attendance` | `(p_payroll_run_id uuid)` | Attach attendance snapshot | `/erp/hr/payroll/runs/[id]` | Payroll writer |
| `erp_payroll_run_finalize` | `(p_payroll_run_id uuid)` | Finalize payroll | `/erp/hr/payroll/runs/[id]` | Payroll writer |
| `erp_payroll_run_payslips` | `(p_payroll_run_id uuid)` | List payslips for run | `/erp/hr/payroll/runs/[id]` | Payroll reader |
| `erp_payslip_get` | `(p_payslip_id uuid)` | Fetch payslip | `/erp/hr/payroll/payslips/[id]` | Payroll reader |
| `erp_hr_role_create/update/delete` | `(p_key text, p_name text)` | HR role CRUD | `/api/hr/roles/*` | HR/admin (via service key) |
| `erp_link_employee_login` | `(p_company_id uuid, p_employee_id uuid, p_auth_user_id uuid, p_employee_email text)` | Link employee user | `/api/hr/link-employee-user` | HR/admin |
| `erp_next_employee_code` | `(p_company_id uuid)` | Generate employee code | Trigger on `erp_employees` insert | HR/admin or service |

### HR-related Next.js API routes
| API route | Purpose | Key backing RPCs / tables |
|---|---|---|
| `/api/hr/employees` | Employee list & upsert (legacy) | `erp_list_employees`, `erp_upsert_employee` |
| `/api/hr/link-employee-user` | Link employee to auth user | `erp_link_employee_login`, `erp_get_company` |
| `/api/hr/roles/list` | List roles | `erp_roles` table (via admin client) |
| `/api/hr/roles/create` | Create role | `erp_hr_role_create` |
| `/api/hr/roles/update` | Update role | `erp_hr_role_update` |
| `/api/hr/roles/delete` | Delete role | `erp_hr_role_delete` |
| `/api/hr/masters` | HR masters list/upsert | `erp_hr_designations_list`, `erp_hr_designation_upsert` + table queries |
| `/api/hr/employees/[id]` | Employee profile RPC wrapper | `erp_employee_profile` |
| `/api/hr/employees/job` | Job history upsert | `erp_employee_job_upsert` |
| `/api/hr/employees/job-history` | Job history list | `erp_employee_jobs` |
| `/api/hr/employees/[id]/contacts` | Contact upsert | `erp_hr_employee_contact_upsert` |
| `/api/hr/employees/[id]/addresses` | Address upsert | `erp_hr_employee_address_upsert` |
| `/api/hr/employees/documents` | Document create/delete | `erp_hr_employee_document_create`, `erp_hr_employee_document_delete` |
| `/api/hr/employees/documents/upload-url` | Pre-signed upload URL | Storage bucket `erp-employee-docs` |
| `/api/hr/payroll/runs/list` | Payroll runs list | `erp_payroll_runs` |
| `/api/hr/payroll/runs/create` | Payroll run create | `erp_payroll_run_create` |
| `/api/hr/payroll/runs/get` | Payroll run detail | `erp_payroll_runs` |
| `/api/hr/payroll/items/list` | Payroll item list | `erp_payroll_items` |
| `/api/hr/payroll/item-lines/list` | Payroll item lines list | `erp_payroll_item_line_list` |
| `/api/hr/payroll/item-lines/upsert` | Payroll item line upsert | `erp_payroll_item_line_upsert` |
| `/api/hr/payslips/[id]/pdf` | Payslip PDF generation | `erp_payslip_get` + PDF render |


## 5) Employee Lifecycle — “How ERP currently works”

### Joining / Employee creation
1. **Create employee** via `/erp/hr/employees` using `erp_hr_employee_upsert` (insert into `erp_employees`).
2. **Employee code** is auto-generated via `erp_next_employee_code()` and trigger `erp_employees_set_code` when an employee is inserted without a code.
3. **Profile update**: joining date, title, and gender are stored via `erp_hr_employee_profile_update`.
4. **Job assignment**: the UI posts to `/api/hr/employees/job`, which invokes `erp_employee_job_upsert` and writes effective-dated rows in `erp_employee_jobs`.

### HR Masters setup (required before full onboarding)
- Departments, designations, locations, employment types are managed under `/erp/hr/masters`.
- Employee titles/genders and exit type/reason masters are managed under `/erp/hr/masters/*`.
- Shifts, calendars, and weekly off rules should be configured before attendance and payroll runs.

### Access / Roles
- Membership and access derive from `erp_company_users` (role_key) and `erp_employee_users` (employee ↔ user link).
- `/erp/hr/employee-logins` links employees to auth users using `/api/hr/link-employee-user` (RPC `erp_link_employee_login`).
- `/erp/hr/roles` manages HR roles through `/api/hr/roles/*` (RPCs `erp_hr_role_*`).
- UI gating checks `owner/admin/hr/payroll`, and RLS enforces at DB level.

### Attendance
- `/erp/hr/attendance` generates the month grid via `erp_attendance_generate_month` and writes `erp_hr_attendance_days`.
- Bulk marking uses `erp_attendance_mark_bulk`, per-day edits use `erp_attendance_mark`, and time logs use `erp_attendance_upsert_check_times`.
- Status updates are synced via `erp_hr_attendance_day_status_update` and recompute uses `erp_attendance_recompute_month`.
- Shifts & calendars: `erp_hr_shifts`, `erp_hr_location_shifts`, `erp_weekly_off_rules`, `erp_calendars` drive non-working day logic.

### Leave
- Leave types exist in `erp_hr_leave_types`; the new UI `/erp/hr/leaves/types` uses `erp_hr_leave_type_upsert`.
- Requests are drafted and previewed via `erp_hr_leave_request_draft_upsert` + `erp_leave_request_preview` and submitted via `erp_leave_request_submit`.
- Approvals use `erp_leave_request_decide`, and cancellations use `erp_leave_request_cancel`.
- Leave day splits are recorded in `erp_hr_leave_request_days`.

### Payroll
- Salary structures/components/OT rules are maintained in `/erp/hr/salary` using `erp_salary_structure_*` RPCs.
- Employees receive salary assignments from `/erp/hr/employees/[id]?tab=salary` via `erp_employee_salary_assign`.
- Payroll runs are created at `/erp/hr/payroll/runs` and managed in `/erp/hr/payroll/runs/[id]` (items, overrides, OT lines, finalize).
- Attendance snapshots can be attached to payroll runs via `erp_payroll_run_attach_attendance`.
- Payslips are viewed via `/erp/hr/payroll/payslips/[id]` (RPC `erp_payslip_get`) or `/erp/hr/payslips/[runId]/[employeeId]`.
- OT is **manual by design** in the payroll run detail UI (OT_NORMAL/OT_HOLIDAY lines).

### Payroll-to-Finance link
- **Not found**: No HR UI, API route, or RPC that posts payroll journals to finance was located in this repo. The payroll module currently stops at finalized runs/payslips.

### Exits
- Exit types/reasons are set in masters; exits are created via `/erp/hr/employees/[id]` using `erp_hr_employee_exit_finalize`.
- Exit list `/erp/hr/exits` and detail `/erp/hr/exits/[id]` manage status transitions (`draft`, `approved`, `completed`, `rejected`) via `erp_hr_exit_set_status`.
- Employee lifecycle is marked inactive on completed exit (enforced in exit RPCs).

### Post-exit
- Final settlement tables & RPCs exist (`erp_hr_final_settlement_*`) but **no UI/route** found for settlements or clearance workflows.


## 6) Recruitment Module Status
- **Not implemented yet (no routes/tables/RPCs found).**


## 7) What’s Missing / Gaps (Based on Repo Inspection)

1. **Recruitment pipeline (vacancies, CVs, interviews)**
   - **Missing**: No `/erp/hr/recruitment` routes, no `erp_hr_recruitment_*` tables or RPCs.
   - **Where it would fit**: New `pages/erp/hr/recruitment/**` routes and HR tables/RPCs.
   - **Risk/priority**: High if recruitment is in-scope; currently zero coverage.

2. **Final settlement UI + workflow**
   - **Missing**: DB tables and RPCs exist (`erp_hr_final_settlements`, `erp_hr_final_settlement_items`, `erp_hr_final_settlement_clearances`) but no HR pages or API routes are wired.
   - **Where it would fit**: `/erp/hr/exits/[id]/settlement` or `/erp/hr/final-settlements` routes.
   - **Risk/priority**: Medium; exits are implemented but post-exit settlement is not.

3. **Statutory & bank profile UI**
   - **Missing**: Tables exist (`erp_employee_statutory`, `erp_employee_bank_accounts`), but no HR UI tabs or API routes to manage these.
   - **Where it would fit**: Additional Employee Profile tabs or HR admin section.
   - **Risk/priority**: Medium for payroll compliance.

4. **Emergency contacts UI**
   - **Missing**: `erp_employee_emergency_contacts` table exists but no UI/API routes to edit it.
   - **Where it would fit**: Employee profile “Contacts” tab extension.
   - **Risk/priority**: Low to medium depending on HR requirements.

5. **Payroll-to-Finance bridge**
   - **Missing**: No evidence of payroll journal export or finance integration endpoints.
   - **Where it would fit**: `/erp/finance` bridge or RPCs to generate journal entries.
   - **Risk/priority**: Medium if finance module requires payroll posting.


## 8) Appendix

### Search index (high-level files scanned)
- `pages/erp/hr/**`
- `pages/api/hr/**`
- `pages/api/hr/**`
- `pages/api/hr/payroll/**`
- `lib/hrEmployeesApi.ts`, `lib/hrMastersApi.ts`, `lib/hrRoleApi.js`
- `supabase/migrations/**` (HR-related tables, RPCs, views)

### Key constants/hooks used in HR
- `getCompanyContext`, `requireAuthRedirectHome`, `isHr` — access control and scoping.
- `getCurrentErpAccess` — derived ERP access flags (manager, role key).
- `useCompanyBranding` — company setup check on HR home.
- `supabase.rpc(...)` — main data write path for HR actions.
