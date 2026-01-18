-- Finance bridge read-only reports

create or replace function public.erp_require_finance_reader()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_finance_reader() from public;
grant execute on function public.erp_require_finance_reader() to authenticated;

create or replace function public.erp_fin_inventory_closing_snapshot(
  p_as_of date,
  p_warehouse_id uuid default null
)
returns table(
  warehouse_id uuid,
  warehouse_name text,
  on_hand_qty int,
  stock_value numeric(14,2),
  cost_coverage_pct numeric(5,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with ledger_totals as (
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
  ),
  warehouse_summary as (
    select
      lt.warehouse_id,
      sum(lt.qty)::int as on_hand_qty,
      sum(case when ct.qty_total > 0 then 1 else 0 end) as cost_sku_count,
      count(*) as total_sku_count,
      sum(
        case
          when ct.qty_total > 0 then round((lt.qty * (ct.cost_total / ct.qty_total))::numeric, 2)
          else 0
        end
      ) as stock_value_present,
      max(case when ct.qty_total is null then 1 else 0 end) as has_missing_cost
    from ledger_totals lt
    left join cost_totals ct
      on ct.warehouse_id = lt.warehouse_id
     and ct.variant_id = lt.variant_id
    group by lt.warehouse_id
  ),
  ledger_totals_all as (
    select
      lt.variant_id,
      sum(lt.qty)::int as qty
    from ledger_totals lt
    group by lt.variant_id
  ),
  cost_totals_all as (
    select
      ct.variant_id,
      sum(ct.cost_total) as cost_total,
      sum(ct.qty_total) as qty_total
    from cost_totals ct
    group by ct.variant_id
  ),
  overall_summary as (
    select
      sum(lt.qty)::int as on_hand_qty,
      sum(case when ct.qty_total > 0 then 1 else 0 end) as cost_sku_count,
      count(*) as total_sku_count,
      sum(
        case
          when ct.qty_total > 0 then round((lt.qty * (ct.cost_total / ct.qty_total))::numeric, 2)
          else 0
        end
      ) as stock_value_present,
      max(case when ct.qty_total is null then 1 else 0 end) as has_missing_cost
    from ledger_totals_all lt
    left join cost_totals_all ct
      on ct.variant_id = lt.variant_id
  )
  select
    ws.warehouse_id,
    w.name as warehouse_name,
    ws.on_hand_qty,
    case when ws.has_missing_cost = 1 then null else ws.stock_value_present end as stock_value,
    case
      when ws.total_sku_count = 0 then null
      else round((ws.cost_sku_count::numeric / nullif(ws.total_sku_count, 0)) * 100, 2)
    end as cost_coverage_pct
  from warehouse_summary ws
  left join public.erp_warehouses w
    on w.id = ws.warehouse_id
   and w.company_id = public.erp_current_company_id()

  union all

  select
    null::uuid as warehouse_id,
    'All Warehouses'::text as warehouse_name,
    os.on_hand_qty,
    case when os.has_missing_cost = 1 then null else os.stock_value_present end as stock_value,
    case
      when os.total_sku_count = 0 then null
      else round((os.cost_sku_count::numeric / nullif(os.total_sku_count, 0)) * 100, 2)
    end as cost_coverage_pct
  from overall_summary os
  order by warehouse_name;
end;
$$;

revoke all on function public.erp_fin_inventory_closing_snapshot(date, uuid) from public;
grant execute on function public.erp_fin_inventory_closing_snapshot(date, uuid) to authenticated;

create or replace function public.erp_fin_inventory_movement_summary(
  p_from date,
  p_to date,
  p_warehouse_id uuid default null
)
returns table(
  type text,
  warehouse_id uuid,
  warehouse_name text,
  qty_sum int,
  txn_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    l.type,
    l.warehouse_id,
    w.name as warehouse_name,
    sum(l.qty)::int as qty_sum,
    count(*)::int as txn_count
  from public.erp_inventory_ledger l
  left join public.erp_warehouses w
    on w.id = l.warehouse_id
   and w.company_id = public.erp_current_company_id()
  where l.company_id = public.erp_current_company_id()
    and l.created_at::date >= p_from
    and l.created_at::date <= p_to
    and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
  group by l.type, l.warehouse_id, w.name
  order by l.type, w.name;
end;
$$;

revoke all on function public.erp_fin_inventory_movement_summary(date, date, uuid) from public;
grant execute on function public.erp_fin_inventory_movement_summary(date, date, uuid) to authenticated;

create or replace function public.erp_fin_cogs_estimate(
  p_from date,
  p_to date,
  p_channel_code text default null,
  p_warehouse_id uuid default null
)
returns table(
  sku text,
  variant_id uuid,
  qty_sold int,
  est_unit_cost numeric(12,2),
  est_cogs numeric(14,2),
  cost_source text,
  missing_cost boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with sales as (
    select
      l.variant_id,
      sum(abs(l.qty))::int as qty_sold
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and l.type = 'sale_out'
      and l.created_at::date >= p_from
      and l.created_at::date <= p_to
      and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
    group by l.variant_id
  ),
  cost_totals as (
    select
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
    group by gl.variant_id
  ),
  wac_costs as (
    select
      ct.variant_id,
      case
        when ct.qty_total > 0 then round((ct.cost_total / ct.qty_total)::numeric, 2)
        else null
      end as wac
    from cost_totals ct
  ),
  overrides as (
    select
      so.sku,
      so.unit_cost,
      row_number() over (partition by so.sku order by so.effective_from desc) as rn
    from public.erp_sku_cost_overrides so
    where so.company_id = public.erp_current_company_id()
      and so.effective_from <= p_to
      and (so.effective_to is null or so.effective_to >= p_from)
  )
  select
    v.sku,
    s.variant_id,
    s.qty_sold,
    coalesce(wc.wac, ov.unit_cost) as est_unit_cost,
    case
      when coalesce(wc.wac, ov.unit_cost) is null then null
      else round((s.qty_sold * coalesce(wc.wac, ov.unit_cost))::numeric, 2)
    end as est_cogs,
    case
      when wc.wac is not null then 'wac'
      when ov.unit_cost is not null then 'override'
      else 'missing'
    end as cost_source,
    (wc.wac is null and ov.unit_cost is null) as missing_cost
  from sales s
  join public.erp_variants v
    on v.id = s.variant_id
   and v.company_id = public.erp_current_company_id()
  left join wac_costs wc
    on wc.variant_id = s.variant_id
  left join overrides ov
    on ov.sku = v.sku
   and ov.rn = 1
  order by v.sku;
end;
$$;

revoke all on function public.erp_fin_cogs_estimate(date, date, text, uuid) from public;
grant execute on function public.erp_fin_cogs_estimate(date, date, text, uuid) to authenticated;

create or replace function public.erp_fin_grn_register(
  p_from date,
  p_to date,
  p_vendor_id uuid default null
)
returns table(
  grn_id uuid,
  grn_date date,
  vendor_name text,
  reference text,
  status text,
  total_qty int,
  total_cost numeric(14,2),
  cost_missing_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with grn_totals as (
    select
      g.id as grn_id,
      g.received_at::date as grn_date,
      g.status,
      g.grn_no,
      po.vendor_id,
      sum(gl.received_qty)::int as total_qty,
      sum(
        case
          when coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
            then gl.received_qty * coalesce(gl.landed_cost_per_unit, gl.unit_cost)
          else 0
        end
      ) as total_cost_present,
      sum(
        case
          when coalesce(gl.landed_cost_per_unit, gl.unit_cost) is null then 1
          else 0
        end
      )::int as cost_missing_count,
      max(
        case
          when coalesce(gl.landed_cost_per_unit, gl.unit_cost) is null then 1
          else 0
        end
      ) as has_missing_cost
    from public.erp_grns g
    join public.erp_purchase_orders po
      on po.id = g.purchase_order_id
     and po.company_id = public.erp_current_company_id()
    join public.erp_grn_lines gl
      on gl.grn_id = g.id
     and gl.company_id = public.erp_current_company_id()
    where g.company_id = public.erp_current_company_id()
      and g.received_at::date >= p_from
      and g.received_at::date <= p_to
      and (p_vendor_id is null or po.vendor_id = p_vendor_id)
    group by g.id, g.received_at::date, g.status, g.grn_no, po.vendor_id
  )
  select
    gt.grn_id,
    gt.grn_date,
    v.legal_name as vendor_name,
    gt.grn_no as reference,
    gt.status,
    gt.total_qty,
    case when gt.has_missing_cost = 1 then null else round(gt.total_cost_present::numeric, 2) end as total_cost,
    gt.cost_missing_count
  from grn_totals gt
  join public.erp_vendors v
    on v.id = gt.vendor_id
   and v.company_id = public.erp_current_company_id()
  order by gt.grn_date desc, gt.grn_no desc;
end;
$$;

revoke all on function public.erp_fin_grn_register(date, date, uuid) from public;
grant execute on function public.erp_fin_grn_register(date, date, uuid) to authenticated;
