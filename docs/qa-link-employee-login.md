# QA: Employee Login Linking (ERP)

Use this checklist to validate the end-to-end flow in production (or staging).

## Prerequisites
- Environment variables configured: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ERP_REDIRECT_URL`.
- You have a company UUID, employee UUID, and the email to link.
- Test user signed in with a role of **owner**, **admin**, or **hr**.

## Steps
1) Sign in to the ERP UI with an owner/admin/hr account.  
2) Navigate to **HR → Employee Logins**.  
3) Confirm the employee row shows the expected details.  
4) Enter or confirm the login email.  
5) Click **Link Login** (button should disable while the request is running).  
6) On success, expect a success message and a password setup email sent to the employee email.  
7) Verify the employee row now shows **Linked** and the `user_id` snippet.  
8) Attempt a second link with a different employee to confirm unique constraints are enforced.  
9) Sign out and ensure unauthenticated users cannot load the page (redirects to `/`).  
10) Confirm redirect URL in the reset email matches `ERP_REDIRECT_URL` allowlist.

## Expected outcomes
- **Success:** API returns `{ ok: true, result: { employee_user_map_id, company_user_id } }` and reset email is dispatched.
- **Warning:** API returns `{ ok: true, warning: "Linked but failed to send reset email", email_error, result }`; linking succeeded but email needs retry.
- **Error (forbidden):** Returned when the caller is not owner/admin/hr for the company.
- **Error (missing employee role):** Returned when `erp_roles` lacks the `employee` role seed.
- **Error (conflict unique user_id mapping):** Returned when the auth user is already linked to another employee.
- **Error (redirect allowlist):** Reset email fails because `ERP_REDIRECT_URL` is not permitted in the Supabase project settings.
