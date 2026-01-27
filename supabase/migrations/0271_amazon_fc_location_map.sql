begin;

create table if not exists public.erp_external_location_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_key text not null,
  marketplace_id text not null,
  external_location_code text not null,
  state_code text null,
  state_name text null,
  city text null,
  location_name text null,
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid()
);

create unique index if not exists erp_external_location_map_unique_idx
  on public.erp_external_location_map (company_id, channel_key, marketplace_id, lower(external_location_code));

create index if not exists erp_external_location_map_company_channel_idx
  on public.erp_external_location_map (company_id, channel_key, marketplace_id);

create index if not exists erp_external_location_map_company_channel_code_idx
  on public.erp_external_location_map (company_id, channel_key, marketplace_id, lower(external_location_code));

drop trigger if exists erp_external_location_map_set_updated on public.erp_external_location_map;
create trigger erp_external_location_map_set_updated
before update on public.erp_external_location_map
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_external_location_map enable row level security;
alter table public.erp_external_location_map force row level security;

do $$
begin
  drop policy if exists erp_external_location_map_select on public.erp_external_location_map;
  drop policy if exists erp_external_location_map_write on public.erp_external_location_map;

  create policy erp_external_location_map_select
    on public.erp_external_location_map
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

  create policy erp_external_location_map_write
    on public.erp_external_location_map
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

drop function if exists public.erp_external_location_map_upsert(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
);

create function public.erp_external_location_map_upsert(
  p_channel_key text,
  p_marketplace_id text,
  p_external_location_code text,
  p_state_code text default null,
  p_state_name text default null,
  p_city text default null,
  p_location_name text default null,
  p_active boolean default true,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_channel_key text;
  v_marketplace_id text;
  v_location_code text;
  v_location_norm text;
  v_existing_id uuid;
  v_id uuid;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  v_channel_key := nullif(trim(p_channel_key), '');
  if v_channel_key is null then
    raise exception 'channel_key is required';
  end if;

  v_marketplace_id := nullif(trim(p_marketplace_id), '');
  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  v_location_code := nullif(trim(p_external_location_code), '');
  if v_location_code is null then
    raise exception 'external_location_code is required';
  end if;

  v_location_norm := lower(v_location_code);

  select id
    into v_existing_id
  from public.erp_external_location_map m
  where m.company_id = v_company_id
    and m.channel_key = v_channel_key
    and m.marketplace_id = v_marketplace_id
    and lower(m.external_location_code) = v_location_norm
  limit 1;

  if v_existing_id is null then
    insert into public.erp_external_location_map (
      company_id,
      channel_key,
      marketplace_id,
      external_location_code,
      state_code,
      state_name,
      city,
      location_name,
      active,
      notes,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_channel_key,
      v_marketplace_id,
      v_location_code,
      nullif(trim(p_state_code), ''),
      nullif(trim(p_state_name), ''),
      nullif(trim(p_city), ''),
      nullif(trim(p_location_name), ''),
      coalesce(p_active, true),
      nullif(trim(p_notes), ''),
      v_actor,
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_external_location_map
       set state_code = nullif(trim(p_state_code), ''),
           state_name = nullif(trim(p_state_name), ''),
           city = nullif(trim(p_city), ''),
           location_name = nullif(trim(p_location_name), ''),
           active = coalesce(p_active, true),
           notes = nullif(trim(p_notes), ''),
           updated_at = now(),
           updated_by = v_actor
     where id = v_existing_id
     returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_external_location_map_upsert(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) from public;

grant execute on function public.erp_external_location_map_upsert(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text
) to authenticated;

drop function if exists public.erp_external_location_map_list(text, text, text, int, int);

create function public.erp_external_location_map_list(
  p_channel_key text default 'amazon',
  p_marketplace_id text default null,
  p_q text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  id uuid,
  channel_key text,
  marketplace_id text,
  external_location_code text,
  state_code text,
  state_name text,
  city text,
  location_name text,
  active boolean,
  notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_key text := nullif(trim(p_channel_key), '');
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_q text := nullif(trim(p_q), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  perform public.erp_require_inventory_reader();

  return query
  select
    m.id,
    m.channel_key,
    m.marketplace_id,
    m.external_location_code,
    m.state_code,
    m.state_name,
    m.city,
    m.location_name,
    m.active,
    m.notes
  from public.erp_external_location_map m
  where m.company_id = v_company_id
    and (v_channel_key is null or m.channel_key = v_channel_key)
    and (v_marketplace_id is null or m.marketplace_id = v_marketplace_id)
    and (
      v_q is null
      or m.external_location_code ilike '%' || v_q || '%'
      or m.state_name ilike '%' || v_q || '%'
      or m.city ilike '%' || v_q || '%'
    )
  order by m.external_location_code
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_location_map_list(text, text, text, int, int) from public;
grant execute on function public.erp_external_location_map_list(text, text, text, int, int) to authenticated;

drop function if exists public.erp_external_location_unmapped_list(uuid, int, int);

create function public.erp_external_location_unmapped_list(
  p_batch_id uuid,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  external_location_code text,
  rows_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text;
  v_channel_key text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  perform public.erp_require_inventory_reader();

  select b.marketplace_id, b.channel_key
    into v_marketplace_id, v_channel_key
  from public.erp_external_inventory_batches b
  where b.id = p_batch_id
    and b.company_id = v_company_id;

  if v_channel_key is null then
    raise exception 'Batch not found';
  end if;

  return query
  with scoped as (
    select
      r.external_location_code,
      count(*)::int as rows_count
    from public.erp_external_inventory_rows r
    where r.company_id = v_company_id
      and r.batch_id = p_batch_id
      and nullif(trim(r.external_location_code), '') is not null
      and lower(nullif(trim(r.external_location_code), '')) <> 'unknown'
    group by r.external_location_code
  )
  select
    s.external_location_code,
    s.rows_count
  from scoped s
  left join public.erp_external_location_map m
    on m.company_id = v_company_id
   and m.channel_key = v_channel_key
   and m.marketplace_id = v_marketplace_id
   and lower(m.external_location_code) = lower(s.external_location_code)
  where m.id is null
  order by s.rows_count desc, s.external_location_code
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_location_unmapped_list(uuid, int, int) from public;
grant execute on function public.erp_external_location_unmapped_list(uuid, int, int) to authenticated;

drop function if exists public.erp_external_inventory_location_rollup_v2(uuid, int, int);

create function public.erp_external_inventory_location_rollup_v2(
  p_batch_id uuid,
  p_limit int default 500,
  p_offset int default 0
) returns table (
  external_location_code text,
  state_code text,
  state_name text,
  city text,
  location_name text,
  rows_count int,
  matched_rows int,
  unmatched_rows int,
  available_total int,
  inbound_total int,
  reserved_total int
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
    coalesce(r.external_location_code, 'UNKNOWN') as external_location_code,
    m.state_code,
    m.state_name,
    m.city,
    m.location_name,
    count(*)::int as rows_count,
    sum(case when r.match_status = 'matched' then 1 else 0 end)::int as matched_rows,
    sum(case when coalesce(r.match_status, 'unmatched') <> 'matched' then 1 else 0 end)::int as unmatched_rows,
    sum(coalesce(r.available_qty, 0))::int as available_total,
    sum(coalesce(r.inbound_qty, 0))::int as inbound_total,
    sum(coalesce(r.reserved_qty, 0))::int as reserved_total
  from public.erp_external_inventory_rows r
  left join public.erp_external_location_map m
    on m.company_id = r.company_id
   and m.channel_key = r.channel_key
   and m.marketplace_id = r.marketplace_id
   and lower(m.external_location_code) = lower(r.external_location_code)
  where r.company_id = public.erp_current_company_id()
    and r.batch_id = p_batch_id
  group by
    coalesce(r.external_location_code, 'UNKNOWN'),
    m.state_code,
    m.state_name,
    m.city,
    m.location_name
  order by available_total desc, external_location_code
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_inventory_location_rollup_v2(uuid, int, int) from public;
grant execute on function public.erp_external_inventory_location_rollup_v2(uuid, int, int) to authenticated;

commit;
