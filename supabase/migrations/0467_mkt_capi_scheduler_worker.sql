-- 0467_mkt_capi_scheduler_worker.sql
-- Schedule Meta CAPI batch sender

-- Ensure pg_cron exists
create extension if not exists pg_cron;

-- Remove existing job if already present (safe re-run)
do $$
declare
  v_job_id int;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'erp_mkt_capi_sender_worker_v1';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end$$;

-- Schedule new job
select cron.schedule(
  'erp_mkt_capi_sender_worker_v1',
  '*/5 * * * *',
  $$
  select public.erp_mkt_capi_send_batch_v1(null, 200);
  $$
);
