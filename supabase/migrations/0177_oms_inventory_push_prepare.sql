-- OMS inventory push preparation helpers

create or replace function public.erp_oms_channel_default_warehouse(p_channel_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.warehouse_id
    from public.erp_channel_locations l
    join public.erp_channel_accounts ca
      on ca.id = l.channel_account_id
     and ca.company_id = public.erp_current_company_id()
   where l.company_id = public.erp_current_company_id()
     and l.channel_account_id = p_channel_account_id
     and l.is_default
     and l.is_active
   order by l.created_at desc
   limit 1;
$$;

create or replace function public.erp_oms_alias_coverage(
  p_channel_account_id uuid,
  p_warehouse_id uuid default null
)
returns table(
  warehouse_id uuid,
  total_variants bigint,
  mapped_variants bigint,
  unmapped_variants bigint,
  coverage_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_warehouse as (
    select coalesce(p_warehouse_id, public.erp_oms_channel_default_warehouse(p_channel_account_id)) as warehouse_id
  ),
  availability as (
    select a.variant_id
      from public.erp_inventory_available((select warehouse_id from selected_warehouse)) a
     where (select warehouse_id from selected_warehouse) is not null
       and a.available > 0
  ),
  mapped as (
    select distinct a.variant_id
      from availability av
      join public.erp_channel_listing_aliases a
        on a.company_id = public.erp_current_company_id()
       and a.channel_account_id = p_channel_account_id
       and a.variant_id = av.variant_id
       and a.is_active
  )
  select
    (select warehouse_id from selected_warehouse) as warehouse_id,
    count(distinct availability.variant_id) as total_variants,
    count(distinct mapped.variant_id) as mapped_variants,
    count(distinct availability.variant_id) - count(distinct mapped.variant_id) as unmapped_variants,
    case
      when count(distinct availability.variant_id) = 0 then 0
      else (count(distinct mapped.variant_id)::numeric / count(distinct availability.variant_id)::numeric) * 100
    end as coverage_pct
  from availability
  left join mapped
    on mapped.variant_id = availability.variant_id;
$$;

create or replace function public.erp_oms_inventory_push_preview(
  p_channel_account_id uuid,
  p_warehouse_id uuid default null,
  p_only_mapped boolean default true,
  p_limit int default 500,
  p_offset int default 0
)
returns table(
  variant_id uuid,
  internal_sku text,
  available numeric,
  channel_sku text,
  asin text,
  listing_id text,
  is_mapped boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_warehouse as (
    select coalesce(p_warehouse_id, public.erp_oms_channel_default_warehouse(p_channel_account_id)) as warehouse_id
  ),
  availability as (
    select a.variant_id,
           a.internal_sku,
           a.available
      from public.erp_inventory_available((select warehouse_id from selected_warehouse)) a
     where (select warehouse_id from selected_warehouse) is not null
       and a.available > 0
  )
  select
    av.variant_id,
    av.internal_sku,
    av.available,
    alias.channel_sku,
    alias.asin,
    alias.listing_id,
    (alias.id is not null) as is_mapped
  from availability av
  left join public.erp_channel_listing_aliases alias
    on alias.company_id = public.erp_current_company_id()
   and alias.channel_account_id = p_channel_account_id
   and alias.variant_id = av.variant_id
   and alias.is_active
  where (not p_only_mapped) or alias.id is not null
  order by av.internal_sku
  limit p_limit
  offset p_offset;
$$;

create or replace function public.erp_oms_inventory_push_job_create(
  p_channel_account_id uuid,
  p_warehouse_id uuid default null,
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
  v_job_id uuid;
  v_warehouse_id uuid;
  v_item_count bigint := 0;
  v_total_qty bigint := 0;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
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

  v_warehouse_id := coalesce(p_warehouse_id, public.erp_oms_channel_default_warehouse(p_channel_account_id));

  if v_warehouse_id is null then
    raise exception 'No default warehouse configured';
  end if;

  with preview as (
    select *
      from public.erp_oms_inventory_push_preview(
        p_channel_account_id,
        v_warehouse_id,
        true,
        100000,
        0
      )
     where available > 0
  )
  select
    count(*)::bigint,
    coalesce(sum(greatest(floor(available)::int, 0))::bigint, 0)
    into v_item_count, v_total_qty
  from preview;

  v_payload := v_payload || jsonb_build_object(
    'warehouse_id', v_warehouse_id,
    'summary', jsonb_build_object(
      'item_count', v_item_count,
      'total_qty', v_total_qty
    )
  );

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
    'inventory_push',
    'queued',
    v_payload,
    v_actor,
    now()
  ) returning id into v_job_id;

  insert into public.erp_channel_job_items (
    job_id,
    status,
    attempt_count,
    key,
    payload,
    created_at
  )
  select
    v_job_id,
    'queued',
    0,
    preview.channel_sku,
    jsonb_build_object(
      'warehouse_id', v_warehouse_id,
      'variant_id', preview.variant_id,
      'internal_sku', preview.internal_sku,
      'qty', greatest(floor(preview.available)::int, 0),
      'channel_sku', preview.channel_sku,
      'asin', preview.asin,
      'listing_id', preview.listing_id
    ),
    now()
  from public.erp_oms_inventory_push_preview(
    p_channel_account_id,
    v_warehouse_id,
    true,
    100000,
    0
  ) as preview
  where preview.available > 0;

  return v_job_id;
end;
$$;

revoke all on function public.erp_oms_channel_default_warehouse(uuid) from public;
grant execute on function public.erp_oms_channel_default_warehouse(uuid) to authenticated;

revoke all on function public.erp_oms_alias_coverage(uuid, uuid) from public;
grant execute on function public.erp_oms_alias_coverage(uuid, uuid) to authenticated;

revoke all on function public.erp_oms_inventory_push_preview(uuid, uuid, boolean, int, int) from public;
grant execute on function public.erp_oms_inventory_push_preview(uuid, uuid, boolean, int, int) to authenticated;

revoke all on function public.erp_oms_inventory_push_job_create(uuid, uuid, jsonb) from public;
grant execute on function public.erp_oms_inventory_push_job_create(uuid, uuid, jsonb) to authenticated;
