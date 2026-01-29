# Employee Profile Sprint 1 — Existing Inventory

## Tables / Columns (from migrations)

### Statutory
- **Table:** `public.erp_employee_statutory` (migration `0040_employee_statutory_bank.sql`) with columns:
  - `employee_id` (unique), `pan`, `uan`, `pf_number`, `esic_number`, `professional_tax_number`, audit fields (`created_at`, `updated_at`, `created_by`, `updated_by`).
  - RLS policies restrict access to HR admin (`erp_is_hr_admin`) and service role.

### Bank
- **Table:** `public.erp_employee_bank_accounts` (migration `0040_employee_statutory_bank.sql`) with columns:
  - `bank_name`, `branch_name`, `account_holder_name`, `account_number`, `ifsc_code`, `account_type`, `is_primary`, audit fields.
  - Unique partial index on `(employee_id, is_primary)` where `is_primary` is true.
  - RLS policies allow select/write for company users with roles `owner`, `admin`, `payroll` (or service role).

### Emergency Contacts
- **Table:** `public.erp_employee_emergency_contacts` (migration `0038_employee_profile_tables.sql`) with columns:
  - `full_name`, `relationship`, `phone`, `email`, `is_primary`, audit fields.
  - Unique partial index on `(employee_id, is_primary)` where `is_primary` is true.
  - RLS policies allow select to HR admin/service role, employee self, or linked employee users; write for HR admin/service role.

## RPCs
- **Existing HR profile RPCs:**
  - `erp_hr_employee_contact_upsert` and `erp_hr_employee_address_upsert` (migration `0048_hr_employee_contact_address_upsert.sql`).
- **Missing for Sprint 1 tabs:**
  - No existing RPCs found for **statutory**, **bank account**, or **emergency contact** get/upsert.

## UI Components / Pages
- **Employee profile page:** `pages/erp/hr/employees/[id]/index.js` currently has tabs for Overview, Job, Contacts, Addresses, Documents, Exit, Salary.
- **Existing tab components:**
  - `components/erp/hr/employee-tabs/ContactsTab.tsx`
  - `components/erp/hr/employee-tabs/AddressTab.tsx`
- **Missing for Sprint 1 tabs:**
  - No existing Statutory, Bank, or Emergency tab components.

## API Routes
- **Existing routes:**
  - `pages/api/erp/hr/employees/[id]/contacts.ts`
  - `pages/api/erp/hr/employees/[id]/addresses.ts`
- **Missing for Sprint 1 tabs:**
  - No API routes found for statutory, bank, or emergency contact profile data.

## Gaps Identified
- **RPCs:** Need new security-definer get + upsert RPCs for statutory, bank account, and emergency contact.
- **UI:** Need new Employee Profile tabs and forms for statutory, bank, emergency contact data.
- **API:** Need `/api/erp/hr/employees/[id]/statutory`, `/bank`, `/emergency` routes to read/write data via RPCs.
