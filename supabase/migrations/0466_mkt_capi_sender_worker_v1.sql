begin;

create extension if not exists http with schema extensions;

alter table public.erp_mkt_capi_events
add column if not exists send_status text default 'queued',
add column if not exists retry_count int default 0,
add column if not exists last_attempt_at timestamptz,
add column if not exists response_payload jsonb;

create or replace function public.erp_mkt_capi_send_batch_v1(
  p_actor_user_id uuid,
  p_batch_size int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_pixel_id text := nullif(trim(current_setting('app.settings.meta_pixel_id', true)), '');
  v_access_token text := nullif(trim(current_setting('app.settings.meta_access_token', true)), '');
  v_limit int := greatest(coalesce(p_batch_size, 200), 1);
  v_event_ids uuid[];
  v_data jsonb;
  v_request_body jsonb;
  v_response extensions.http_response;
  v_response_payload jsonb := '{}'::jsonb;
  v_processed int := 0;
  v_sent int := 0;
  v_retry int := 0;
  v_failed int := 0;
  v_http_ok boolean := false;
begin
  if p_actor_user_id is null then
    raise exception 'p_actor_user_id is required';
  end if;

  if v_company_id is null then
    raise exception 'Unable to resolve company context';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = p_actor_user_id
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Actor is not an active company user';
  end if;

  if v_pixel_id is null or v_access_token is null then
    raise exception 'Missing app.settings.meta_pixel_id or app.settings.meta_access_token';
  end if;

  with picked as (
    select e.id,
           e.event_name,
           e.event_time,
           e.event_id,
           e.payload
    from public.erp_mkt_capi_events e
    where e.company_id = v_company_id
      and e.send_status in ('queued', 'retry')
      and coalesce(e.retry_count, 0) <= 5
    order by e.created_at asc
    limit v_limit
    for update skip locked
  )
  select
    array_agg(p.id),
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'event_name', p.event_name,
          'event_time', floor(extract(epoch from p.event_time))::bigint,
          'event_id', p.event_id,
          'user_data', jsonb_strip_nulls(jsonb_build_object(
            'em', p.payload #> '{user_data,em}',
            'ph', p.payload #> '{user_data,ph}',
            'fbp', p.payload #>> '{user_data,fbp}',
            'fbc', p.payload #>> '{user_data,fbc}'
          )),
          'custom_data', jsonb_strip_nulls(jsonb_build_object(
            'value', p.payload #> '{custom_data,value}',
            'currency', p.payload #>> '{custom_data,currency}',
            'content_ids', coalesce(
              (
                select jsonb_agg(coalesce(c->>'id', c->>'product_id'))
                from jsonb_array_elements(coalesce(p.payload #> '{custom_data,contents}', '[]'::jsonb)) c
              ),
              '[]'::jsonb
            ),
            'content_type', p.payload #>> '{custom_data,content_type}'
          ))
        )
      )
    )
  into v_event_ids, v_data
  from picked p;

  v_processed := coalesce(array_length(v_event_ids, 1), 0);

  if v_processed = 0 then
    return jsonb_build_object(
      'processed', 0,
      'sent', 0,
      'retry', 0,
      'failed', 0
    );
  end if;

  v_request_body := jsonb_build_object(
    'data', coalesce(v_data, '[]'::jsonb),
    'access_token', v_access_token
  );

  v_response := extensions.http_post(
    format('https://graph.facebook.com/v19.0/%s/events', v_pixel_id),
    v_request_body::text,
    'application/json'
  );

  begin
    v_response_payload := coalesce(nullif(v_response.content, '')::jsonb, '{}'::jsonb);
  exception when others then
    v_response_payload := jsonb_build_object('raw', coalesce(v_response.content, ''));
  end;

  v_http_ok := coalesce(v_response.status, 0) between 200 and 299
    and not (v_response_payload ? 'error');

  if v_http_ok then
    update public.erp_mkt_capi_events e
    set
      send_status = 'sent',
      status = 'sent',
      sent_at = now(),
      last_error = null,
      last_attempt_at = now(),
      response_payload = v_response_payload,
      updated_at = now()
    where e.id = any(v_event_ids);

    get diagnostics v_sent = row_count;
  else
    with updated_rows as (
      update public.erp_mkt_capi_events e
      set
        send_status = case when coalesce(e.retry_count, 0) + 1 <= 5 then 'retry' else 'failed' end,
        status = case when coalesce(e.retry_count, 0) + 1 <= 5 then 'failed' else 'deadletter' end,
        retry_count = coalesce(e.retry_count, 0) + 1,
        attempt_count = coalesce(e.attempt_count, 0) + 1,
        last_attempt_at = now(),
        last_error = left(coalesce(v_response_payload #>> '{error,message}', v_response_payload::text, 'Meta send failed'), 2000),
        response_payload = v_response_payload,
        updated_at = now()
      where e.id = any(v_event_ids)
      returning send_status
    )
    select
      count(*) filter (where send_status = 'retry'),
      count(*) filter (where send_status = 'failed')
    into v_retry, v_failed
    from updated_rows;
  end if;

  return jsonb_build_object(
    'processed', v_processed,
    'sent', v_sent,
    'retry', v_retry,
    'failed', v_failed
  );
end;
$$;

revoke all on function public.erp_mkt_capi_send_batch_v1(uuid, int) from public;
grant execute on function public.erp_mkt_capi_send_batch_v1(uuid, int) to authenticated, service_role;

commit;
