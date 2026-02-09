-- 0458_mfg_plan2_vendor_forecast_v1.sql
-- MFG-PLAN-2: Vendor production + material forecast (cookie-auth vendor RPCs)

create index if not exists erp_purchase_orders_company_vendor_status_due_idx
  on public.erp_purchase_orders (company_id, vendor_id, status, expected_delivery_date);

create index if not exists erp_purchase_order_lines_company_po_variant_idx
  on public.erp_purchase_order_lines (company_id, purchase_order_id, variant_id);

create index if not exists erp_mfg_boms_company_vendor_sku_status_idx
  on public.erp_mfg_boms (company_id, vendor_id, sku, status);

create index if not exists erp_mfg_bom_lines_company_vendor_bom_material_idx
  on public.erp_mfg_bom_lines (company_id, vendor_id, bom_id, material_id);

create index if not exists erp_mfg_po_line_stage_events_company_vendor_stage_idx
  on public.erp_mfg_po_line_stage_events (company_id, vendor_id, stage_code, po_line_id);

create or replace function public.erp_mfg_vendor_forecast_sku_v1(
  p_session_token text,
  p_horizon_days int default 30,
  p_bucket text default 'WEEK',
  p_from date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_from date := coalesce(p_from, current_date);
  v_horizon int := greatest(coalesce(p_horizon_days, 30), 1);
  v_to date := v_from + (v_horizon - 1);
  v_bucket text := upper(coalesce(nullif(trim(p_bucket), ''), 'WEEK'));
  v_result jsonb;
begin
  if v_bucket not in ('WEEK', 'DAY') then
    raise exception 'bucket must be WEEK or DAY';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  with open_lines as (
    select
      po.company_id,
      po.vendor_id,
      po.id as po_id,
      pol.id as po_line_id,
      pol.variant_id,
      greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as open_qty,
      coalesce(po.expected_delivery_date, po.order_date, v_from) as due_date
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.company_id = po.company_id
     and pol.purchase_order_id = po.id
    where po.company_id = v_company_id
      and po.vendor_id = v_vendor_id
      and coalesce(lower(po.status), '') in ('open', 'issued', 'approved', 'partially_received')
      and greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) > 0
  ),
  sku_rollup as (
    select
      v.id as variant_id,
      v.sku,
      coalesce(p.title, v.sku, 'SKU') as product,
      v.size,
      v.color,
      sum(ol.open_qty)::numeric as total_open_qty,
      sum(case when ol.due_date < v_from then ol.open_qty else 0 end)::numeric as overdue_qty,
      bool_or(b.id is not null) as has_active_bom
    from open_lines ol
    join public.erp_variants v
      on v.company_id = ol.company_id
     and v.id = ol.variant_id
    left join public.erp_products p
      on p.company_id = v.company_id
     and p.id = v.product_id
    left join public.erp_mfg_boms b
      on b.company_id = ol.company_id
     and b.vendor_id = ol.vendor_id
     and lower(b.sku) = lower(v.sku)
     and b.status = 'active'
    group by v.id, v.sku, p.title, v.size, v.color
  ),
  buckets as (
    select
      s.variant_id,
      case when v_bucket = 'DAY'
        then ol.due_date
        else date_trunc('week', ol.due_date::timestamp)::date
      end as bucket_start,
      sum(ol.open_qty)::numeric as qty
    from open_lines ol
    join public.erp_variants s
      on s.company_id = ol.company_id
     and s.id = ol.variant_id
    where ol.due_date between v_from and v_to
    group by s.variant_id,
      case when v_bucket = 'DAY'
        then ol.due_date
        else date_trunc('week', ol.due_date::timestamp)::date
      end
  ),
  wip as (
    select
      e.po_line_id,
      sum(case when e.stage_code in ('PACKING', 'READY_TO_DISPATCH') then coalesce(e.completed_qty_delta, 0) else 0 end)::numeric as wip_qty
    from public.erp_mfg_po_line_stage_events e
    where e.company_id = v_company_id
      and e.vendor_id = v_vendor_id
    group by e.po_line_id
  ),
  wip_by_variant as (
    select
      ol.variant_id,
      sum(coalesce(w.wip_qty, 0))::numeric as wip_hint_qty
    from open_lines ol
    left join wip w on w.po_line_id = ol.po_line_id
    group by ol.variant_id
  )
  select jsonb_build_object(
    'horizon_days', v_horizon,
    'bucket', v_bucket,
    'from', v_from,
    'to', v_to,
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'sku', sr.sku,
        'variant_id', sr.variant_id,
        'product', sr.product,
        'size', sr.size,
        'color', sr.color,
        'total_open_qty', sr.total_open_qty,
        'overdue_qty', sr.overdue_qty,
        'recommended_daily_rate', round(sr.total_open_qty / v_horizon::numeric, 4),
        'wip_hint_qty', coalesce(wv.wip_hint_qty, 0),
        'risk_flag', (sr.overdue_qty > 0),
        'bom_status', case when sr.has_active_bom then 'OK' else 'MISSING' end,
        'buckets', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'bucket_start', b.bucket_start,
              'qty', b.qty
            )
            order by b.bucket_start
          )
          from buckets b
          where b.variant_id = sr.variant_id
        ), '[]'::jsonb)
      )
      order by sr.overdue_qty desc, sr.total_open_qty desc, lower(sr.sku)
    ), '[]'::jsonb)
  ) into v_result
  from sku_rollup sr
  left join wip_by_variant wv on wv.variant_id = sr.variant_id;

  return coalesce(v_result, jsonb_build_object(
    'horizon_days', v_horizon,
    'bucket', v_bucket,
    'from', v_from,
    'to', v_to,
    'rows', '[]'::jsonb
  ));
end;
$$;

create or replace function public.erp_mfg_vendor_forecast_material_v1(
  p_session_token text,
  p_horizon_days int default 30,
  p_bucket text default 'WEEK',
  p_from date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_from date := coalesce(p_from, current_date);
  v_horizon int := greatest(coalesce(p_horizon_days, 30), 1);
  v_to date := v_from + (v_horizon - 1);
  v_bucket text := upper(coalesce(nullif(trim(p_bucket), ''), 'WEEK'));
  v_result jsonb;
begin
  if v_bucket not in ('WEEK', 'DAY') then
    raise exception 'bucket must be WEEK or DAY';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  with open_lines as (
    select
      po.company_id,
      po.vendor_id,
      pol.variant_id,
      greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as open_qty,
      coalesce(po.expected_delivery_date, po.order_date, v_from) as due_date
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.company_id = po.company_id
     and pol.purchase_order_id = po.id
    where po.company_id = v_company_id
      and po.vendor_id = v_vendor_id
      and coalesce(lower(po.status), '') in ('open', 'issued', 'approved', 'partially_received')
      and greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) > 0
      and coalesce(po.expected_delivery_date, po.order_date, v_from) between v_from and v_to
  ),
  demand_by_material_bucket as (
    select
      bl.material_id,
      case when v_bucket = 'DAY'
        then ol.due_date
        else date_trunc('week', ol.due_date::timestamp)::date
      end as bucket_start,
      sum(ol.open_qty * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric as demand_qty
    from open_lines ol
    join public.erp_variants vr
      on vr.company_id = ol.company_id
     and vr.id = ol.variant_id
    join public.erp_mfg_boms b
      on b.company_id = ol.company_id
     and b.vendor_id = ol.vendor_id
     and lower(b.sku) = lower(vr.sku)
     and b.status = 'active'
    join public.erp_mfg_bom_lines bl
      on bl.company_id = b.company_id
     and bl.vendor_id = b.vendor_id
     and bl.bom_id = b.id
    group by bl.material_id,
      case when v_bucket = 'DAY'
        then ol.due_date
        else date_trunc('week', ol.due_date::timestamp)::date
      end
  ),
  material_base as (
    select
      mb.material_id,
      mb.name as material_name,
      mb.default_uom as uom,
      coalesce(mb.on_hand_qty, 0)::numeric as on_hand_qty,
      coalesce(mb.reorder_point, 0)::numeric as reorder_level,
      coalesce(mb.lead_time_days, 0)::int as lead_time_days
    from public.erp_mfg_material_balances_v mb
    where mb.company_id = v_company_id
      and mb.vendor_id = v_vendor_id
      and mb.is_active = true
  ),
  bucket_projection as (
    select
      mb.material_id,
      mb.material_name,
      mb.uom,
      mb.on_hand_qty,
      mb.reorder_level,
      mb.lead_time_days,
      db.bucket_start,
      coalesce(db.demand_qty, 0)::numeric as demand_qty,
      (mb.on_hand_qty - sum(coalesce(db.demand_qty, 0)::numeric) over (
        partition by mb.material_id order by db.bucket_start asc rows between unbounded preceding and current row
      ))::numeric as projected_balance
    from material_base mb
    join demand_by_material_bucket db on db.material_id = mb.material_id
  ),
  material_summary as (
    select
      mb.material_id,
      mb.material_name,
      mb.uom,
      mb.on_hand_qty,
      mb.reorder_level,
      mb.lead_time_days,
      min(bp.bucket_start) filter (where bp.projected_balance < 0) as first_shortage_bucket_start,
      greatest(coalesce(sum(bp.demand_qty), 0) - mb.on_hand_qty, 0)::numeric as recommended_reorder_qty
    from material_base mb
    left join bucket_projection bp on bp.material_id = mb.material_id
    group by mb.material_id, mb.material_name, mb.uom, mb.on_hand_qty, mb.reorder_level, mb.lead_time_days
  )
  select jsonb_build_object(
    'horizon_days', v_horizon,
    'bucket', v_bucket,
    'from', v_from,
    'to', v_to,
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'material_id', ms.material_id,
        'material_name', ms.material_name,
        'uom', ms.uom,
        'on_hand', ms.on_hand_qty,
        'reorder_level', ms.reorder_level,
        'lead_time_days', ms.lead_time_days,
        'buckets', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'bucket_start', bp.bucket_start,
              'demand_qty', bp.demand_qty,
              'projected_balance', bp.projected_balance,
              'shortage_qty', greatest(bp.demand_qty - greatest(bp.projected_balance + bp.demand_qty, 0), 0)
            )
            order by bp.bucket_start
          )
          from bucket_projection bp
          where bp.material_id = ms.material_id
        ), '[]'::jsonb),
        'first_shortage_bucket_start', ms.first_shortage_bucket_start,
        'recommended_reorder_qty', ms.recommended_reorder_qty,
        'recommended_order_by_date', case
          when ms.first_shortage_bucket_start is null then null
          else (ms.first_shortage_bucket_start - make_interval(days => ms.lead_time_days))::date
        end
      )
      order by ms.first_shortage_bucket_start nulls last, ms.recommended_reorder_qty desc, lower(ms.material_name)
    ), '[]'::jsonb)
  ) into v_result
  from material_summary ms;

  return coalesce(v_result, jsonb_build_object(
    'horizon_days', v_horizon,
    'bucket', v_bucket,
    'from', v_from,
    'to', v_to,
    'rows', '[]'::jsonb
  ));
end;
$$;

create or replace function public.erp_mfg_vendor_forecast_summary_v1(
  p_session_token text,
  p_horizon_days int default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_horizon int := greatest(coalesce(p_horizon_days, 30), 1);
  v_from date := current_date;
  v_to date := current_date + (v_horizon - 1);
  v_result jsonb;
begin
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  with open_lines as (
    select
      pol.id as po_line_id,
      pol.variant_id,
      greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as open_qty,
      coalesce(po.expected_delivery_date, po.order_date, v_from) as due_date
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.company_id = po.company_id
     and pol.purchase_order_id = po.id
    where po.company_id = v_company_id
      and po.vendor_id = v_vendor_id
      and coalesce(lower(po.status), '') in ('open', 'issued', 'approved', 'partially_received')
      and greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) > 0
  ),
  sku_horizon as (
    select
      vr.id as variant_id,
      vr.sku,
      sum(ol.open_qty)::numeric as demand_qty
    from open_lines ol
    join public.erp_variants vr
      on vr.id = ol.variant_id
     and vr.company_id = v_company_id
    where ol.due_date between v_from and v_to
    group by vr.id, vr.sku
  ),
  missing_bom as (
    select count(*)::int as sku_missing_bom_count
    from sku_horizon sh
    left join public.erp_mfg_boms b
      on b.company_id = v_company_id
     and b.vendor_id = v_vendor_id
     and lower(b.sku) = lower(sh.sku)
     and b.status = 'active'
    where b.id is null
  ),
  top_skus as (
    select jsonb_agg(
      jsonb_build_object(
        'variant_id', sh.variant_id,
        'sku', sh.sku,
        'demand_qty', sh.demand_qty
      )
      order by sh.demand_qty desc, lower(sh.sku)
    ) as rows
    from (
      select * from sku_horizon order by demand_qty desc, lower(sku) limit 10
    ) sh
  ),
  overdue as (
    select count(*)::int as overdue_po_lines_count
    from open_lines ol
    where ol.due_date < v_from
  ),
  material_shortage as (
    select count(*)::int as projected_shortage_materials_count
    from jsonb_array_elements(public.erp_mfg_vendor_forecast_material_v1(p_session_token, v_horizon, 'WEEK', v_from)->'rows') r
    where (r->>'first_shortage_bucket_start') is not null
  )
  select jsonb_build_object(
    'horizon_days', v_horizon,
    'from', v_from,
    'to', v_to,
    'sku_missing_bom_count', coalesce((select sku_missing_bom_count from missing_bom), 0),
    'projected_shortage_materials_count', coalesce((select projected_shortage_materials_count from material_shortage), 0),
    'overdue_po_lines_count', coalesce((select overdue_po_lines_count from overdue), 0),
    'top_skus_next_horizon', coalesce((select rows from top_skus), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.erp_mfg_vendor_forecast_sku_v1(text, int, text, date) from public;
revoke all on function public.erp_mfg_vendor_forecast_material_v1(text, int, text, date) from public;
revoke all on function public.erp_mfg_vendor_forecast_summary_v1(text, int) from public;

grant execute on function public.erp_mfg_vendor_forecast_sku_v1(text, int, text, date) to anon, service_role;
grant execute on function public.erp_mfg_vendor_forecast_material_v1(text, int, text, date) to anon, service_role;
grant execute on function public.erp_mfg_vendor_forecast_summary_v1(text, int) to anon, service_role;

select pg_notify('pgrst', 'reload schema');
