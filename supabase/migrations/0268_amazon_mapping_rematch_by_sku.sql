-- 0268_amazon_mapping_rematch_by_sku.sql

drop function if exists public.erp_external_inventory_rematch_by_external_sku(uuid, text);
drop function if exists public.erp_variants_resolve_by_sku(uuid, text[]);
drop function if exists public.erp_channel_sku_map_bulk_upsert(uuid, text, text, jsonb);

create or replace function public.erp_external_inventory_rematch_by_external_sku(
  p_batch_id uuid,
  p_external_sku text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_batch_company_id uuid;
  v_external_sku text;
  v_external_sku_norm text;
  v_updated_rows int := 0;
  v_matched_rows int := 0;
  v_unmatched_rows int := 0;
  v_batch_matched int := 0;
  v_batch_unmatched int := 0;
  v_batch_total int := 0;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  select b.company_id
    into v_batch_company_id
  from public.erp_external_inventory_batches b
  where b.id = p_batch_id;

  if v_batch_company_id is null or v_batch_company_id <> v_company_id then
    raise exception 'Batch not found';
  end if;

  v_external_sku := nullif(trim(p_external_sku), '');
  if v_external_sku is null then
    raise exception 'external_sku is required';
  end if;

  v_external_sku_norm := lower(regexp_replace(v_external_sku, '\\s+', ' ', 'g'));

  select count(*)::int
    into v_updated_rows
  from public.erp_external_inventory_rows r
  where r.company_id = v_company_id
    and r.batch_id = p_batch_id
    and coalesce(r.external_sku_norm, lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))) = v_external_sku_norm;

  update public.erp_external_inventory_rows r
     set matched_variant_id = null,
         match_status = 'unmatched'
   where r.company_id = v_company_id
     and r.batch_id = p_batch_id
     and coalesce(r.external_sku_norm, lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))) = v_external_sku_norm;

  update public.erp_external_inventory_rows r
     set matched_variant_id = v.id,
         match_status = 'matched'
    from public.erp_variants v
   where r.company_id = v_company_id
     and r.batch_id = p_batch_id
     and r.match_status = 'unmatched'
     and r.matched_variant_id is null
     and coalesce(r.external_sku_norm, lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))) = v_external_sku_norm
     and lower(regexp_replace(trim(v.sku), '\\s+', ' ', 'g')) = v_external_sku_norm;

  update public.erp_external_inventory_rows r
     set matched_variant_id = m.mapped_variant_id,
         match_status = 'matched'
    from public.erp_channel_sku_map m
   where r.company_id = v_company_id
     and r.batch_id = p_batch_id
     and r.match_status = 'unmatched'
     and r.matched_variant_id is null
     and coalesce(r.external_sku_norm, lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))) = v_external_sku_norm
     and m.company_id = v_company_id
     and m.channel_key = 'amazon'
     and m.active
     and m.marketplace_id_norm = coalesce(r.marketplace_id, '')
     and m.external_sku_norm = v_external_sku_norm;

  select
    count(*) filter (where r.match_status = 'matched')::int,
    count(*) filter (where r.match_status = 'unmatched')::int
  into v_matched_rows, v_unmatched_rows
  from public.erp_external_inventory_rows r
  where r.company_id = v_company_id
    and r.batch_id = p_batch_id
    and coalesce(r.external_sku_norm, lower(regexp_replace(trim(r.external_sku), '\\s+', ' ', 'g'))) = v_external_sku_norm;

  select
    count(*) filter (where r.match_status = 'matched')::int,
    count(*) filter (where r.match_status = 'unmatched')::int,
    count(*)::int
  into v_batch_matched, v_batch_unmatched, v_batch_total
  from public.erp_external_inventory_rows r
  where r.company_id = v_company_id
    and r.batch_id = p_batch_id;

  update public.erp_external_inventory_batches
     set matched_count = v_batch_matched,
         unmatched_count = v_batch_unmatched,
         rows_total = v_batch_total
   where id = p_batch_id
     and company_id = v_company_id;

  return json_build_object(
    'ok', true,
    'sku_norm', v_external_sku_norm,
    'updated_rows', v_updated_rows,
    'matched_rows', v_matched_rows,
    'unmatched_rows', v_unmatched_rows
  );
end;
$$;

revoke all on function public.erp_external_inventory_rematch_by_external_sku(uuid, text) from public;
grant execute on function public.erp_external_inventory_rematch_by_external_sku(uuid, text) to authenticated;

create or replace function public.erp_variants_resolve_by_sku(
  p_company_id uuid,
  p_skus text[]
) returns table (
  sku text,
  variant_id uuid,
  style_code text,
  size text,
  color text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
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
  with requested as (
    select distinct lower(regexp_replace(trim(sku), '\\s+', ' ', 'g')) as sku_norm
    from unnest(p_skus) as sku
    where nullif(trim(sku), '') is not null
  )
  select
    v.sku,
    v.id,
    v.style_code,
    v.size,
    v.color
  from requested r
  join public.erp_variants v
    on v.company_id = v_company_id
   and lower(regexp_replace(trim(v.sku), '\\s+', ' ', 'g')) = r.sku_norm;
end;
$$;

revoke all on function public.erp_variants_resolve_by_sku(uuid, text[]) from public;
grant execute on function public.erp_variants_resolve_by_sku(uuid, text[]) to authenticated;

create or replace function public.erp_channel_sku_map_bulk_upsert(
  p_company_id uuid,
  p_channel_key text,
  p_marketplace_id text,
  p_rows jsonb
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_marketplace_id text;
  v_channel_key text;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
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

  if p_channel_key is null or nullif(trim(p_channel_key), '') is null then
    raise exception 'channel_key is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  v_marketplace_id := nullif(trim(p_marketplace_id), '');
  v_channel_key := trim(p_channel_key);

  with raw_rows as (
    select
      ordinality as row_index,
      nullif(trim(value->>'external_sku'), '') as external_sku,
      nullif(trim(value->>'asin'), '') as asin,
      nullif(trim(value->>'fnsku'), '') as fnsku,
      nullif(trim(value->>'mapped_variant_id'), '')::uuid as mapped_variant_id,
      nullif(trim(value->>'notes'), '') as notes,
      case
        when value ? 'active' then
          case lower(nullif(trim(value->>'active'), ''))
            when 'true' then true
            when 'false' then false
            when '1' then true
            when '0' then false
            when 'yes' then true
            when 'no' then false
            else null
          end
        else null
      end as active
    from jsonb_array_elements(p_rows) with ordinality
  ),
  normalized as (
    select
      row_index,
      external_sku,
      case
        when external_sku is null then null
        else lower(regexp_replace(external_sku, '\\s+', ' ', 'g'))
      end as external_sku_norm,
      asin,
      fnsku,
      mapped_variant_id,
      notes,
      active
    from raw_rows
  ),
  invalid as (
    select
      row_index,
      external_sku,
      case
        when external_sku is null then 'external_sku is required'
        when mapped_variant_id is null then 'mapped_variant_id is required'
        else 'invalid row'
      end as reason
    from normalized
    where external_sku is null or mapped_variant_id is null
  ),
  upserted as (
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
    )
    select
      v_company_id,
      v_channel_key,
      v_marketplace_id,
      n.external_sku,
      n.external_sku_norm,
      n.asin,
      n.fnsku,
      n.mapped_variant_id,
      coalesce(n.active, true),
      n.notes,
      v_actor,
      v_actor
    from normalized n
    where n.external_sku is not null
      and n.mapped_variant_id is not null
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
    returning 1
  )
  select
    (select count(*) from upserted),
    (select count(*) from invalid),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'row_index', row_index,
          'reason', reason,
          'external_sku', external_sku
        )
      ),
      '[]'::jsonb
    )
  into v_inserted, v_skipped, v_errors
  from invalid;

  return json_build_object(
    'ok', true,
    'inserted_or_updated', v_inserted,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.erp_channel_sku_map_bulk_upsert(uuid, text, text, jsonb) from public;
grant execute on function public.erp_channel_sku_map_bulk_upsert(uuid, text, text, jsonb) to authenticated;
