# Bigonbuy ERP
Internal ERP for Bigonbuy / Megaska

## Environment variables

Set the following for both local development and Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL` (falls back to `https://erp.bigonbuy.com` when unset)

## HR attendance calendar mapping

Attendance calendars define holiday schedules. Work locations are mapped to a calendar in `erp_calendar_locations`, and employees inherit holidays through their assigned work location. This keeps holiday rules consistent across locations without duplicating data per employee.
