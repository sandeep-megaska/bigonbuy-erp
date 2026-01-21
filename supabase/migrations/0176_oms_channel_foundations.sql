-- OMS channel foundations, alias mapping, job queue, reservations

create table if not exists public.erp_channel_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_key text not null,
  name text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint erp_channel_accounts_company_channel_key_key unique (company_id, channel_key)
);

create index if not exists erp_channel_accounts_company_id_idx
  on public.erp_channel_accounts (company_id);

create table if not exists public.erp_channel_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_account_id uuid not null references public.erp_channel_accounts (id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  fulfillment_type text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  external_location_ref text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint erp_channel_locations_unique unique (company_id, channel_account_id, warehouse_id, fulfillment_type)
);

create unique index if not exists erp_channel_locations_default_unique
  on public.erp_channel_locations (company_id, channel_account_id)
  where is_default;

create table if not exists public.erp_channel_listing_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_account_id uuid not null references public.erp_channel_accounts (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  internal_sku text not null,
  channel_sku text not null,
  asin text null,
  listing_id text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint erp_channel_listing_aliases_unique unique (company_id, channel_account_id, channel_sku)
);

create index if not exists erp_channel_listing_aliases_channel_sku_idx
  on public.erp_channel_listing_aliases (company_id, channel_account_id, internal_sku);

create index if not exists erp_channel_listing_aliases_internal_sku_idx
  on public.erp_channel_listing_aliases (company_id, internal_sku);

create table if not exists public.erp_channel_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_account_id uuid not null references public.erp_channel_accounts (id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  error text null
);

create index if not exists erp_channel_jobs_company_id_idx
  on public.erp_channel_jobs (company_id, channel_account_id, requested_at desc);

create table if not exists public.erp_channel_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.erp_channel_jobs (id) on delete cascade,
  status text not null default 'queued',
  attempt_count int not null default 0,
  next_attempt_at timestamptz null,
  key text null,
  payload jsonb not null default '{}'::jsonb,
  last_error text null,
  created_at timestamptz not null default now()
);

create index if not exists erp_channel_job_items_job_id_idx
  on public.erp_channel_job_items (job_id, created_at desc);

create table if not exists public.erp_channel_job_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.erp_channel_jobs (id) on delete cascade,
  level text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists erp_channel_job_logs_job_id_idx
  on public.erp_channel_job_logs (job_id, created_at desc);

create table if not exists public.erp_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty_reserved numeric not null,
  source_type text not null,
  source_ref text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

drop trigger if exists erp_channel_accounts_set_updated on public.erp_channel_accounts;
create trigger erp_channel_accounts_set_updated
before update on public.erp_channel_accounts
for each row
execute function public.erp_set_updated_cols();

drop trigger if exists erp_channel_locations_set_updated on public.erp_channel_locations;
create trigger erp_channel_locations_set_updated
before update on public.erp_channel_locations
for each row
execute function public.erp_set_updated_cols();

drop trigger if exists erp_channel_listing_aliases_set_updated on public.erp_channel_listing_aliases;
create trigger erp_channel_listing_aliases_set_updated
before update on public.erp_channel_listing_aliases
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_channel_accounts enable row level security;
alter table public.erp_channel_accounts force row level security;
alter table public.erp_channel_locations enable row level security;
alter table public.erp_channel_locations force row level security;
alter table public.erp_channel_listing_aliases enable row level security;
alter table public.erp_channel_listing_aliases force row level security;
alter table public.erp_channel_jobs enable row level security;
alter table public.erp_channel_jobs force row level security;
alter table public.erp_channel_job_items enable row level security;
alter table public.erp_channel_job_items force row level security;
alter table public.erp_channel_job_logs enable row level security;
alter table public.erp_channel_job_logs force row level security;
alter table public.erp_stock_reservations enable row level security;
alter table public.erp_stock_reservations force row level security;

do $$
begin
  drop policy if exists erp_channel_accounts_select on public.erp_channel_accounts;
  drop policy if exists erp_channel_accounts_write on public.erp_channel_accounts;
  drop policy if exists erp_channel_locations_select on public.erp_channel_locations;
  drop policy if exists erp_channel_locations_write on public.erp_channel_locations;
  drop policy if exists erp_channel_listing_aliases_select on public.erp_channel_listing_aliases;
  drop policy if exists erp_channel_listing_aliases_write on public.erp_channel_listing_aliases;
  drop policy if exists erp_channel_jobs_select on public.erp_channel_jobs;
  drop policy if exists erp_channel_jobs_write on public.erp_channel_jobs;
  drop policy if exists erp_channel_job_items_select on public.erp_channel_job_items;
  drop policy if exists erp_channel_job_items_write on public.erp_channel_job_items;
  drop policy if exists erp_channel_job_logs_select on public.erp_channel_job_logs;
  drop policy if exists erp_channel_job_logs_write on public.erp_channel_job_logs;
  drop policy if exists erp_stock_reservations_select on public.erp_stock_reservations;
  drop policy if exists erp_stock_reservations_write on public.erp_stock_reservations;

  create policy erp_channel_accounts_select
    on public.erp_channel_accounts
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

  create policy erp_channel_accounts_write
    on public.erp_channel_accounts
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );

  create policy erp_channel_locations_select
    on public.erp_channel_locations
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

  create policy erp_channel_locations_write
    on public.erp_channel_locations
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );

  create policy erp_channel_listing_aliases_select
    on public.erp_channel_listing_aliases
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

  create policy erp_channel_listing_aliases_write
    on public.erp_channel_listing_aliases
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );

  create policy erp_channel_jobs_select
    on public.erp_channel_jobs
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

  create policy erp_channel_jobs_write
    on public.erp_channel_jobs
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );

  create policy erp_channel_job_items_select
    on public.erp_channel_job_items
    for select
    using (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
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
      )
    );

  create policy erp_channel_job_items_write
    on public.erp_channel_job_items
    for all
    using (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
          and (
            auth.role() = 'service_role'
            or exists (
              select 1
              from public.erp_company_users cu
              where cu.company_id = public.erp_current_company_id()
                and cu.user_id = auth.uid()
                and coalesce(cu.is_active, true)
                and cu.role_key in ('owner', 'admin', 'inventory')
            )
          )
      )
    )
    with check (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
          and (
            auth.role() = 'service_role'
            or exists (
              select 1
              from public.erp_company_users cu
              where cu.company_id = public.erp_current_company_id()
                and cu.user_id = auth.uid()
                and coalesce(cu.is_active, true)
                and cu.role_key in ('owner', 'admin', 'inventory')
            )
          )
      )
    );

  create policy erp_channel_job_logs_select
    on public.erp_channel_job_logs
    for select
    using (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
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
      )
    );

  create policy erp_channel_job_logs_write
    on public.erp_channel_job_logs
    for all
    using (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
          and (
            auth.role() = 'service_role'
            or exists (
              select 1
              from public.erp_company_users cu
              where cu.company_id = public.erp_current_company_id()
                and cu.user_id = auth.uid()
                and coalesce(cu.is_active, true)
                and cu.role_key in ('owner', 'admin', 'inventory')
            )
          )
      )
    )
    with check (
      exists (
        select 1
        from public.erp_channel_jobs j
        where j.id = job_id
          and j.company_id = public.erp_current_company_id()
          and (
            auth.role() = 'service_role'
            or exists (
              select 1
              from public.erp_company_users cu
              where cu.company_id = public.erp_current_company_id()
                and cu.user_id = auth.uid()
                and coalesce(cu.is_active, true)
                and cu.role_key in ('owner', 'admin', 'inventory')
            )
          )
      )
    );

  create policy erp_stock_reservations_select
    on public.erp_stock_reservations
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

  create policy erp_stock_reservations_write
    on public.erp_stock_reservations
    for all
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );
end $$;

create or replace function public.erp_default_jaipur_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.erp_warehouses w
  where w.company_id = public.erp_current_company_id()
    and w.name ilike '%jaipur%'
  order by w.name
  limit 1;
$$;

create or replace function public.erp_channel_account_upsert(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_channel_key text;
  v_name text;
  v_is_active boolean;
  v_metadata jsonb;
  v_warehouse_id uuid;
  v_fulfillment_type text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p is null then
    raise exception 'Payload required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  v_id := nullif(p->>'id', '')::uuid;
  v_channel_key := nullif(trim(p->>'channel_key'), '');
  v_name := nullif(trim(p->>'name'), '');
  v_is_active := coalesce((p->>'is_active')::boolean, true);
  v_metadata := coalesce(p->'metadata', '{}'::jsonb);

  if v_channel_key is null then
    raise exception 'channel_key is required';
  end if;

  if v_name is null then
    raise exception 'name is required';
  end if;

  if v_id is null then
    insert into public.erp_channel_accounts (
      company_id,
      channel_key,
      name,
      is_active,
      metadata,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_channel_key,
      v_name,
      v_is_active,
      v_metadata,
      v_actor,
      v_actor
    ) returning id into v_id;

    v_warehouse_id := public.erp_default_jaipur_warehouse_id();
    v_fulfillment_type := case when v_channel_key = 'amazon_in' then 'seller_flex' else 'self_ship' end;

    if v_warehouse_id is not null then
      insert into public.erp_channel_locations (
        company_id,
        channel_account_id,
        warehouse_id,
        fulfillment_type,
        is_default,
        is_active,
        created_by,
        updated_by
      ) values (
        v_company_id,
        v_id,
        v_warehouse_id,
        v_fulfillment_type,
        true,
        true,
        v_actor,
        v_actor
      ) on conflict (company_id, channel_account_id, warehouse_id, fulfillment_type) do update
        set is_default = true,
            is_active = true,
            updated_at = now(),
            updated_by = v_actor;
    end if;
  else
    update public.erp_channel_accounts
      set channel_key = v_channel_key,
          name = v_name,
          is_active = v_is_active,
          metadata = v_metadata,
          updated_at = now(),
          updated_by = v_actor
    where id = v_id
      and company_id = v_company_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.erp_channel_account_list()
returns table (
  id uuid,
  channel_key text,
  name text,
  is_active boolean,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id,
         channel_key,
         name,
         is_active,
         metadata,
         created_at
    from public.erp_channel_accounts
   where company_id = public.erp_current_company_id()
   order by created_at desc;
$$;

create or replace function public.erp_channel_location_upsert(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_channel_account_id uuid;
  v_warehouse_id uuid;
  v_fulfillment_type text;
  v_is_default boolean;
  v_is_active boolean;
  v_external_location_ref text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p is null then
    raise exception 'Payload required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  v_id := nullif(p->>'id', '')::uuid;
  v_channel_account_id := nullif(p->>'channel_account_id', '')::uuid;
  v_warehouse_id := nullif(p->>'warehouse_id', '')::uuid;
  v_fulfillment_type := nullif(trim(p->>'fulfillment_type'), '');
  v_is_default := coalesce((p->>'is_default')::boolean, false);
  v_is_active := coalesce((p->>'is_active')::boolean, true);
  v_external_location_ref := nullif(trim(p->>'external_location_ref'), '');

  if v_channel_account_id is null or v_warehouse_id is null or v_fulfillment_type is null then
    raise exception 'channel_account_id, warehouse_id, fulfillment_type are required';
  end if;

  if not exists (
    select 1
    from public.erp_channel_accounts ca
    where ca.id = v_channel_account_id
      and ca.company_id = v_company_id
  ) then
    raise exception 'Channel account not found';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = v_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  insert into public.erp_channel_locations (
    company_id,
    channel_account_id,
    warehouse_id,
    fulfillment_type,
    is_default,
    is_active,
    external_location_ref,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_channel_account_id,
    v_warehouse_id,
    v_fulfillment_type,
    v_is_default,
    v_is_active,
    v_external_location_ref,
    v_actor,
    v_actor
  ) on conflict (company_id, channel_account_id, warehouse_id, fulfillment_type) do update
    set is_default = excluded.is_default,
        is_active = excluded.is_active,
        external_location_ref = excluded.external_location_ref,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_id;

  if v_is_default then
    update public.erp_channel_locations
      set is_default = false,
          updated_at = now(),
          updated_by = v_actor
    where company_id = v_company_id
      and channel_account_id = v_channel_account_id
      and id <> v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.erp_channel_location_list(p_channel_account_id uuid)
returns table (
  id uuid,
  warehouse_id uuid,
  warehouse_name text,
  fulfillment_type text,
  is_default boolean,
  is_active boolean,
  external_location_ref text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id,
         l.warehouse_id,
         w.name as warehouse_name,
         l.fulfillment_type,
         l.is_default,
         l.is_active,
         l.external_location_ref,
         l.created_at
    from public.erp_channel_locations l
    join public.erp_channel_accounts ca
      on ca.id = l.channel_account_id
     and ca.company_id = public.erp_current_company_id()
    left join public.erp_warehouses w
      on w.id = l.warehouse_id
     and w.company_id = public.erp_current_company_id()
   where l.company_id = public.erp_current_company_id()
     and l.channel_account_id = p_channel_account_id
   order by l.is_default desc, w.name;
$$;

create or replace function public.erp_channel_alias_upsert(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_channel_account_id uuid;
  v_variant_id uuid;
  v_internal_sku text;
  v_channel_sku text;
  v_asin text;
  v_listing_id text;
  v_is_active boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p is null then
    raise exception 'Payload required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  v_id := nullif(p->>'id', '')::uuid;
  v_channel_account_id := nullif(p->>'channel_account_id', '')::uuid;
  v_variant_id := nullif(p->>'variant_id', '')::uuid;
  v_channel_sku := nullif(trim(p->>'channel_sku'), '');
  v_asin := nullif(trim(p->>'asin'), '');
  v_listing_id := nullif(trim(p->>'listing_id'), '');
  v_is_active := coalesce((p->>'is_active')::boolean, true);

  if v_channel_account_id is null or v_variant_id is null or v_channel_sku is null then
    raise exception 'channel_account_id, variant_id, channel_sku are required';
  end if;

  select v.sku into v_internal_sku
    from public.erp_variants v
   where v.id = v_variant_id
     and v.company_id = v_company_id;

  if v_internal_sku is null then
    raise exception 'Variant not found';
  end if;

  if not exists (
    select 1
    from public.erp_channel_accounts ca
    where ca.id = v_channel_account_id
      and ca.company_id = v_company_id
  ) then
    raise exception 'Channel account not found';
  end if;

  insert into public.erp_channel_listing_aliases (
    company_id,
    channel_account_id,
    variant_id,
    internal_sku,
    channel_sku,
    asin,
    listing_id,
    is_active,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_channel_account_id,
    v_variant_id,
    v_internal_sku,
    v_channel_sku,
    v_asin,
    v_listing_id,
    v_is_active,
    v_actor,
    v_actor
  ) on conflict (company_id, channel_account_id, channel_sku) do update
    set variant_id = excluded.variant_id,
        internal_sku = excluded.internal_sku,
        asin = excluded.asin,
        listing_id = excluded.listing_id,
        is_active = excluded.is_active,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.erp_channel_alias_list(
  p_channel_account_id uuid,
  p_q text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  variant_id uuid,
  internal_sku text,
  channel_sku text,
  asin text,
  listing_id text,
  is_active boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(trim(p_q), '') as q
  )
  select a.id,
         a.variant_id,
         a.internal_sku,
         a.channel_sku,
         a.asin,
         a.listing_id,
         a.is_active,
         a.created_at
    from public.erp_channel_listing_aliases a
   where a.company_id = public.erp_current_company_id()
     and a.channel_account_id = p_channel_account_id
     and (
       (select q from normalized) is null
       or a.internal_sku ilike '%' || (select q from normalized) || '%'
       or a.channel_sku ilike '%' || (select q from normalized) || '%'
       or coalesce(a.asin, '') ilike '%' || (select q from normalized) || '%'
       or coalesce(a.listing_id, '') ilike '%' || (select q from normalized) || '%'
     )
   order by a.created_at desc
   limit p_limit
   offset p_offset;
$$;

create or replace function public.erp_channel_job_create(
  p_channel_account_id uuid,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_job_type text := nullif(trim(p_job_type), '');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_job_type is null then
    raise exception 'job_type is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_channel_accounts ca
    where ca.id = p_channel_account_id
      and ca.company_id = v_company_id
  ) then
    raise exception 'Channel account not found';
  end if;

  if v_job_type not in ('inventory_push', 'orders_pull', 'settlement_pull') then
    raise exception 'Invalid job type';
  end if;

  insert into public.erp_channel_jobs (
    company_id,
    channel_account_id,
    job_type,
    status,
    payload,
    requested_by,
    requested_at
  ) values (
    v_company_id,
    p_channel_account_id,
    v_job_type,
    'queued',
    coalesce(p_payload, '{}'::jsonb),
    v_actor,
    now()
  ) returning id into v_id;

  insert into public.erp_channel_job_items (
    job_id,
    status,
    attempt_count,
    key,
    payload,
    created_at
  ) values (
    v_id,
    'queued',
    0,
    v_job_type || '_placeholder',
    coalesce(p_payload, '{}'::jsonb),
    now()
  );

  return v_id;
end;
$$;

create or replace function public.erp_channel_job_list(
  p_channel_account_id uuid,
  p_job_type text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  job_type text,
  status text,
  payload jsonb,
  requested_by uuid,
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text
)
language sql
stable
security definer
set search_path = public
as $$
  select j.id,
         j.job_type,
         j.status,
         j.payload,
         j.requested_by,
         j.requested_at,
         j.started_at,
         j.finished_at,
         j.error
    from public.erp_channel_jobs j
   where j.company_id = public.erp_current_company_id()
     and j.channel_account_id = p_channel_account_id
     and (p_job_type is null or j.job_type = p_job_type)
     and (p_status is null or j.status = p_status)
   order by j.requested_at desc
   limit p_limit
   offset p_offset;
$$;

create or replace function public.erp_inventory_available(p_warehouse_id uuid default null)
returns table (
  warehouse_id uuid,
  variant_id uuid,
  internal_sku text,
  on_hand numeric,
  reserved numeric,
  available numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(l.qty)::numeric as on_hand
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
    group by l.warehouse_id, l.variant_id
  ),
  reservation_totals as (
    select
      r.warehouse_id,
      r.variant_id,
      sum(r.qty_reserved)::numeric as reserved
    from public.erp_stock_reservations r
    where r.company_id = public.erp_current_company_id()
      and r.status = 'active'
      and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id)
    group by r.warehouse_id, r.variant_id
  )
  select
    lt.warehouse_id,
    lt.variant_id,
    v.sku as internal_sku,
    lt.on_hand,
    coalesce(rt.reserved, 0) as reserved,
    (lt.on_hand - coalesce(rt.reserved, 0)) as available
  from ledger_totals lt
  join public.erp_variants v
    on v.id = lt.variant_id
   and v.company_id = public.erp_current_company_id()
  left join reservation_totals rt
    on rt.warehouse_id = lt.warehouse_id
   and rt.variant_id = lt.variant_id
  order by v.sku asc;
$$;

revoke all on function public.erp_default_jaipur_warehouse_id() from public;
grant execute on function public.erp_default_jaipur_warehouse_id() to authenticated;

revoke all on function public.erp_channel_account_upsert(jsonb) from public;
grant execute on function public.erp_channel_account_upsert(jsonb) to authenticated;

revoke all on function public.erp_channel_account_list() from public;
grant execute on function public.erp_channel_account_list() to authenticated;

revoke all on function public.erp_channel_location_upsert(jsonb) from public;
grant execute on function public.erp_channel_location_upsert(jsonb) to authenticated;

revoke all on function public.erp_channel_location_list(uuid) from public;
grant execute on function public.erp_channel_location_list(uuid) to authenticated;

revoke all on function public.erp_channel_alias_upsert(jsonb) from public;
grant execute on function public.erp_channel_alias_upsert(jsonb) to authenticated;

revoke all on function public.erp_channel_alias_list(uuid, text, int, int) from public;
grant execute on function public.erp_channel_alias_list(uuid, text, int, int) to authenticated;

revoke all on function public.erp_channel_job_create(uuid, text, jsonb) from public;
grant execute on function public.erp_channel_job_create(uuid, text, jsonb) to authenticated;

revoke all on function public.erp_channel_job_list(uuid, text, text, int, int) from public;
grant execute on function public.erp_channel_job_list(uuid, text, text, int, int) to authenticated;

revoke all on function public.erp_inventory_available(uuid) from public;
grant execute on function public.erp_inventory_available(uuid) to authenticated;

notify pgrst, 'reload schema';
