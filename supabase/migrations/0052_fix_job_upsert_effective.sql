-- 0052 was originally attempted to change parameter names via CREATE OR REPLACE,
-- which is not allowed in Postgres (42P13). Make this migration a no-op.
select 1;
