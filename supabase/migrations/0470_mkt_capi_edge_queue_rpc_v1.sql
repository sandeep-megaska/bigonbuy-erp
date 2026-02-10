-- 0469_mkt_capi_edge_queue_rpc_v1.sql
-- Edge-function friendly queue operations: dequeue + mark_result
-- Adds 'sending' status and exposes RPCs that do not require secrets/GUCs.

alter table public.erp_mkt_capi_events
  add column if not exists send_status text default 'queued';

-- Optional: make sure last_attempt_at exists (you already added earlier, but safe)
alter table public.erp_mkt_capi_events
  add column if not exists last_attempt_at timestamptz;

-- Optional: ensure retry_count exists
alter table public.erp_mkt_capi_events
  add column if not exists retry_count int default 0;

-- Optional: response_payload storage
alter table public.erp_mkt_capi_events
  add column if not exists response_payload jsonb;

comment on column public.erp_mkt_capi_events.send_status is
  'queued|sending|sent|retry|failed';

-- Dequeue a batch of events and mark them as "sending".
-- Returns an array of jsonb events, each containing {id, event}
create or replace function public.erp_mkt_capi_dequeue_batch_v1(
  p_batch_size int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select e.id
    from public.erp_mkt_capi_events e
    where e.send_status in ('queued','retry')
      and coalesce(e.retry_count,0) < 5
    order by coalesce(e.last_attempt_at, e.created_at) asc, e.created_at asc
    limit p_batch_size
    for update skip locked
  ),
  upd as (
    update public.erp_mkt_capi_events e
    set
      send_status = 'sending',
      last_attempt_at = now()
    where e.id in (select id from picked)
    returning e.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        -- return the whole row as json; Edge Function can map fields safely
        'event', to_jsonb(u)
      )
    ),
    '[]'::jsonb
  )
  into v_out
  from upd u;

  return jsonb_build_object(
    'batch_size', jsonb_array_length(v_out),
    'events', v_out
  );
end;
$$;

-- Mark the result of a send attempt for one event
create or replace function public.erp_mkt_capi_mark_result_v1(
  p_event_id uuid,
  p_status text,
  p_response jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retry int;
  v_next_status text;
begin
  if p_status not in ('sent','retry','failed') then
    raise exception 'Invalid status: %', p_status;
  end if;

  if p_status = 'sent' then
    update public.erp_mkt_capi_events
    set
      send_status = 'sent',
      response_payload = p_response,
      last_attempt_at = now()
    where id = p_event_id;
    return;
  end if;

  if p_status = 'failed' then
    update public.erp_mkt_capi_events
    set
      send_status = 'failed',
      response_payload = p_response,
      last_attempt_at = now()
    where id = p_event_id;
    return;
  end if;

  -- retry path
  select coalesce(retry_count,0) into v_retry
  from public.erp_mkt_capi_events
  where id = p_event_id;

  v_retry := coalesce(v_retry,0) + 1;
  v_next_status := case when v_retry >= 5 then 'failed' else 'retry' end;

  update public.erp_mkt_capi_events
  set
    retry_count = v_retry,
    send_status = v_next_status,
    response_payload = p_response,
    last_attempt_at = now()
  where id = p_event_id;
end;
$$;
