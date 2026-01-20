alter table public.erp_external_inventory_batches
  add column if not exists created_at timestamptz default now(),
  add column if not exists report_id text,
  add column if not exists report_document_id text,
  add column if not exists report_type text,
  add column if not exists rows_total int,
  add column if not exists matched_count int,
  add column if not exists unmatched_count int,
  add column if not exists error text;

alter table public.erp_external_inventory_batches
  alter column status set default 'requested';

alter table public.erp_external_inventory_rows
  add column if not exists external_sku_norm text,
  add column if not exists available_qty int,
  add column if not exists reserved_qty int,
  add column if not exists inbound_qty int,
  add column if not exists location text,
  add column if not exists matched_variant_id uuid,
  add column if not exists match_status text default 'unmatched';

create index if not exists erp_external_inventory_rows_batch_idx
  on public.erp_external_inventory_rows (batch_id);

create index if not exists erp_external_inventory_rows_external_sku_norm_idx
  on public.erp_external_inventory_rows (external_sku_norm);

create index if not exists erp_external_inventory_rows_matched_variant_idx
  on public.erp_external_inventory_rows (matched_variant_id);

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
  sku text,
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
    v.sku,
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
