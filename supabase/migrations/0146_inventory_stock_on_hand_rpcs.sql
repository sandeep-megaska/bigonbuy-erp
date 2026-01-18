create or replace function public.erp_inventory_stock_on_hand_list(
  p_warehouse_id uuid default null,
  p_query text default null,
  p_in_stock_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  warehouse_id uuid,
  warehouse_code text,
  warehouse_name text,
  variant_id uuid,
  sku text,
  style_code text,
  product_title text,
  color text,
  size text,
  hsn text,
  qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(trim(p_query), '') as q
  ),
  ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(l.qty)::numeric as qty
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
    group by l.warehouse_id, l.variant_id
  )
  select
    lt.warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    lt.variant_id,
    v.sku,
    p.style_code,
    p.title as product_title,
    v.color,
    v.size,
    p.hsn_code as hsn,
    lt.qty
  from ledger_totals lt
  join public.erp_variants v
    on v.id = lt.variant_id
  join public.erp_products p
    on p.id = v.product_id
  left join public.erp_warehouses w
    on w.id = lt.warehouse_id
   and w.company_id = public.erp_current_company_id()
  where p.company_id = public.erp_current_company_id()
    and v.company_id = public.erp_current_company_id()
    and (
      (select q from normalized) is null
      or v.sku ilike '%' || (select q from normalized) || '%'
      or coalesce(p.style_code, '') ilike '%' || (select q from normalized) || '%'
      or p.title ilike '%' || (select q from normalized) || '%'
    )
    and (not p_in_stock_only or lt.qty > 0)
  order by v.sku asc
  limit p_limit
  offset p_offset;
$$;

create or replace function public.erp_inventory_stock_movements(
  p_warehouse_id uuid,
  p_variant_id uuid,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  movement_date date,
  source_type text,
  source_id uuid,
  reference text,
  reason text,
  qty_delta numeric,
  balance_after numeric,
  created_by uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.created_at,
    l.created_at::date as movement_date,
    l.type as source_type,
    case
      when l.ref ~* '([0-9a-f-]{36})' then substring(l.ref from '([0-9a-f-]{36})')::uuid
      else null
    end as source_id,
    l.ref as reference,
    l.reason,
    l.qty::numeric as qty_delta,
    null::numeric as balance_after,
    l.created_by
  from public.erp_inventory_ledger l
  where l.company_id = public.erp_current_company_id()
    and l.warehouse_id = p_warehouse_id
    and l.variant_id = p_variant_id
  order by l.created_at desc
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.erp_inventory_stock_on_hand_list(uuid, text, boolean, int, int) from public;
grant execute on function public.erp_inventory_stock_on_hand_list(uuid, text, boolean, int, int) to authenticated;

revoke all on function public.erp_inventory_stock_movements(uuid, uuid, int, int) from public;
grant execute on function public.erp_inventory_stock_movements(uuid, uuid, int, int) to authenticated;

notify pgrst, 'reload schema';
