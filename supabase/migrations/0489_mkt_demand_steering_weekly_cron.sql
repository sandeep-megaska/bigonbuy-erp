begin;

create extension if not exists pg_cron;

-- Weekly demand steering refresh every Sunday 23:30 UTC.
do $cron$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'mkt_demand_steering_refresh_weekly'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
      and p.pronargs = 3
  ) then
    perform cron.schedule(
      'mkt_demand_steering_refresh_weekly',
      '30 23 * * 0',
      $cmd$select public.erp_mkt_demand_steering_refresh_v1(null);$cmd$
    );
  else
    perform cron.schedule('30 23 * * 0', $cmd$select public.erp_mkt_demand_steering_refresh_v1(null);$cmd$);
  end if;
end;
$cron$;

-- Acceptance checks:
-- select jobid, jobname, schedule, command from cron.job where jobname = 'mkt_demand_steering_refresh_weekly';
-- select public.erp_mkt_demand_steering_refresh_v1(null);

commit;
