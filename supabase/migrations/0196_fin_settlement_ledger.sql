-- ---------------------------------------------------------------------
-- Settlement ledger tables
-- ---------------------------------------------------------------------

create table if not exists public.erp_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  source text not null,
  source_ref text null,
  received_at timestamptz not null default now(),
  status text not null default 'ingested',
  raw_payload jsonb null,
  error_text text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.erp_settlement_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  platform text not null,
  event_type text not null,
  event_date date not null,
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  reference_no text null,
  party text not null,
  batch_id uuid null references public.erp_settlement_batches (id) on delete set null,
  raw_payload jsonb null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  is_void boolean not null default false,
  void_reason text null
);

create table if not exists public.erp_settlement_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  from_event_id uuid not null references public.erp_settlement_events (id) on delete restrict,
  to_event_id uuid not null references public.erp_settlement_events (id) on delete restrict,
  link_type text not null,
  confidence integer not null default 0,
  rule_used text null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  is_void boolean not null default false,
  void_reason text null
);

-- Alignment (if tables already exist)
alter table public.erp_settlement_batches
  add column if not exists company_id uuid;

alter table public.erp_settlement_batches
  add column if not exists source text;

alter table public.erp_settlement_batches
  add column if not exists source_ref text;

alter table public.erp_settlement_batches
  add column if not exists received_at timestamptz;

alter table public.erp_settlement_batches
  add column if not exists status text;

alter table public.erp_settlement_batches
  add column if not exists raw_payload jsonb;

alter table public.erp_settlement_batches
  add column if not exists error_text text;

alter table public.erp_settlement_batches
  add column if not exists created_at timestamptz;

alter table public.erp_settlement_batches
  add column if not exists created_by uuid;

alter table public.erp_settlement_events
  add column if not exists company_id uuid;

alter table public.erp_settlement_events
  add column if not exists platform text;

alter table public.erp_settlement_events
  add column if not exists event_type text;

alter table public.erp_settlement_events
  add column if not exists event_date date;

alter table public.erp_settlement_events
  add column if not exists amount numeric(12,2);

alter table public.erp_settlement_events
  add column if not exists currency text;

alter table public.erp_settlement_events
  add column if not exists reference_no text;

alter table public.erp_settlement_events
  add column if not exists party text;

alter table public.erp_settlement_events
  add column if not exists batch_id uuid;

alter table public.erp_settlement_events
  add column if not exists raw_payload jsonb;

alter table public.erp_settlement_events
  add column if not exists created_at timestamptz;

alter table public.erp_settlement_events
  add column if not exists created_by uuid;

alter table public.erp_settlement_events
  add column if not exists is_void boolean;

alter table public.erp_settlement_events
  add column if not exists void_reason text;

alter table public.erp_settlement_links
  add column if not exists company_id uuid;

alter table public.erp_settlement_links
  add column if not exists from_event_id uuid;

alter table public.erp_settlement_links
  add column if not exists to_event_id uuid;

alter table public.erp_settlement_links
  add column if not exists link_type text;

alter table public.erp_settlement_links
  add column if not exists confidence integer;

alter table public.erp_settlement_links
  add column if not exists rule_used text;

alter table public.erp_settlement_links
  add column if not exists created_at timestamptz;

alter table public.erp_settlement_links
  add column if not exists created_by uuid;

alter table public.erp_settlement_links
  add column if not exists is_void boolean;

alter table public.erp_settlement_links
  add column if not exists void_reason text;

-- Indexes
create index if not exists erp_settlement_batches_company_source_received_idx
  on public.erp_settlement_batches (company_id, source, received_at desc);

create index if not exists erp_settlement_events_company_platform_type_date_idx
  on public.erp_settlement_events (company_id, platform, event_type, event_date desc);

create index if not exists erp_settlement_events_company_reference_idx
  on public.erp_settlement_events (company_id, reference_no);

create index if not exists erp_settlement_events_company_amount_date_idx
  on public.erp_settlement_events (company_id, amount, event_date);

create unique index if not exists erp_settlement_events_company_unique_ref
  on public.erp_settlement_events (company_id, platform, event_type, reference_no)
  where reference_no is not null and is_void = false;

create index if not exists erp_settlement_links_company_link_type_idx
  on public.erp_settlement_links (company_id, link_type);

create index if not exists erp_settlement_links_company_from_event_idx
  on public.erp_settlement_links (company_id, from_event_id);

create index if not exists erp_settlement_links_company_to_event_idx
  on public.erp_settlement_links (company_id, to_event_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.erp_settlement_batches enable row level security;
alter table public.erp_settlement_batches force row level security;
alter table public.erp_settlement_events enable row level security;
alter table public.erp_settlement_events force row level security;
alter table public.erp_settlement_links enable row level security;
alter table public.erp_settlement_links force row level security;

-- Policies

do $$
begin
  drop policy if exists erp_settlement_batches_select on public.erp_settlement_batches;
  drop policy if exists erp_settlement_batches_insert on public.erp_settlement_batches;
  drop policy if exists erp_settlement_batches_update on public.erp_settlement_batches;
  drop policy if exists erp_settlement_events_select on public.erp_settlement_events;
  drop policy if exists erp_settlement_events_insert on public.erp_settlement_events;
  drop policy if exists erp_settlement_events_update on public.erp_settlement_events;
  drop policy if exists erp_settlement_links_select on public.erp_settlement_links;
  drop policy if exists erp_settlement_links_insert on public.erp_settlement_links;
  drop policy if exists erp_settlement_links_update on public.erp_settlement_links;

  create policy erp_settlement_batches_select
    on public.erp_settlement_batches
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_settlement_batches_insert
    on public.erp_settlement_batches
    for insert
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_settlement_batches_update
    on public.erp_settlement_batches
    for update
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_settlement_events_select
    on public.erp_settlement_events
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_settlement_events_insert
    on public.erp_settlement_events
    for insert
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_settlement_events_update
    on public.erp_settlement_events
    for update
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_settlement_links_select
    on public.erp_settlement_links
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_settlement_links_insert
    on public.erp_settlement_links
    for insert
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_settlement_links_update
    on public.erp_settlement_links
    for update
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );
end;
$$;
