-- 0265_fix_amazon_inventory_rows_list.sql
-- Fix external inventory rows list RPC to use unified external inventory rows schema

begin;

-- Important: must DROP first to allow return type/column changes
drop function if exists public.erp_external_inventory_rows_list(uuid, boolean, int, int);

create function public.erp_external_inventory_rows_list(
  p_batch_id uuid,
  p_only_unmatched boolean default false,
  p_limit int default 500,
  p_offset int default 0
)
returns table (
  id uuid,
  batch_id uuid,
  external_sku text,
  match_status text,
  erp_variant_id uuid,
  matched_variant_id uuid,
  available_qty int,
  inbound_qty int,
  reserved_qty int,
  location text,
  marketplace_id text,
  asin text,
  fnsku text,
  sku text,
  variant_title text,
  variant_size text,
  variant_color text
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
    r.batch_id,
    r.external_sku,
    r.match_status,
    r.erp_variant_id,
    r.matched_variant_id,
    r.available_qty::int,
    r.inbound_qty::int,
    r.reserved_qty::int,
    r.location,
    r.marketplace_id,
    r.asin,
    r.fnsku,
    v.sku_code as sku,
    v.title as variant_title,
    v.size as variant_size,
    v.color as variant_color
  from public.erp_external_inventory_rows r
  left join public.erp_variants v
    on v.id = coalesce(r.matched_variant_id, r.erp_variant_id)
  where r.company_id = public.erp_current_company_id()
    and r.batch_id = p_batch_id
    and (not p_only_unmatched or coalesce(r.match_status, 'unmatched') = 'unmatched')
  order by r.external_sku
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) from public;
grant execute on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) to authenticated;

commit;
