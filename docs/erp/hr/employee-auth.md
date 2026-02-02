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

- Cookie: `erp_employee_session` (HTTP-only, SameSite=Lax).
- Value format: `session_token`.
- The raw token is stored only in the cookie; the database stores `sha256(token)`.
- Session expiry defaults to 30 days and is enforced in `erp_employee_auth_session_get`.
- Revocation occurs via `erp_employee_auth_logout`.

## RPCs

Employee auth + sessions:

- `erp_employee_auth_user_get(p_employee_code text)`
- `erp_employee_auth_user_upsert(p_company_id uuid, p_employee_id uuid, p_password_hash text, p_actor_user_id uuid)`
- `erp_employee_auth_login(p_employee_code text, p_password text, p_user_agent text, p_ip inet)`
- `erp_employee_auth_session_get(p_session_token text)`
- `erp_employee_auth_logout(p_session_token text)`
- `erp_employee_auth_change_password(p_session_token text, p_old_password text, p_new_password text)`
- `erp_employee_auth_admin_reset_password(p_company_id uuid, p_employee_id uuid)`

Employee permission guards:

- `erp_employee_has_permission(p_company_id uuid, p_employee_id uuid, p_permission_code text)`
- `erp_employee_require_permission(p_company_id uuid, p_employee_id uuid, p_permission_code text)`

Employee self-service wrappers:

- `erp_employee_leave_request_draft_upsert(...)`
- `erp_employee_leave_request_submit(...)`
- `erp_employee_leave_request_cancel(...)`
- `erp_employee_exit_request_submit(...)`

## HR: Enabling Employee Login

1. Open **HR → Employees** and select an employee profile.
2. In **Portal Access**, click **Reset Password** to generate a temporary password.
3. Share the temporary password with the employee and instruct them to reset it after first sign-in.
