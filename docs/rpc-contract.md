# Bigonbuy ERP — RPC Contract (DB is the Source of Truth)

This document defines the **public RPC contract** used by the Next.js UI via thin API routes.
**Rule:** UI/API must only call RPCs listed here.  
If a new RPC is needed, update this doc **and** add a migration that creates it in `public` schema.

## Conventions

- **Schema:** All RPCs live in `public` and must be callable via `supabase.rpc()`.
- **Security:** RPCs that mutate or expose company data MUST be `SECURITY DEFINER` and enforce:
  - `auth.uid()` is not null (authenticated)
  - caller authorization (owner/admin/hr)
  - single-company scoping (canonical company derived inside RPC)
- **Single company:** All company-scoped RPCs must derive `company_id` internally:
  - `select id from public.erp_companies limit 1`
- **Return stability:** Prefer returning a stable set of columns. If a signature must change, keep a wrapper with the old signature.

---

# Auth & Access

## `is_erp_manager(uid uuid) -> boolean`
**Purpose:** Authorization helper. True if `uid` has access role `owner` or `admin` or `hr`.

- **Inputs**
  - `uid` (uuid): the user id to check

- **Returns**
  - boolean

- **Authorization**
  - Should be safe to call by authenticated users, but intended for server checks and manager-gated pages.

- **Notes**
  - Must reflect actual role tables in this repo (either `erp_user_roles` or `erp_company_users`).

---

# Company Users (Access Membership & Invites)

> Company users are **access membership** (permissions) within the canonical company.  
> Do **not** confuse with HR designation.

## `erp_list_company_users() -> table`
**Purpose:** List access users for the company.

- **Inputs**
  - none

- **Returns (columns)**
  - `user_id` uuid
  - `email` text (nullable if not stored)
  - `role_key` text (`owner|admin|hr|employee|...`)
  - `created_at` timestamptz
  - `updated_at` timestamptz

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Scoping**
  - Only canonical company

---

## `erp_invite_company_user(p_user_id uuid, p_email text, p_role_key text, p_full_name text default null) -> json`
**Purpose:** Attach an Auth user to the canonical company with an access role + audit invite.

- **Inputs**
  - `p_user_id` uuid (Auth user id created/invited by server using service role)
  - `p_email` text (login email; used for caching/audit)
  - `p_role_key` text (access role; must exist in roles master)
  - `p_full_name` text (optional)

- **Returns (json)**
  - `{ ok: true, company_id, user_id, email, role_key }` (minimum)

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Rules**
  - Must enforce single owner (fail if trying to add second owner)
  - Must upsert membership (idempotent)
  - Should write an invite audit record (recommended table: `erp_company_user_invites`)

---

# HR — Designations (Job Titles)

> Designations are **HR job titles**, not access permissions.

## `erp_list_designations() -> table`
**Purpose:** Provide dropdown data for designation selection.

- **Inputs**
  - none

- **Returns (columns)**
  - `id` uuid
  - `code` text
  - `name` text
  - `department` text (nullable)
  - `is_active` boolean

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Scoping**
  - Not company-scoped unless your designations are company-specific (default: global master).

---

# HR — Employees

> Employees are HR profiles that may link to an Auth user via `user_id` (1:1).  
> Employee number is generated DB-side (e.g., `BOB0002`).

## `erp_list_employees() -> table`
**Purpose:** List employee directory for HR and employee login linking UI.

- **Inputs**
  - none (important: must exist as **no-parameter** RPC)

- **Returns (minimum columns expected by UI)**
  - `employee_id` uuid (or `id` — but UI must match)
  - `employee_no` text
  - `full_name` text
  - `work_email` text (or `email` — UI must match)
  - `phone` text (nullable)
  - `department` text (nullable)
  - `status` text (e.g., `active|inactive`)
  - `designation_id` uuid (nullable)
  - `designation_name` text (nullable; join to `erp_designations`)
  - `user_id` uuid (nullable) — indicates whether login is linked
  - `created_at` timestamptz
  - `updated_at` timestamptz

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Scoping**
  - Only canonical company

- **Notes**
  - If you have an internal function that takes params, keep it and expose this wrapper with no params.

---

## `erp_create_employee(...) -> json` (planned/optional, recommended)
**Purpose:** Create employee profile. UI should not insert directly.

- **Inputs (recommended)**
  - `p_full_name` text (required)
  - `p_work_email` text (required)
  - `p_phone` text (optional)
  - `p_department` text (optional)
  - `p_status` text default 'active'
  - `p_designation_id` uuid (optional)
  - other HR fields (aadhaar/photo) to be added later

- **Returns (json)**
  - `{ ok: true, employee_id, employee_no }`

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Rules**
  - Must generate `employee_no` if not provided
  - Must scope to canonical company

---

## `erp_link_employee_login(p_employee_id uuid, p_user_id uuid, p_role_key text) -> json` (planned/optional, recommended)
**Purpose:** Link employee to Auth user and grant access membership/role.

- **Inputs**
  - `p_employee_id` uuid
  - `p_user_id` uuid (Auth user id)
  - `p_role_key` text (access role; never owner from HR UI)

- **Returns (json)**
  - `{ ok: true, employee_id, user_id, role_key }`

- **Authorization**
  - Manager-only (owner/admin/hr)

- **Rules**
  - Updates employee.user_id
  - Upserts `erp_company_users` membership for canonical company

---

# Password Setup / Reset

Supabase Auth invite/recovery flow redirects to:
- `/reset-password`

UI uses:
- `supabase.auth.updateUser({ password })`

No RPC required.

---

# Deprecations

The following concepts should be avoided/removed over time:
- Any separate “employee users” table such as `erp_employee_users` (login identity must be `auth.users` + `erp_employees.user_id`)
- Any “Become Owner” / bootstrap flows (permanent removal)
