-- 0485_growth_cockpit_snapshot_mv.sql
-- CEO Growth Cockpit Snapshot (Materialized View + Refresh RPC)

-- Drop if exists (safe for forward replacement environments)
-- 0485_growth_cockpit_snapshot_mv.sql
-- CEO Growth Cockpit Snapshot (Materialized View + Refresh RPC)

drop materialized view if exists public.erp_growth_cockpit_snapshot_mv;

create materialized view public.erp_growth_cockpit_snapshot_mv
as
select
    c.id as company_id,
    public.erp_growth_cockpit_summary_v1() as snapshot,
    now() as refreshed_at
from public.erp_companies c;

create unique index if not exists
    erp_growth_cockpit_snapshot_mv_company_uidx
on public.erp_growth_cockpit_snapshot_mv(company_id);

------------------------------------------------------

create or replace function public.erp_growth_cockpit_snapshot_refresh_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    refresh materialized view concurrently public.erp_growth_cockpit_snapshot_mv;
end;
$$;

