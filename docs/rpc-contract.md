# Bigonbuy ERP — RPC Contract
(DB Schema + RPCs are the Source of Truth)

This document defines the **public Postgres RPC contract** used by the ERP UI.
All UI/API code MUST call only the RPCs listed here.

If a new RPC is required:
1) Update this document
2) Add a migration in `supabase/migrations/`
3) Deploy migration BEFORE deploying UI

---

## Global Rules

- **Schema:** All RPCs live in `public`
- **Security:** Mutating or sensitive RPCs must be:
  - `SECURITY DEFINER`
  - validate `auth.uid()` is not null
  - validate manager access where required
- **Single-company ERP:**
  - Company context is derived internally:
    ```sql
    select id from public.erp_companies limit 1
    ```
- **No direct table access from UI**
- **UI must never invent RPC names or parameters**

---

# Authorization & Access

## `is_erp_manager(uid uuid) -> boolean`
**Defined in:** `0007_invite_company_user.sql`, `0008_fix_employee_logins_and_manager_check.sql`

Checks whether a user has **management privileges**.

### Definition
Returns `true` if the given `uid` has role:
- `owner`
- `admin`
- `hr`

### Usage
- API authorization checks
- HR / Admin UI gating

---

# Company Users (Access Membership)

> Company users represent **system access**, not HR employment.

## `erp_list_company_users() -> table`
**Defined in:** `0007_invite_company_user.sql`

### Returns
| column | type |
|------|------|
| user_id | uuid |
| email | text |
| role_key | text |
| created_at | timestamptz |
| updated_at | timestamptz |

### Authorization
- Manager only (`owner`, `admin`, `hr`)

---

## `erp_invite_company_user(p_user_id uuid, p_email text, p_role_key text, p_full_name text) -> json`
**Defined in:** `0007_invite_company_user.sql`

### Purpose
Links an Auth user to the canonical company and assigns access role.

### Rules
- Enforces **single owner**
- Idempotent upsert
- Writes invite audit

---

# HR — Designations (Job Titles)

> Designations are **HR job titles**, not permissions.

## `erp_list_designations() -> table`
**Defined in:** `0010_designations.sql`

### Returns
| column | type |
|------|------|
| id | uuid |
| code | text |
| name | text |
| department | text |
| is_active | boolean |

### Authorization
- Manager only

---

# HR — Employees (Profiles)

> Employees are HR entities.
> Login access is optional and linked via `employee.user_id`.

## `erp_list_employees() -> table`
**Defined in:** `0008_rpc_fixes.sql`

### Returns (current canonical shape)
| column | type |
|------|------|
| id | uuid |
| employee_no | text |
| full_name | text |
| work_email | text |
| phone | text |
| department | text |
| status | text |
| designation_id | uuid |
| designation_name | text |
| user_id | uuid |
| created_at | timestamptz |
| updated_at | timestamptz |

### Authorization
- Manager only

### Notes
- This is a **no-parameter RPC**
- UI must not call parameterized variants
- Any future internal variants must be wrapped by this signature

---

## `erp_create_employee(...) -> json`
**Defined in:** `0009_designations_and_employee_profiles.sql`

### Purpose
Creates an employee profile with auto-generated employee number.

### Inputs (current)
- full_name
- work_email
- phone (optional)
- department (optional)
- designation_id (optional)
- status (default: active)

### Returns
```json
{
  "ok": true,
  "employee_id": "uuid",
  "employee_no": "BOB0002"
}
