-- 0477_meta_insights_cron.sql
-- NOTE:
-- This migration intentionally contains NO secrets.
-- The cron job should be scheduled using real credentials
-- via Supabase SQL Editor or deployment runbook.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Example scheduling statement (DO NOT COMMIT REAL KEYS)
-- Replace placeholders locally when executing manually.

-- select cron.schedule(
--   'meta-insights-sync',
--   '0 */4 * * *',
--   $$
--   select net.http_post(
--     url:='https://YOUR_PROJECT.supabase.co/functions/v1/marketing-meta-insights-sync',
--     headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
--   );
--   $$
-- );
