-- META-1A.1 — Purchase reconciliation observability
-- Read-only reconciliation of persisted Shopify orders against the canonical
-- Meta CAPI Purchase queue. This migration does not enqueue or send events.

create or replace function public.erp_mkt_capi_purchase_reconciliation_v1(
  p_company_id uuid,
  p_since timestamptz default (now() - interval '7 days'),
  p_limit int default 250
)
returns table (
  shopify_order_id bigint,
  order_created_at timestamptz,
  currency text,
  order_value numeric,
  financial_status text,
  fulfillment_status text,
  purchase_event_id text,
  capi_status text,
  send_status text,
  attempt_count int,
  retry_count int,
  last_error text,
  sent_at timestamptz,
  has_em boolean,
  has_ph boolean,
  has_fbp boolean,
  has_fbc boolean,
  reconciliation_state text
)
language sql
security definer
set search_path = public
as $$
  with recent_orders as (
    select
      o.shopify_order_id,
      o.order_created_at,
      o.currency,
      o.total_price as order_value,
      o.financial_status,
      o.fulfillment_status
    from public.erp_shopify_orders o
    where o.company_id = p_company_id
      and o.order_created_at >= coalesce(p_since, now() - interval '7 days')
    order by o.order_created_at desc
    limit greatest(1, least(coalesce(p_limit, 250), 1000))
  )
  select
    o.shopify_order_id,
    o.order_created_at,
    o.currency,
    o.order_value,
    o.financial_status,
    o.fulfillment_status,
    e.event_id as purchase_event_id,
    e.status as capi_status,
    e.send_status,
    coalesce(e.attempt_count, 0) as attempt_count,
    coalesce(e.retry_count, 0) as retry_count,
    e.last_error,
    e.sent_at,
    case when jsonb_typeof(e.payload->'user_data'->'em') = 'array'
      then jsonb_array_length(e.payload->'user_data'->'em') > 0 else false end as has_em,
    case when jsonb_typeof(e.payload->'user_data'->'ph') = 'array'
      then jsonb_array_length(e.payload->'user_data'->'ph') > 0 else false end as has_ph,
    nullif(e.payload->'user_data'->>'fbp', '') is not null as has_fbp,
    nullif(e.payload->'user_data'->>'fbc', '') is not null as has_fbc,
    case
      when e.id is null then 'NO_PURCHASE_EVENT'
      when e.send_status = 'sent' or e.status = 'sent' then 'SENT'
      when e.send_status = 'failed' or e.status = 'failed' then 'FAILED'
      when e.send_status = 'retry' then 'RETRY'
      when e.send_status = 'sending' then 'SENDING'
      when e.send_status = 'queued' or e.status = 'queued' then 'QUEUED'
      else 'UNKNOWN'
    end as reconciliation_state
  from recent_orders o
  left join lateral (
    select ce.*
    from public.erp_mkt_capi_events ce
    where ce.company_id = p_company_id
      and ce.event_name = 'Purchase'
      and (
        ce.event_id = ('purchase_' || o.shopify_order_id::text)
        or ce.order_id = o.shopify_order_id::text
      )
    order by ce.created_at desc
    limit 1
  ) e on true
  order by o.order_created_at desc;
$$;

revoke all on function public.erp_mkt_capi_purchase_reconciliation_v1(uuid,timestamptz,int) from public;
grant execute on function public.erp_mkt_capi_purchase_reconciliation_v1(uuid,timestamptz,int) to service_role;

create or replace function public.erp_mkt_capi_purchase_health_v1(
  p_company_id uuid,
  p_since timestamptz default (now() - interval '7 days')
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with r as (
    select *
    from public.erp_mkt_capi_purchase_reconciliation_v1(p_company_id, p_since, 1000)
  )
  select jsonb_build_object(
    'since', p_since,
    'shopify_orders', count(*),
    'purchase_events', count(*) filter (where purchase_event_id is not null),
    'no_purchase_event', count(*) filter (where reconciliation_state = 'NO_PURCHASE_EVENT'),
    'queued', count(*) filter (where reconciliation_state = 'QUEUED'),
    'sending', count(*) filter (where reconciliation_state = 'SENDING'),
    'retry', count(*) filter (where reconciliation_state = 'RETRY'),
    'failed', count(*) filter (where reconciliation_state = 'FAILED'),
    'sent', count(*) filter (where reconciliation_state = 'SENT'),
    'unknown', count(*) filter (where reconciliation_state = 'UNKNOWN'),
    'with_em', count(*) filter (where purchase_event_id is not null and has_em),
    'with_ph', count(*) filter (where purchase_event_id is not null and has_ph),
    'with_fbp', count(*) filter (where purchase_event_id is not null and has_fbp),
    'with_fbc', count(*) filter (where purchase_event_id is not null and has_fbc),
    'event_coverage_pct', coalesce(round(100.0 * count(*) filter (where purchase_event_id is not null) / nullif(count(*), 0), 1), 0),
    'em_coverage_pct', coalesce(round(100.0 * count(*) filter (where purchase_event_id is not null and has_em) / nullif(count(*) filter (where purchase_event_id is not null), 0), 1), 0),
    'ph_coverage_pct', coalesce(round(100.0 * count(*) filter (where purchase_event_id is not null and has_ph) / nullif(count(*) filter (where purchase_event_id is not null), 0), 1), 0),
    'fbp_coverage_pct', coalesce(round(100.0 * count(*) filter (where purchase_event_id is not null and has_fbp) / nullif(count(*) filter (where purchase_event_id is not null), 0), 1), 0),
    'fbc_coverage_pct', coalesce(round(100.0 * count(*) filter (where purchase_event_id is not null and has_fbc) / nullif(count(*) filter (where purchase_event_id is not null), 0), 1), 0)
  )
  from r;
$$;

revoke all on function public.erp_mkt_capi_purchase_health_v1(uuid,timestamptz) from public;
grant execute on function public.erp_mkt_capi_purchase_health_v1(uuid,timestamptz) to service_role;
