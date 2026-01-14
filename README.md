# Bigonbuy ERP
Internal ERP for Bigonbuy / Megaska

## Environment variables

Set the following for both local development and Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL` (falls back to `https://erp.bigonbuy.com` when unset)

## HR calendar mapping note

Calendars are linked to work locations, and employees inherit their attendance/holiday calendar through their assigned work location. Map each calendar to one or more locations so employees at those locations pick up the right holiday schedule.
