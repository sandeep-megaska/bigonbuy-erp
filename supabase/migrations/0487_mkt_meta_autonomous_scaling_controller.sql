begin;

-- 1) Scaling decisions table
create table if not exists public.erp_mkt_meta_scaling_decisions_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  decision_date date not null,
  entity_type text not null check (entity_type in ('sku', 'city', 'audience')),
  entity_id text not null,
  decision text not null check (decision in ('scale', 'reduce', 'pause', 'expand', 'hold')),
  confidence_score numeric(6,2),
  target_budget_multiplier numeric(6,2),
  decision_reason text,
  created_at timestamptz not null default now(),
  constraint erp_mkt_meta_scaling_decisions_daily_company_entity_key
    unique (company_id, decision_date, entity_type, entity_id)
);

create index if not exists idx_erp_mkt_meta_scaling_decisions_daily_company_date
  on public.erp_mkt_meta_scaling_decisions_daily (company_id, decision_date);

create index if not exists idx_erp_mkt_meta_scaling_decisions_daily_company_entity_type
  on public.erp_mkt_meta_scaling_decisions_daily (company_id, entity_type);

-- 2) Campaign control table
create table if not exists public.erp_mkt_meta_campaign_control (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  campaign_layer text not null check (campaign_layer in ('prospecting', 'testing', 'retargeting', 'closer', 'profit_protection')),
  campaign_name text,
  meta_campaign_id text,
  current_budget numeric(12,2),
  last_adjusted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_erp_mkt_meta_campaign_control_company_layer
  on public.erp_mkt_meta_campaign_control (company_id, campaign_layer);

-- 3) Audience export queue table
create table if not exists public.erp_mkt_meta_audience_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  export_type text not null check (export_type in ('scale_skus', 'expand_cities', 'pause_skus', 'premium_audience')),
  export_status text not null default 'pending' check (export_status in ('pending', 'generated', 'uploaded')),
  generated_file_path text,
  created_at timestamptz not null default now(),
  generated_at timestamptz
);

create index if not exists idx_erp_mkt_meta_audience_exports_company_status
  on public.erp_mkt_meta_audience_exports (company_id, export_status);

-- 4) RPC: daily scaling decision engine
create or replace function public.erp_mkt_meta_scaling_run_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  insert into public.erp_mkt_meta_scaling_decisions_daily (
    company_id,
    decision_date,
    entity_type,
    entity_id,
    decision,
    target_budget_multiplier,
    decision_reason
  )
  select
    v_company_id,
    current_date,
    'sku'::text,
    s.sku_id::text,
    case
      when coalesce(s.roas, 0) >= 2.5 then 'scale'
      when coalesce(s.roas, 0) < 1.2 then 'reduce'
      else 'hold'
    end as decision,
    case
      when coalesce(s.roas, 0) >= 2.5 then 1.20::numeric(6,2)
      when coalesce(s.roas, 0) < 1.2 then 0.80::numeric(6,2)
      else 1.00::numeric(6,2)
    end as target_budget_multiplier,
    format('ROAS %.4s rule-based daily decision', coalesce(s.roas::text, '0'))
  from public.erp_mkt_sku_scaling_scores s
  where s.company_id = v_company_id
  on conflict (company_id, decision_date, entity_type, entity_id)
  do update
    set decision = excluded.decision,
        target_budget_multiplier = excluded.target_budget_multiplier,
        decision_reason = excluded.decision_reason;
end;
$$;

-- 5) RPC: audience export queue refresh
create or replace function public.erp_mkt_meta_audience_export_queue_refresh_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  insert into public.erp_mkt_meta_audience_exports (company_id, export_type, export_status)
  select v_company_id, t.export_type, 'pending'
  from (values ('scale_skus'::text), ('expand_cities'::text)) as t(export_type)
  where not exists (
    select 1
    from public.erp_mkt_meta_audience_exports e
    where e.company_id = v_company_id
      and e.export_type = t.export_type
      and e.export_status = 'pending'
  );
end;
$$;

-- 6) RPC: CSV builder for scale SKUs
create or replace function public.erp_mkt_meta_export_scale_skus_csv_v1()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_rows text;
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  select string_agg(
           concat(
             '"', replace(d.entity_id, '"', '""'), '",',
             '"', d.decision, '",',
             coalesce(d.target_budget_multiplier::text, '')
           ),
           E'\n'
           order by d.entity_id
         )
    into v_rows
  from public.erp_mkt_meta_scaling_decisions_daily d
  where d.company_id = v_company_id
    and d.entity_type = 'sku'
    and d.decision = 'scale';

  return concat('sku_id,decision,target_budget_multiplier', E'\n', coalesce(v_rows, ''));
end;
$$;

-- 7) Enable pg_cron
create extension if not exists pg_cron;

-- 8) Daily autonomous controller schedule (idempotent: unschedule existing first)
do $cron$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'erp_mkt_meta_scaling_run_daily',
      'erp_mkt_meta_audience_export_queue_refresh'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
      and p.pronargs = 3
  ) then
    perform cron.schedule(
      'erp_mkt_meta_scaling_run_daily',
      '0 2 * * *',
      $$select public.erp_mkt_meta_scaling_run_v1();$$
    );

    perform cron.schedule(
      'erp_mkt_meta_audience_export_queue_refresh',
      '5 2 * * *',
      $$select public.erp_mkt_meta_audience_export_queue_refresh_v1();$$
    );
  else
    perform cron.schedule('0 2 * * *', $$select public.erp_mkt_meta_scaling_run_v1();$$);
    perform cron.schedule('5 2 * * *', $$select public.erp_mkt_meta_audience_export_queue_refresh_v1();$$);
  end if;
end;
$cron$;

commit;

-- 10) Acceptance tests (run manually after deployment)
-- select public.erp_mkt_meta_scaling_run_v1();
-- select * from public.erp_mkt_meta_scaling_decisions_daily limit 20;
-- select public.erp_mkt_meta_export_scale_skus_csv_v1();
