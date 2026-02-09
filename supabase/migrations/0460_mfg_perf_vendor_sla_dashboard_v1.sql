-- 0460_mfg_perf_vendor_sla_dashboard_v1.sql
-- MFG-PERF-1: Vendor performance + SLA analytics (read-only views + RPCs).

create or replace view public.erp_mfg_perf_po_line_facts_v1 as
with stage_rollup as (
  select
    e.company_id,
    e.vendor_id,
    e.po_id,
    e.po_line_id,
    min(e.created_at) as earliest_stage_ts,
    min(e.created_at) filter (where upper(e.stage_code) = 'CUTTING') as cutting_stage_ts,
    min(e.created_at) filter (where upper(e.stage_code) in ('READY_TO_DISPATCH', 'PACKING')) as ready_stage_ts,
    max(e.created_at) as last_stage_update_ts
  from public.erp_mfg_po_line_stage_events e
  group by e.company_id, e.vendor_id, e.po_id, e.po_line_id
),
asn_dispatch as (
  select
    a.company_id,
    a.vendor_id,
    al.po_line_id,
    min(coalesce(a.dispatched_at, ev.dispatched_event_ts)) as dispatched_at
  from public.erp_mfg_asns a
  join public.erp_mfg_asn_lines al
    on al.asn_id = a.id
   and al.company_id = a.company_id
  left join lateral (
    select min(coalesce(ae.event_ts, ae.created_at)) as dispatched_event_ts
    from public.erp_mfg_asn_events ae
    where ae.asn_id = a.id
      and ae.company_id = a.company_id
      and ae.event_type in ('DISPATCHED', 'IN_TRANSIT')
  ) ev on true
  where a.status in ('DISPATCHED', 'IN_TRANSIT', 'RECEIVED_PARTIAL', 'RECEIVED_FULL')
  group by a.company_id, a.vendor_id, al.po_line_id
)
select
  po.company_id,
  po.vendor_id,
  po.id as po_id,
  pol.id as po_line_id,
  coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
  pol.variant_id,
  po.expected_delivery_date as due_date,
  pol.ordered_qty::numeric as ordered_qty,
  greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as remaining_qty,
  sr.earliest_stage_ts,
  coalesce(sr.ready_stage_ts, sr.earliest_stage_ts) as ready_stage_ts,
  case
    when sr.earliest_stage_ts is null or coalesce(sr.ready_stage_ts, sr.earliest_stage_ts) is null then null
    else round(extract(epoch from (coalesce(sr.ready_stage_ts, sr.earliest_stage_ts) - sr.earliest_stage_ts)) / 86400.0, 2)
  end as lead_time_days,
  sr.last_stage_update_ts,
  ad.dispatched_at,
  coalesce(ad.dispatched_at, sr.ready_stage_ts) as completion_ts,
  case
    when po.expected_delivery_date is null then null
    when coalesce(ad.dispatched_at, sr.ready_stage_ts) is null then null
    when coalesce(ad.dispatched_at, sr.ready_stage_ts)::date <= po.expected_delivery_date then true
    else false
  end as on_time_flag
from public.erp_purchase_orders po
join public.erp_purchase_order_lines pol
  on pol.purchase_order_id = po.id
 and pol.company_id = po.company_id
left join public.erp_variants vr
  on vr.id = pol.variant_id
 and vr.company_id = po.company_id
left join stage_rollup sr
  on sr.company_id = po.company_id
 and sr.vendor_id = po.vendor_id
 and sr.po_id = po.id
 and sr.po_line_id = pol.id
left join asn_dispatch ad
  on ad.company_id = po.company_id
 and ad.vendor_id = po.vendor_id
 and ad.po_line_id = pol.id
where coalesce(lower(po.status), '') not in ('cancelled', 'void');

create or replace function public.erp_mfg_vendor_perf_summary_v1(
  p_session_token text,
  p_days int default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_days int := greatest(coalesce(p_days, 30), 1);
  v_from date := current_date - (greatest(coalesce(p_days, 30), 1) - 1);
  v_result jsonb;
begin
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  with facts as (
    select *
    from public.erp_mfg_perf_po_line_facts_v1 f
    where f.company_id = v_company_id
      and f.vendor_id = v_vendor_id
      and coalesce(f.due_date, current_date) >= v_from
  ),
  ontime as (
    select
      count(*) filter (where completion_ts is not null and due_date is not null) as completed_total,
      count(*) filter (where on_time_flag is true) as on_time_total
    from facts
  ),
  stale as (
    select count(*)::int as stale_lines_count
    from facts
    where remaining_qty > 0
      and coalesce(last_stage_update_ts, earliest_stage_ts) < now() - interval '7 days'
  ),
  overdue as (
    select count(*)::int as overdue_lines_count
    from facts
    where remaining_qty > 0
      and due_date < current_date
  ),
  asn_speed as (
    select avg(extract(epoch from (coalesce(a.dispatched_at, ev.dispatched_event_ts) - a.created_at)) / 86400.0)::numeric as avg_days
    from public.erp_mfg_asns a
    left join lateral (
      select min(coalesce(ae.event_ts, ae.created_at)) as dispatched_event_ts
      from public.erp_mfg_asn_events ae
      where ae.asn_id = a.id
        and ae.company_id = a.company_id
        and ae.event_type in ('DISPATCHED', 'IN_TRANSIT')
    ) ev on true
    where a.company_id = v_company_id
      and a.vendor_id = v_vendor_id
      and a.created_at::date >= v_from
      and coalesce(a.dispatched_at, ev.dispatched_event_ts) is not null
  ),
  top_due as (
    select jsonb_agg(
      jsonb_build_object(
        'po_id', po_id,
        'po_line_id', po_line_id,
        'sku', sku,
        'due_date', due_date,
        'remaining_qty', remaining_qty
      )
      order by due_date asc nulls last, sku asc
    ) as rows
    from (
      select po_id, po_line_id, sku, due_date, remaining_qty
      from facts
      where remaining_qty > 0
        and due_date >= current_date
      order by due_date asc nulls last, sku asc
      limit 5
    ) d
  ),
  plan_summary as (
    select public.erp_mfg_vendor_forecast_summary_v1(p_session_token, v_days) as payload
  )
  select jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'to', current_date,
    'on_time_pct', case
      when coalesce((select completed_total from ontime), 0) = 0 then 0
      else round((select on_time_total from ontime)::numeric * 100.0 / nullif((select completed_total from ontime), 0), 2)
    end,
    'avg_lead_time_days', coalesce((select round(avg(lead_time_days)::numeric, 2) from facts where lead_time_days is not null), 0),
    'stale_lines_count', coalesce((select stale_lines_count from stale), 0),
    'overdue_lines_count', coalesce((select overdue_lines_count from overdue), 0),
    'asn_dispatch_speed_avg_days', coalesce((select round(avg_days, 2) from asn_speed), 0),
    'missing_bom_skus_count', coalesce(((select payload from plan_summary)->>'sku_missing_bom_count')::int, 0),
    'material_shortage_count', coalesce(((select payload from plan_summary)->>'projected_shortage_materials_count')::int, 0),
    'top_5_due_next', coalesce((select rows from top_due), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.erp_mfg_vendor_perf_trends_v1(
  p_session_token text,
  p_days int default 90,
  p_bucket text default 'WEEK'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_days int := greatest(coalesce(p_days, 90), 1);
  v_from date := current_date - (greatest(coalesce(p_days, 90), 1) - 1);
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

  with facts as (
    select
      case when v_bucket = 'DAY'
        then coalesce(due_date, current_date)
        else date_trunc('week', coalesce(due_date, current_date)::timestamp)::date
      end as bucket_start,
      on_time_flag,
      lead_time_days,
      remaining_qty,
      due_date
    from public.erp_mfg_perf_po_line_facts_v1 f
    where f.company_id = v_company_id
      and f.vendor_id = v_vendor_id
      and coalesce(f.due_date, current_date) >= v_from
  ),
  grouped as (
    select
      bucket_start,
      count(*) filter (where due_date is not null and on_time_flag is not null) as completed_total,
      count(*) filter (where on_time_flag is true) as on_time_total,
      avg(lead_time_days) filter (where lead_time_days is not null) as avg_lead_time_days,
      count(*) filter (where remaining_qty > 0 and due_date < current_date) as overdue_lines_count
    from facts
    group by bucket_start
  )
  select jsonb_build_object(
    'days', v_days,
    'bucket', v_bucket,
    'from', v_from,
    'to', current_date,
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'bucket_start', g.bucket_start,
        'on_time_pct', case
          when g.completed_total = 0 then 0
          else round(g.on_time_total::numeric * 100.0 / g.completed_total, 2)
        end,
        'avg_lead_time_days', round(coalesce(g.avg_lead_time_days, 0)::numeric, 2),
        'overdue_lines_count', g.overdue_lines_count
      )
      order by g.bucket_start asc
    ), '[]'::jsonb)
  ) into v_result
  from grouped g;

  return coalesce(v_result, jsonb_build_object('days', v_days, 'bucket', v_bucket, 'from', v_from, 'to', current_date, 'rows', '[]'::jsonb));
end;
$$;

create or replace function public.erp_mfg_erp_vendor_scorecard_v1(
  p_days int default 30
) returns table (
  vendor_id uuid,
  vendor_name text,
  on_time_pct numeric,
  avg_lead_time_days numeric,
  overdue_lines_count integer,
  stale_lines_count integer,
  last_dispatch_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_from date := current_date - (greatest(coalesce(p_days, 30), 1) - 1);
begin
  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  v_company_id := public.erp_current_company_id();
  if v_company_id is null then
    raise exception 'No company in context';
  end if;

  return query
  with facts as (
    select *
    from public.erp_mfg_perf_po_line_facts_v1 f
    where f.company_id = v_company_id
      and coalesce(f.due_date, current_date) >= v_from
  )
  select
    v.id as vendor_id,
    v.legal_name::text as vendor_name,
    round(
      coalesce(
        (
          count(*) filter (where f.on_time_flag is true)::numeric * 100.0
          / nullif(count(*) filter (where f.completion_ts is not null and f.due_date is not null), 0)
        ),
        0
      ),
      2
    ) as on_time_pct,
    round(coalesce(avg(f.lead_time_days), 0)::numeric, 2) as avg_lead_time_days,
    count(*) filter (where f.remaining_qty > 0 and f.due_date < current_date)::int as overdue_lines_count,
    count(*) filter (where f.remaining_qty > 0 and coalesce(f.last_stage_update_ts, f.earliest_stage_ts) < now() - interval '7 days')::int as stale_lines_count,
    max(f.dispatched_at)::date as last_dispatch_date
  from public.erp_vendors v
  left join facts f
    on f.vendor_id = v.id
  where v.company_id = v_company_id
  group by v.id, v.legal_name
  order by on_time_pct desc nulls last, avg_lead_time_days asc nulls last, lower(v.legal_name);
end;
$$;

create or replace function public.erp_mfg_erp_vendor_detail_v1(
  p_vendor_id uuid,
  p_days int default 90
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_from date := current_date - (greatest(coalesce(p_days, 90), 1) - 1);
  v_result jsonb;
begin
  if p_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  v_company_id := public.erp_current_company_id();
  if v_company_id is null then
    raise exception 'No company in context';
  end if;

  if not exists (
    select 1 from public.erp_vendors v where v.id = p_vendor_id and v.company_id = v_company_id
  ) then
    raise exception 'Vendor not found in your company';
  end if;

  with facts as (
    select *
    from public.erp_mfg_perf_po_line_facts_v1 f
    where f.company_id = v_company_id
      and f.vendor_id = p_vendor_id
      and coalesce(f.due_date, current_date) >= v_from
  ),
  asn_speed as (
    select avg(extract(epoch from (coalesce(a.dispatched_at, ev.dispatched_event_ts) - a.created_at)) / 86400.0)::numeric as avg_days
    from public.erp_mfg_asns a
    left join lateral (
      select min(coalesce(ae.event_ts, ae.created_at)) as dispatched_event_ts
      from public.erp_mfg_asn_events ae
      where ae.asn_id = a.id
        and ae.company_id = a.company_id
        and ae.event_type in ('DISPATCHED', 'IN_TRANSIT')
    ) ev on true
    where a.company_id = v_company_id
      and a.vendor_id = p_vendor_id
      and a.created_at::date >= v_from
      and coalesce(a.dispatched_at, ev.dispatched_event_ts) is not null
  ),
  metrics as (
    select jsonb_build_object(
      'on_time_pct', round(coalesce((count(*) filter (where on_time_flag is true)::numeric * 100.0) / nullif(count(*) filter (where completion_ts is not null and due_date is not null), 0), 0), 2),
      'avg_lead_time_days', round(coalesce(avg(lead_time_days), 0)::numeric, 2),
      'overdue_open_po_lines', count(*) filter (where remaining_qty > 0 and due_date < current_date),
      'stale_lines_count_3d', count(*) filter (where remaining_qty > 0 and coalesce(last_stage_update_ts, earliest_stage_ts) < now() - interval '3 days'),
      'stale_lines_count_7d', count(*) filter (where remaining_qty > 0 and coalesce(last_stage_update_ts, earliest_stage_ts) < now() - interval '7 days'),
      'asn_dispatch_speed_avg_days', round(coalesce((select avg_days from asn_speed), 0), 2),
      'last_dispatch_date', max(dispatched_at)::date
    ) as payload
    from facts
  ),
  open_lists as (
    select jsonb_agg(
      jsonb_build_object(
        'po_id', po_id,
        'po_line_id', po_line_id,
        'sku', sku,
        'due_date', due_date,
        'remaining_qty', remaining_qty,
        'last_stage_update_ts', last_stage_update_ts,
        'days_since_last_update', floor(extract(epoch from (now() - coalesce(last_stage_update_ts, earliest_stage_ts))) / 86400.0)::int
      )
      order by due_date asc nulls last, sku asc
    ) filter (where remaining_qty > 0 and due_date < current_date) as overdue_rows,
    jsonb_agg(
      jsonb_build_object(
        'po_id', po_id,
        'po_line_id', po_line_id,
        'sku', sku,
        'due_date', due_date,
        'remaining_qty', remaining_qty,
        'last_stage_update_ts', last_stage_update_ts,
        'days_since_last_update', floor(extract(epoch from (now() - coalesce(last_stage_update_ts, earliest_stage_ts))) / 86400.0)::int
      )
      order by coalesce(last_stage_update_ts, earliest_stage_ts) asc nulls first
    ) filter (where remaining_qty > 0 and coalesce(last_stage_update_ts, earliest_stage_ts) < now() - interval '7 days') as stale_rows
    from facts
  )
  select jsonb_build_object(
    'vendor_id', p_vendor_id,
    'days', greatest(coalesce(p_days, 90), 1),
    'from', v_from,
    'to', current_date,
    'metrics', coalesce((select payload from metrics), '{}'::jsonb),
    'overdue_lines', coalesce((select overdue_rows from open_lists), '[]'::jsonb),
    'stale_lines', coalesce((select stale_rows from open_lists), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.erp_mfg_vendor_perf_summary_v1(text, int) from public;
revoke all on function public.erp_mfg_vendor_perf_trends_v1(text, int, text) from public;
revoke all on function public.erp_mfg_erp_vendor_scorecard_v1(int) from public;
revoke all on function public.erp_mfg_erp_vendor_detail_v1(uuid, int) from public;

grant execute on function public.erp_mfg_vendor_perf_summary_v1(text, int) to anon, service_role;
grant execute on function public.erp_mfg_vendor_perf_trends_v1(text, int, text) to anon, service_role;
grant execute on function public.erp_mfg_erp_vendor_scorecard_v1(int) to authenticated, service_role;
grant execute on function public.erp_mfg_erp_vendor_detail_v1(uuid, int) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
