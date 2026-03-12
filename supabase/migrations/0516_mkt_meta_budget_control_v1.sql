begin;

create table if not exists public.erp_mkt_meta_campaign_actions_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  control_id uuid null references public.erp_mkt_meta_campaign_control(id) on delete set null,
  meta_campaign_id text not null,
  entity_type text not null default 'campaign',
  entity_id text null,
  action_type text not null,
  action_status text not null default 'pending',
  decision_date date null,
  decision_id uuid null,
  old_budget numeric null,
  new_budget numeric null,
  budget_multiplier numeric null,
  decision_reason text null,
  confidence_score numeric null,
  actor_user_id uuid null,
  actor_email text null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  applied_at timestamptz null
);

alter table public.erp_mkt_meta_campaign_control
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists min_budget numeric null,
  add column if not exists max_budget numeric null,
  add column if not exists target_roas numeric null,
  add column if not exists max_cpa numeric null,
  add column if not exists scale_up_pct numeric null,
  add column if not exists scale_down_pct numeric null,
  add column if not exists status text not null default 'active',
  add column if not exists last_decision text null,
  add column if not exists last_decision_reason text null,
  add column if not exists last_meta_sync_at timestamptz null;

create index if not exists idx_erp_mkt_meta_campaign_actions_log_company_id
  on public.erp_mkt_meta_campaign_actions_log (company_id);
create index if not exists idx_erp_mkt_meta_campaign_actions_log_meta_campaign_id
  on public.erp_mkt_meta_campaign_actions_log (meta_campaign_id);
create index if not exists idx_erp_mkt_meta_campaign_actions_log_decision_date
  on public.erp_mkt_meta_campaign_actions_log (decision_date);
create index if not exists idx_erp_mkt_meta_campaign_actions_log_created_at
  on public.erp_mkt_meta_campaign_actions_log (created_at desc);
  create index if not exists idx_erp_mkt_meta_campaign_actions_log_control_id
  on public.erp_mkt_meta_campaign_actions_log (control_id);
  create index if not exists idx_erp_mkt_meta_campaign_actions_log_decision_id
  on public.erp_mkt_meta_campaign_actions_log (decision_id);
  create index if not exists idx_erp_mkt_meta_campaign_actions_log_campaign_created_at
  on public.erp_mkt_meta_campaign_actions_log (meta_campaign_id, created_at desc);

alter table public.erp_mkt_meta_campaign_actions_log enable row level security;
alter table public.erp_mkt_meta_campaign_actions_log force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_meta_campaign_actions_log'
      and policyname = 'erp_mkt_meta_campaign_actions_log_select'
  ) then
    create policy erp_mkt_meta_campaign_actions_log_select
      on public.erp_mkt_meta_campaign_actions_log
      for select
      using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_meta_campaign_actions_log'
      and policyname = 'erp_mkt_meta_campaign_actions_log_write'
  ) then
    create policy erp_mkt_meta_campaign_actions_log_write
      on public.erp_mkt_meta_campaign_actions_log
      for all
      using (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      )
      with check (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      );
  end if;
end;
$$;

commit;
