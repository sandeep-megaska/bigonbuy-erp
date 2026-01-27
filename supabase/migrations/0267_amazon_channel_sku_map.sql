-- 0267_amazon_channel_sku_map.sql
-- Extend existing external inventory snapshots (erp_external_inventory_batches/rows + erp_external_inventory_rows_list)
-- with explicit channel SKU mappings for Amazon and future channels.

create table if not exists public.erp_channel_sku_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_key text not null,
  marketplace_id text null,
  marketplace_id_norm text generated always as (coalesce(marketplace_id, '')) stored,
  external_sku text not null,
  external_sku_norm text not null,
  asin text null,
  fnsku text null,
  mapped_variant_id uuid not null references public.erp_variants (id) on delete restrict,
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint erp_channel_sku_map_unique unique (company_id, channel_key, marketplace_id_norm, external_sku_norm)
);

create index if not exists erp_channel_sku_map_company_channel_sku_idx
  on public.erp_channel_sku_map (company_id, channel_key, external_sku_norm);

create index if not exists erp_channel_sku_map_mapped_variant_idx
  on public.erp_channel_sku_map (mapped_variant_id);

create index if not exists erp_channel_sku_map_channel_asin_idx
  on public.erp_channel_sku_map (channel_key, asin);

drop trigger if exists erp_channel_sku_map_set_updated on public.erp_channel_sku_map;
create trigger erp_channel_sku_map_set_updated
before update on public.erp_channel_sku_map
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_channel_sku_map enable row level security;
alter table public.erp_channel_sku_map force row level security;

do $$
begin
  drop policy if exists erp_channel_sku_map_select on public.erp_channel_sku_map;
  drop policy if exists erp_channel_sku_map_write on public.erp_channel_sku_map;

  create policy erp_channel_sku_map_select
    on public.erp_channel_sku_map
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

  create policy erp_channel_sku_map_write
    on public.erp_channel_sku_map
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

create or replace function public.erp_channel_sku_map_upsert(
  p_company_id uuid,
  p_channel_key text,
  p_marketplace_id text,
  p_external_sku text,
  p_asin text,
  p_fnsku text,
  p_mapped_variant_id uuid,
  p_active boolean,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_external_sku text;
  v_external_sku_norm text;
  v_marketplace_id text;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  v_external_sku := nullif(trim(p_external_sku), '');
  if v_external_sku is null then
    raise exception 'external_sku is required';
  end if;

  if p_channel_key is null or nullif(trim(p_channel_key), '') is null then
    raise exception 'channel_key is required';
  end if;

  if p_mapped_variant_id is null then
    raise exception 'mapped_variant_id is required';
  end if;

  v_external_sku_norm := lower(regexp_replace(v_external_sku, '\\s+', ' ', 'g'));
  v_marketplace_id := nullif(trim(p_marketplace_id), '');

  insert into public.erp_channel_sku_map (
    company_id,
    channel_key,
    marketplace_id,
    external_sku,
    external_sku_norm,
    asin,
    fnsku,
    mapped_variant_id,
    active,
    notes,
    created_by,
    updated_by
  ) values (
    v_company_id,
    trim(p_channel_key),
    v_marketplace_id,
    v_external_sku,
    v_external_sku_norm,
    nullif(trim(p_asin), ''),
    nullif(trim(p_fnsku), ''),
    p_mapped_variant_id,
    coalesce(p_active, true),
    nullif(trim(p_notes), ''),
    v_actor,
    v_actor
  )
  on conflict on constraint erp_channel_sku_map_unique
  do update set
    marketplace_id = excluded.marketplace_id,
    external_sku = excluded.external_sku,
    asin = excluded.asin,
    fnsku = excluded.fnsku,
    mapped_variant_id = excluded.mapped_variant_id,
    active = excluded.active,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.erp_channel_sku_map_upsert(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  boolean,
  text
) from public;

grant execute on function public.erp_channel_sku_map_upsert(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  boolean,
  text
) to authenticated;

create or replace function public.erp_channel_sku_map_list(
  p_company_id uuid,
  p_channel_key text,
  p_q text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  id uuid,
  external_sku text,
  external_sku_norm text,
  marketplace_id text,
  asin text,
  fnsku text,
  active boolean,
  notes text,
  mapped_variant_id uuid,
  sku text,
  style_code text,
  size text,
  color text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_q text := nullif(trim(p_q), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_reader();
  end if;

  return query
  select
    m.id,
    m.external_sku,
    m.external_sku_norm,
    m.marketplace_id,
    m.asin,
    m.fnsku,
    m.active,
    m.notes,
    m.mapped_variant_id,
    v.sku,
    v.style_code,
    v.size,
    v.color,
    m.created_at,
    m.updated_at
  from public.erp_channel_sku_map m
  left join public.erp_variants v
    on v.id = m.mapped_variant_id
  where m.company_id = v_company_id
    and m.channel_key = p_channel_key
    and (
      v_q is null
      or m.external_sku ilike '%' || v_q || '%'
      or coalesce(m.asin, '') ilike '%' || v_q || '%'
      or coalesce(m.fnsku, '') ilike '%' || v_q || '%'
      or coalesce(v.sku, '') ilike '%' || v_q || '%'
      or coalesce(v.style_code, '') ilike '%' || v_q || '%'
    )
  order by m.updated_at desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_channel_sku_map_list(uuid, text, text, int, int) from public;

grant execute on function public.erp_channel_sku_map_list(uuid, text, text, int, int) to authenticated;

create or replace function public.erp_external_inventory_batch_rematch(
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_direct int := 0;
  v_mapped int := 0;
  v_matched int := 0;
  v_unmatched int := 0;
  v_total int := 0;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if not exists (
    select 1
    from public.erp_external_inventory_batches b
    where b.id = p_batch_id
      and b.company_id = v_company_id
  ) then
    raise exception 'Batch not found';
  end if;

  update public.erp_external_inventory_rows r
     set matched_variant_id = v.id,
         match_status = 'matched'
    from public.erp_variants v
   where r.company_id = v_company_id
     and r.batch_id = p_batch_id
     and r.match_status = 'unmatched'
     and r.matched_variant_id is null
     and lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))
         = lower(regexp_replace(trim(v.sku), '\\s+', ' ', 'g'));

  get diagnostics v_direct = row_count;

  update public.erp_external_inventory_rows r
     set matched_variant_id = m.mapped_variant_id,
         match_status = 'matched'
    from public.erp_channel_sku_map m
   where r.company_id = v_company_id
     and r.batch_id = p_batch_id
     and r.match_status = 'unmatched'
     and r.matched_variant_id is null
     and m.company_id = v_company_id
     and m.channel_key = r.channel_key
     and m.active
     and m.marketplace_id_norm = coalesce(r.marketplace_id, '')
     and m.external_sku_norm = lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'));

  get diagnostics v_mapped = row_count;

  select
    count(*) filter (where r.match_status = 'matched')::int,
    count(*) filter (where r.match_status = 'unmatched')::int,
    count(*)::int
  into v_matched, v_unmatched, v_total
  from public.erp_external_inventory_rows r
  where r.company_id = v_company_id
    and r.batch_id = p_batch_id;

  update public.erp_external_inventory_batches
     set matched_count = v_matched,
         unmatched_count = v_unmatched,
         rows_total = v_total
   where id = p_batch_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok', true,
    'updated_direct', v_direct,
    'updated_mapped', v_mapped,
    'matched', v_matched,
    'unmatched', v_unmatched
  );
end;
$$;

revoke all on function public.erp_external_inventory_batch_rematch(uuid) from public;

grant execute on function public.erp_external_inventory_batch_rematch(uuid) to authenticated;
