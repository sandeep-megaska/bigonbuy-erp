-- 0459_mfg_plan2_fix_variant_alias_and_payload.sql
-- Fix MFG-PLAN-2 SKU forecast bucket CTE alias and keep canonical SKU identifiers in payload.

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
      ol.variant_id,
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
    group by ol.variant_id, v.sku, p.title, v.size, v.color
  ),
  buckets as (
    select
      ol.variant_id,
      case when v_bucket = 'DAY'
        then ol.due_date
        else date_trunc('week', ol.due_date::timestamp)::date
      end as bucket_start,
      sum(ol.open_qty)::numeric as qty
    from open_lines ol
    where ol.due_date between v_from and v_to
    group by ol.variant_id,
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

select pg_notify('pgrst', 'reload schema');
