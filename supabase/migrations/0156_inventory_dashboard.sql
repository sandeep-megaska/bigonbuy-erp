create or replace function public.erp_inventory_dashboard_summary(
  p_warehouse_id uuid,
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_warehouse record;
  v_on_hand_value numeric;
  v_missing_costs int := 0;
  v_low_stock_count int := 0;
  v_pending_po_count int := 0;
  v_stocktake_pending_count int := 0;
  v_sales_today_count int := 0;
  v_recent_grns jsonb := '[]'::jsonb;
  v_recent_transfers jsonb := '[]'::jsonb;
  v_recent_sales jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_company_id is null then
    raise exception 'No active company context';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Not authorized';
  end if;

  select id, code, name
    into v_warehouse
    from public.erp_warehouses
   where id = p_warehouse_id
     and company_id = v_company_id;

  if v_warehouse.id is null then
    raise exception 'Warehouse not found';
  end if;

  with ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(l.qty)::integer as qty
    from public.erp_inventory_ledger l
    where l.company_id = v_company_id
      and l.warehouse_id = p_warehouse_id
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
    where gl.company_id = v_company_id
      and g.company_id = v_company_id
      and g.status = 'posted'
      and coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
      and gl.warehouse_id = p_warehouse_id
    group by gl.warehouse_id, gl.variant_id
  ),
  valuation_rows as (
    select
      lt.variant_id,
      lt.qty as on_hand,
      case
        when ct.qty_total > 0 then round((lt.qty * (ct.cost_total / ct.qty_total))::numeric, 2)
        else null
      end as stock_value
    from ledger_totals lt
    left join cost_totals ct
      on ct.variant_id = lt.variant_id
     and ct.warehouse_id = lt.warehouse_id
  )
  select
    sum(stock_value),
    sum(case when stock_value is null and on_hand <> 0 then 1 else 0 end)
  into v_on_hand_value, v_missing_costs
  from valuation_rows;

  if coalesce(v_missing_costs, 0) > 0 then
    v_on_hand_value := null;
  end if;

  with ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(l.qty)::int as qty
    from public.erp_inventory_ledger l
    where l.company_id = v_company_id
      and l.warehouse_id = p_warehouse_id
    group by l.warehouse_id, l.variant_id
  )
  select count(*)
    into v_low_stock_count
    from public.erp_inventory_reorder_rules r
    left join ledger_totals lt
      on lt.warehouse_id = r.warehouse_id
     and lt.variant_id = r.variant_id
   where r.company_id = v_company_id
     and r.warehouse_id = p_warehouse_id
     and r.is_active
     and coalesce(lt.qty, 0) < r.min_qty;

  select count(*)
    into v_pending_po_count
    from public.erp_purchase_orders po
   where po.company_id = v_company_id
     and po.deliver_to_warehouse_id = p_warehouse_id
     and po.status in ('draft', 'approved', 'partially_received');

  select count(*)
    into v_stocktake_pending_count
    from public.erp_stocktakes st
   where st.company_id = v_company_id
     and st.warehouse_id = p_warehouse_id
     and st.status = 'draft';

  select count(*)
    into v_sales_today_count
    from public.erp_sales_consumptions sc
   where sc.company_id = v_company_id
     and sc.warehouse_id = p_warehouse_id
     and sc.status = 'posted'
     and coalesce(sc.posted_at::date, sc.consumption_date) = coalesce(p_date, current_date);

  select coalesce(jsonb_agg(row_to_json(grn_row)), '[]'::jsonb)
    into v_recent_grns
    from (
      select
        g.id,
        g.received_at::date as date,
        g.grn_no as ref,
        v.legal_name as vendor_name,
        g.status
      from public.erp_grns g
      join public.erp_grn_lines gl
        on gl.grn_id = g.id
      join public.erp_purchase_orders po
        on po.id = g.purchase_order_id
      join public.erp_vendors v
        on v.id = po.vendor_id
      where g.company_id = v_company_id
        and gl.company_id = v_company_id
        and gl.warehouse_id = p_warehouse_id
      group by g.id, g.received_at, g.grn_no, v.legal_name, g.status
      order by g.received_at desc
      limit 5
    ) grn_row;

  select coalesce(jsonb_agg(row_to_json(transfer_row)), '[]'::jsonb)
    into v_recent_transfers
    from (
      select
        t.id,
        t.transfer_date as date,
        t.reference as ref,
        wf.name as from_wh,
        wt.name as to_wh,
        t.status
      from public.erp_stock_transfers t
      left join public.erp_warehouses wf
        on wf.id = t.from_warehouse_id
      left join public.erp_warehouses wt
        on wt.id = t.to_warehouse_id
      where t.company_id = v_company_id
        and (t.from_warehouse_id = p_warehouse_id or t.to_warehouse_id = p_warehouse_id)
      order by t.transfer_date desc, t.created_at desc
      limit 5
    ) transfer_row;

  select coalesce(jsonb_agg(row_to_json(sales_row)), '[]'::jsonb)
    into v_recent_sales
    from (
      select
        sc.id,
        sc.consumption_date as date,
        sc.reference as ref,
        ch.name as channel_name,
        sc.status
      from public.erp_sales_consumptions sc
      left join public.erp_sales_channels ch
        on ch.id = sc.channel_id
      where sc.company_id = v_company_id
        and sc.warehouse_id = p_warehouse_id
      order by sc.consumption_date desc, sc.created_at desc
      limit 5
    ) sales_row;

  return jsonb_build_object(
    'warehouse',
    jsonb_build_object(
      'id', v_warehouse.id,
      'code', v_warehouse.code,
      'name', v_warehouse.name
    ),
    'kpis',
    jsonb_build_object(
      'on_hand_value', v_on_hand_value,
      'low_stock_count', coalesce(v_low_stock_count, 0),
      'pending_po_count', coalesce(v_pending_po_count, 0),
      'stocktake_pending_count', coalesce(v_stocktake_pending_count, 0),
      'sales_today_count', coalesce(v_sales_today_count, 0)
    ),
    'recent',
    jsonb_build_object(
      'grns', coalesce(v_recent_grns, '[]'::jsonb),
      'transfers', coalesce(v_recent_transfers, '[]'::jsonb),
      'sales', coalesce(v_recent_sales, '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.erp_inventory_dashboard_summary(uuid, date) from public;
grant execute on function public.erp_inventory_dashboard_summary(uuid, date) to authenticated;

notify pgrst, 'reload schema';
