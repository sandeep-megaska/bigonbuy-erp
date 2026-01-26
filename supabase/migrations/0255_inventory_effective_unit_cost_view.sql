create or replace view public.erp_inventory_effective_unit_cost_v as
  with ledger as (
    select
      l.company_id,
      l.warehouse_id,
      l.variant_id,
      l.qty_in,
      l.qty_out,
      l.unit_cost,
      l.line_value,
      l.ref_type,
      l.reference
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and coalesce(l.is_void, false) = false
  ),
  keys as (
    select distinct
      company_id,
      warehouse_id,
      variant_id
    from ledger
  ),
  on_hand_totals as (
    select
      company_id,
      warehouse_id,
      variant_id,
      sum(coalesce(qty_in, 0) - coalesce(qty_out, 0))::numeric as on_hand_qty
    from ledger
    group by company_id, warehouse_id, variant_id
  ),
  base_totals as (
    select
      company_id,
      warehouse_id,
      variant_id,
      sum(coalesce(qty_in, 0))::numeric as base_qty_total,
      sum(coalesce(qty_in, 0) * unit_cost)::numeric as base_cost_total
    from ledger
    where coalesce(qty_in, 0) > 0
      and coalesce(ref_type, '') <> 'expense'
    group by company_id, warehouse_id, variant_id
  ),
  landed_totals as (
    select
      company_id,
      warehouse_id,
      variant_id,
      sum(line_value)::numeric as landed_cost_total
    from ledger
    where ref_type = 'expense'
      and reference like 'EXP/%'
    group by company_id, warehouse_id, variant_id
  ),
  inventory_costs as (
    select
      k.company_id,
      k.warehouse_id,
      k.variant_id,
      (
        case
          when bt.base_qty_total > 0 then (bt.base_cost_total / nullif(bt.base_qty_total, 0))::numeric
          else null
        end
        + case
          when coalesce(bt.base_qty_total, 0) > 0 then coalesce(lt.landed_cost_total, 0) / nullif(bt.base_qty_total, 0)
          when coalesce(oh.on_hand_qty, 0) <> 0 then coalesce(lt.landed_cost_total, 0) / nullif(oh.on_hand_qty, 0)
          else null
        end
      ) as effective_unit_cost
    from keys k
    left join on_hand_totals oh
      on oh.company_id = k.company_id
     and oh.warehouse_id = k.warehouse_id
     and oh.variant_id = k.variant_id
    left join base_totals bt
      on bt.company_id = k.company_id
     and bt.warehouse_id = k.warehouse_id
     and bt.variant_id = k.variant_id
    left join landed_totals lt
      on lt.company_id = k.company_id
     and lt.warehouse_id = k.warehouse_id
     and lt.variant_id = k.variant_id
  )
  select
    ic.company_id,
    ic.warehouse_id,
    ic.variant_id,
    ic.effective_unit_cost,
    o.unit_cost as override_unit_cost,
    coalesce(o.unit_cost, ic.effective_unit_cost) as effective_unit_cost_final,
    case when o.unit_cost is not null then 'override' else 'inventory' end as cost_source
  from inventory_costs ic
  join public.erp_variants v
    on v.id = ic.variant_id
   and v.company_id = ic.company_id
  left join lateral (
    select o.unit_cost
    from public.erp_sku_cost_overrides o
    where o.company_id = ic.company_id
      and o.sku = v.sku
      and o.effective_from <= current_date
      and (o.effective_to is null or o.effective_to >= current_date)
    order by o.effective_from desc
    limit 1
  ) o on true;

notify pgrst, 'reload schema';
