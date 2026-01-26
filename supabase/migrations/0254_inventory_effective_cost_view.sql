create or replace view public.erp_inventory_effective_cost_v as
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
  )
  select
    k.company_id,
    k.warehouse_id,
    k.variant_id,
    coalesce(oh.on_hand_qty, 0)::numeric as on_hand_qty,
    bt.base_cost_total,
    bt.base_qty_total,
    case
      when bt.base_qty_total > 0 then (bt.base_cost_total / nullif(bt.base_qty_total, 0))::numeric
      else null
    end as base_unit_cost_avg,
    coalesce(lt.landed_cost_total, 0)::numeric as landed_cost_total,
    case
      when coalesce(bt.base_qty_total, 0) > 0 then bt.base_qty_total
      when coalesce(oh.on_hand_qty, 0) <> 0 then oh.on_hand_qty
      else null
    end as landed_qty_basis,
    case
      when coalesce(bt.base_qty_total, 0) > 0 then coalesce(lt.landed_cost_total, 0) / nullif(bt.base_qty_total, 0)
      when coalesce(oh.on_hand_qty, 0) <> 0 then coalesce(lt.landed_cost_total, 0) / nullif(oh.on_hand_qty, 0)
      else null
    end as landed_unit_cost_delta_avg,
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
    ) as effective_unit_cost,
    (
      coalesce(oh.on_hand_qty, 0)
      * (
        case
          when bt.base_qty_total > 0 then (bt.base_cost_total / nullif(bt.base_qty_total, 0))::numeric
          else null
        end
        + case
          when coalesce(bt.base_qty_total, 0) > 0 then coalesce(lt.landed_cost_total, 0) / nullif(bt.base_qty_total, 0)
          when coalesce(oh.on_hand_qty, 0) <> 0 then coalesce(lt.landed_cost_total, 0) / nullif(oh.on_hand_qty, 0)
          else null
        end
      )
    )::numeric as effective_value
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
   and lt.variant_id = k.variant_id;

notify pgrst, 'reload schema';
