-- 0257_recreate_inventory_effective_unit_cost_v.sql
-- Drop and recreate view to allow column reorder/rename

begin;

drop view if exists public.erp_inventory_effective_unit_cost_v;

create view public.erp_inventory_effective_unit_cost_v as
with ledger as (
  select *
  from public.erp_inventory_ledger
  where coalesce(is_void,false)=false
),
qty as (
  select company_id, warehouse_id, variant_id,
         sum(coalesce(qty_in,0) - coalesce(qty_out,0))::numeric as on_hand_qty
  from ledger
  group by 1,2,3
),
base as (
  select company_id, warehouse_id, variant_id,
         sum(coalesce(qty_in,0))::numeric as base_qty_in,
         sum(coalesce(qty_in,0) * coalesce(unit_cost,0))::numeric as base_cost_total
  from ledger
  where coalesce(qty_in,0) > 0
    and coalesce(unit_cost,0) > 0
    and entry_type in ('grn_in','purchase_in')
  group by 1,2,3
),
landed as (
  select company_id, warehouse_id, variant_id,
         sum(coalesce(line_value,0))::numeric as landed_cost_total
  from ledger
  where lower(coalesce(ref_type,'')) = 'expense'
    and coalesce(reference,'') like 'EXP/%'
  group by 1,2,3
),
ovr as (
  select company_id, sku, unit_cost as override_unit_cost
  from public.erp_sku_cost_overrides
  where effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
)
select
  q.company_id,
  q.warehouse_id,
  q.variant_id,
  v.sku,
  q.on_hand_qty,
  b.base_qty_in,
  (b.base_cost_total / nullif(b.base_qty_in,0)) as base_unit_cost,
  l.landed_cost_total,
  (l.landed_cost_total / nullif(coalesce(b.base_qty_in,q.on_hand_qty),0)) as landed_unit_cost_delta,
  o.override_unit_cost,
  v.cost_price as fallback_cost_price,
  ((b.base_cost_total / nullif(b.base_qty_in,0)) + (l.landed_cost_total / nullif(coalesce(b.base_qty_in,q.on_hand_qty),0))) as effective_unit_cost,
  coalesce(
    o.override_unit_cost,
    ((b.base_cost_total / nullif(b.base_qty_in,0)) + (l.landed_cost_total / nullif(coalesce(b.base_qty_in,q.on_hand_qty),0))),
    v.cost_price
  ) as effective_unit_cost_final,
  (q.on_hand_qty * coalesce(
    o.override_unit_cost,
    ((b.base_cost_total / nullif(b.base_qty_in,0)) + (l.landed_cost_total / nullif(coalesce(b.base_qty_in,q.on_hand_qty),0))),
    v.cost_price
  )) as effective_stock_value_final
from qty q
join public.erp_variants v on v.id = q.variant_id
left join base b on b.company_id=q.company_id and b.warehouse_id=q.warehouse_id and b.variant_id=q.variant_id
left join landed l on l.company_id=q.company_id and l.warehouse_id=q.warehouse_id and l.variant_id=q.variant_id
left join ovr o on o.company_id=q.company_id and o.sku = v.sku;

commit;
