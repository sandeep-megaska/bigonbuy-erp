alter table public.erp_grn_lines
  add column if not exists landed_cost_per_unit numeric(12, 2) null;

create or replace function public.erp_inventory_valuation(
  p_warehouse_id uuid default null,
  p_query text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  warehouse_id uuid,
  warehouse_name text,
  variant_id uuid,
  sku text,
  style_code text,
  product_title text,
  size text,
  color text,
  on_hand integer,
  wac numeric(12, 2),
  stock_value numeric(14, 2)
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
      sum(l.qty)::integer as qty
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
    group by l.warehouse_id, l.variant_id
  ),
  cost_totals as (
    select
      gl.warehouse_id,
      gl.variant_id,
      sum(abs(gl.received_qty) * coalesce(gl.landed_cost_per_unit, gl.unit_cost)) as cost_total,
      sum(abs(gl.received_qty)) as qty_total
    from public.erp_grn_lines gl
    join public.erp_grns g
      on g.id = gl.grn_id
    where gl.company_id = public.erp_current_company_id()
      and g.company_id = public.erp_current_company_id()
      and g.status = 'posted'
      and coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
      and (p_warehouse_id is null or gl.warehouse_id = p_warehouse_id)
    group by gl.warehouse_id, gl.variant_id
  )
  select
    lt.warehouse_id,
    w.name as warehouse_name,
    lt.variant_id,
    v.sku,
    p.style_code,
    p.title as product_title,
    v.size,
    v.color,
    lt.qty as on_hand,
    case
      when ct.qty_total > 0 then round((ct.cost_total / ct.qty_total)::numeric, 2)
      else null
    end as wac,
    case
      when ct.qty_total > 0 then round((lt.qty * (ct.cost_total / ct.qty_total))::numeric, 2)
      else null
    end as stock_value
  from ledger_totals lt
  join public.erp_variants v
    on v.id = lt.variant_id
  join public.erp_products p
    on p.id = v.product_id
  left join public.erp_warehouses w
    on w.id = lt.warehouse_id
   and w.company_id = public.erp_current_company_id()
  left join cost_totals ct
    on ct.variant_id = lt.variant_id
   and ct.warehouse_id = lt.warehouse_id
  where p.company_id = public.erp_current_company_id()
    and v.company_id = public.erp_current_company_id()
    and (
      (select q from normalized) is null
      or v.sku ilike '%' || (select q from normalized) || '%'
      or coalesce(p.style_code, '') ilike '%' || (select q from normalized) || '%'
      or p.title ilike '%' || (select q from normalized) || '%'
    )
  order by v.sku asc
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.erp_inventory_valuation(uuid, text, int, int) from public;
grant execute on function public.erp_inventory_valuation(uuid, text, int, int) to authenticated;
