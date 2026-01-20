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

-- IMPORTANT: Postgres cannot CREATE OR REPLACE if return rowtype changes
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
  external_sku_norm text,
  match_status text,
  matched_variant_id uuid,
  available_qty int,
  reserved_qty int,
  inbound_qty int,
  location text,
  asin text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.batch_id,
    r.external_sku,
    r.external_sku_norm,
    r.match_status,
    r.matched_variant_id,
    r.available_qty,
    r.reserved_qty,
    r.inbound_qty,
    r.location,
    r.asin
  from public.erp_external_inventory_rows r
  where r.batch_id = p_batch_id
    and (not p_only_unmatched or coalesce(r.match_status,'unmatched') = 'unmatched')
  order by r.external_sku_norm nulls last, r.external_sku nulls last
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

-- re-grant if your project uses grants explicitly
grant execute on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) to authenticated;


revoke all on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) from public;
grant execute on function public.erp_external_inventory_rows_list(uuid, boolean, int, int) to authenticated;
