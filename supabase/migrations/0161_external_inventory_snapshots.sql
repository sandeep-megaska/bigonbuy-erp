-- External inventory snapshots (Amazon and other channels)

create or replace function public.erp_require_inventory_reader()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_inventory_reader() from public;
grant execute on function public.erp_require_inventory_reader() to authenticated;

create table if not exists public.erp_external_inventory_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_key text not null default 'amazon',
  marketplace_id text null,
  pulled_at timestamptz not null default now(),
  pulled_by uuid null default auth.uid(),
  notes text null
);

create index if not exists erp_external_inventory_batches_company_channel_pulled_idx
  on public.erp_external_inventory_batches (company_id, channel_key, pulled_at desc);

create table if not exists public.erp_external_inventory_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  batch_id uuid not null references public.erp_external_inventory_batches (id) on delete cascade,
  channel_key text not null default 'amazon',
  marketplace_id text null,
  external_sku text not null,
  asin text null,
  fnsku text null,
  condition text null,
  qty_available int not null default 0,
  qty_reserved int not null default 0,
  qty_inbound_working int not null default 0,
  qty_inbound_shipped int not null default 0,
  qty_inbound_receiving int not null default 0,
  external_location_code text null,
  erp_variant_id uuid null references public.erp_variants (id) on delete set null,
  erp_warehouse_id uuid null references public.erp_warehouses (id) on delete set null,
  match_status text not null default 'unmatched',
  raw jsonb null
);

create unique index if not exists erp_external_inventory_rows_unique_idx
  on public.erp_external_inventory_rows (
    batch_id,
    external_sku,
    coalesce(external_location_code, ''),
    coalesce(asin, ''),
    coalesce(fnsku, ''),
    coalesce(condition, '')
  );

create index if not exists erp_external_inventory_rows_company_batch_idx
  on public.erp_external_inventory_rows (company_id, batch_id);

create index if not exists erp_external_inventory_rows_company_external_sku_idx
  on public.erp_external_inventory_rows (company_id, external_sku);

create index if not exists erp_external_inventory_rows_company_variant_idx
  on public.erp_external_inventory_rows (company_id, erp_variant_id);

create index if not exists erp_external_inventory_rows_raw_gin_idx
  on public.erp_external_inventory_rows using gin (raw);

alter table public.erp_external_inventory_batches enable row level security;
alter table public.erp_external_inventory_batches force row level security;

alter table public.erp_external_inventory_rows enable row level security;
alter table public.erp_external_inventory_rows force row level security;

do $$
begin
  drop policy if exists erp_external_inventory_batches_select on public.erp_external_inventory_batches;
  drop policy if exists erp_external_inventory_batches_write on public.erp_external_inventory_batches;
  drop policy if exists erp_external_inventory_rows_select on public.erp_external_inventory_rows;
  drop policy if exists erp_external_inventory_rows_write on public.erp_external_inventory_rows;

  create policy erp_external_inventory_batches_select
    on public.erp_external_inventory_batches
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_external_inventory_batches_write
    on public.erp_external_inventory_batches
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_external_inventory_rows_select
    on public.erp_external_inventory_rows
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_external_inventory_rows_write
    on public.erp_external_inventory_rows
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );
end;
$$;

create or replace function public.erp_external_inventory_batch_latest(
  p_channel_key text default 'amazon'
)
returns table(
  id uuid,
  channel_key text,
  marketplace_id text,
  pulled_at timestamptz,
  pulled_by uuid,
  notes text,
  total_rows int,
  matched_rows int,
  unmatched_rows int,
  ambiguous_rows int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_reader();

  return query
  with latest_batch as (
    select b.id, b.channel_key, b.marketplace_id, b.pulled_at, b.pulled_by, b.notes
    from public.erp_external_inventory_batches b
    where b.company_id = public.erp_current_company_id()
      and b.channel_key = p_channel_key
    order by b.pulled_at desc
    limit 1
  )
  select
    lb.id,
    lb.channel_key,
    lb.marketplace_id,
    lb.pulled_at,
    lb.pulled_by,
    lb.notes,
    coalesce(count(r.id), 0)::int as total_rows,
    coalesce(sum(case when r.match_status = 'matched' then 1 else 0 end), 0)::int as matched_rows,
    coalesce(sum(case when r.match_status = 'unmatched' then 1 else 0 end), 0)::int as unmatched_rows,
    coalesce(sum(case when r.match_status = 'ambiguous' then 1 else 0 end), 0)::int as ambiguous_rows
  from latest_batch lb
  left join public.erp_external_inventory_rows r
    on r.batch_id = lb.id
   and r.company_id = public.erp_current_company_id()
  group by lb.id, lb.channel_key, lb.marketplace_id, lb.pulled_at, lb.pulled_by, lb.notes;
end;
$$;

revoke all on function public.erp_external_inventory_batch_latest(text) from public;
grant execute on function public.erp_external_inventory_batch_latest(text) to authenticated;

create or replace function public.erp_external_inventory_rows_list(
  p_batch_id uuid,
  p_only_unmatched boolean default false,
  p_limit int default 500,
  p_offset int default 0
)
returns table(
  id uuid,
  external_sku text,
  asin text,
  fnsku text,
  condition text,
  qty_available int,
  qty_reserved int,
  qty_inbound_working int,
  qty_inbound_shipped int,
  qty_inbound_receiving int,
  external_location_code text,
  match_status text,
  erp_variant_id uuid,
  sku_code text,
  variant_title text,
  variant_size text,
  variant_color text,
  variant_hsn text,
  erp_warehouse_id uuid,
  warehouse_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_reader();

  return query
  select
    r.id,
    r.external_sku,
    r.asin,
    r.fnsku,
    r.condition,
    r.qty_available,
    r.qty_reserved,
    r.qty_inbound_working,
    r.qty_inbound_shipped,
    r.qty_inbound_receiving,
    r.external_location_code,
    r.match_status,
    r.erp_variant_id,
    v.sku_code,
    v.title as variant_title,
    v.size as variant_size,
    v.color as variant_color,
    v.hsn as variant_hsn,
    r.erp_warehouse_id,
    w.name as warehouse_name
  from public.erp_external_inventory_rows r
  left join public.erp_variants v
    on v.id = r.erp_variant_id
  left join public.erp_warehouses w
    on w.id = r.erp_warehouse_id
  where r.company_id = public.erp_current_company_id()
    and r.batch_id = p_batch_id
    and (not p_only_unmatched or r.match_status = 'unmatched')
  order by r.external_sku
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) from public;
grant execute on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) to authenticated;
