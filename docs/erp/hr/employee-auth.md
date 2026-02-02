# Employee Auth Realm

## Tables

- `erp_employee_auth_users`
  - Stores employee login credentials (hashed passwords), activation flags, and reset requirements.
- `erp_employee_auth_sessions`
  - Tracks employee sessions with hashed tokens and revocation timestamps.
- `erp_employee_roles`
  - Maps employees to role keys for the employee realm.
- `erp_permissions` / `erp_role_permissions`
  - Minimal permission overlay used by employee self-service actions (`leave.apply`, `exit.submit`).

## Cookie & Session Design

- Cookie: `erp_emp_session` (HTTP-only, SameSite=Lax).
- Value format: `company_id:session_id:token`.
- The raw token is stored only in the cookie; the database stores `sha256(token)`.
- Session expiry defaults to 30 days and is enforced in `erp_employee_session_get`.
- Revocation occurs via `erp_employee_session_revoke`.

## RPCs

Employee auth + sessions:

- `erp_employee_auth_user_get(p_employee_code text)`
- `erp_employee_auth_user_upsert(p_company_id uuid, p_employee_id uuid, p_password_hash text, p_actor_user_id uuid)`
- `erp_employee_session_create(p_company_id uuid, p_employee_code text, p_token_hash text, p_expires_at timestamptz, p_ip text, p_user_agent text)`
- `erp_employee_session_get(p_company_id uuid, p_token_hash text)`
- `erp_employee_session_revoke(p_company_id uuid, p_session_id uuid)`

Employee permission guards:

- `erp_employee_has_permission(p_company_id uuid, p_employee_id uuid, p_permission_code text)`
- `erp_employee_require_permission(p_company_id uuid, p_employee_id uuid, p_permission_code text)`

Employee self-service wrappers:

- `erp_employee_leave_request_draft_upsert(...)`
- `erp_employee_leave_request_submit(...)`
- `erp_employee_leave_request_cancel(...)`
- `erp_employee_exit_request_submit(...)`

## HR: Enabling Employee Login

1. Open **HR → Employee Logins**.
2. Enter a temporary password in the **Portal Access** column.
3. Click **Enable Portal Login** to hash and store the password using `erp_employee_auth_user_upsert`.
4. Share the temporary password with the employee and instruct them to reset it after first sign-in.
