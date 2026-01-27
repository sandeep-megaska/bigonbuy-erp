begin;

create index if not exists erp_external_inventory_rows_batch_location_variant_idx
  on public.erp_external_inventory_rows (batch_id, external_location_code, matched_variant_id);

drop function if exists public.erp_external_inventory_location_rollup(uuid, int, int);

create function public.erp_external_inventory_location_rollup(
  p_batch_id uuid,
  p_limit int default 500,
  p_offset int default 0
)
returns table (
  external_location_code text,
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
    count(*)::int as rows_count,
    sum(case when r.match_status = 'matched' then 1 else 0 end)::int as matched_rows,
    sum(case when coalesce(r.match_status, 'unmatched') <> 'matched' then 1 else 0 end)::int as unmatched_rows,
    sum(coalesce(r.available_qty, 0))::int as available_total,
    sum(coalesce(r.inbound_qty, 0))::int as inbound_total,
    sum(coalesce(r.reserved_qty, 0))::int as reserved_total
  from public.erp_external_inventory_rows r
  where r.company_id = public.erp_current_company_id()
    and r.batch_id = p_batch_id
  group by coalesce(r.external_location_code, 'UNKNOWN')
  order by available_total desc, external_location_code
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_inventory_location_rollup(uuid, int, int) from public;
grant execute on function public.erp_external_inventory_location_rollup(uuid, int, int) to authenticated;

drop function if exists public.erp_external_inventory_location_sku_rollup(uuid, text, int, int);

create function public.erp_external_inventory_location_sku_rollup(
  p_batch_id uuid,
  p_external_location_code text,
  p_limit int default 500,
  p_offset int default 0
)
returns table (
  external_location_code text,
  matched_variant_id uuid,
  sku text,
  variant_title text,
  variant_size text,
  variant_color text,
  external_sku_sample text,
  rows_count int,
  available_total int,
  inbound_total int,
  reserved_total int,
  unmatched_rows int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_reader();

  return query
  with scoped as (
    select
      r.*,
      coalesce(r.external_location_code, 'UNKNOWN') as location_code,
      coalesce(r.matched_variant_id, r.erp_variant_id) as variant_id,
      case
        when coalesce(r.matched_variant_id, r.erp_variant_id) is null then r.external_sku
        else null
      end as external_sku_group
    from public.erp_external_inventory_rows r
    where r.company_id = public.erp_current_company_id()
      and r.batch_id = p_batch_id
      and coalesce(r.external_location_code, 'UNKNOWN') = coalesce(p_external_location_code, 'UNKNOWN')
  )
  select
    scoped.location_code as external_location_code,
    scoped.variant_id as matched_variant_id,
    v.sku,
    v.style_code as variant_title,
    v.size as variant_size,
    v.color as variant_color,
    max(case when scoped.external_sku_group is not null then scoped.external_sku end) as external_sku_sample,
    count(*)::int as rows_count,
    sum(coalesce(scoped.available_qty, 0))::int as available_total,
    sum(coalesce(scoped.inbound_qty, 0))::int as inbound_total,
    sum(coalesce(scoped.reserved_qty, 0))::int as reserved_total,
    sum(case when coalesce(scoped.match_status, 'unmatched') <> 'matched' then 1 else 0 end)::int as unmatched_rows
  from scoped
  left join public.erp_variants v
    on v.id = scoped.variant_id
  group by
    scoped.location_code,
    scoped.variant_id,
    v.sku,
    v.style_code,
    v.size,
    v.color,
    scoped.external_sku_group
  order by available_total desc, v.sku nulls last, external_sku_sample nulls last
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_inventory_location_sku_rollup(uuid, text, int, int) from public;
grant execute on function public.erp_external_inventory_location_sku_rollup(uuid, text, int, int) to authenticated;

commit;
