begin;

create extension if not exists pg_net;
create extension if not exists pgcrypto;

create or replace function public.erp_mkt_capi_send_batch_v1(
  p_actor_user_id uuid default null,
  p_batch_size int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_limit int := greatest(coalesce(p_batch_size, 200), 1);
  v_processed int := 0;
  v_sent int := 0;
  v_retry int := 0;
  v_failed int := 0;
  v_event_id uuid;
  v_event_name text;
  v_event_time timestamptz;
  v_external_event_id text;
  v_payload_data jsonb;
  v_retry_count int;
  v_payload jsonb;
  v_url text;
  v_request_id bigint;
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

  v_url := 'https://graph.facebook.com/v19.0/' ||
           current_setting('app.settings.meta_pixel_id') ||
           '/events?access_token=' ||
           current_setting('app.settings.meta_access_token');

  for v_event_id, v_event_name, v_event_time, v_external_event_id, v_payload_data, v_retry_count in
    select
      e.id,
      e.event_name,
      e.event_time,
      e.event_id,
      e.payload,
      coalesce(e.retry_count, 0) as retry_count
    from public.erp_mkt_capi_events e
    where e.company_id = v_company_id
      and e.send_status in ('queued', 'retry')
      and coalesce(e.retry_count, 0) <= 5
    order by e.created_at asc
    limit v_limit
    for update skip locked
  loop
    v_processed := v_processed + 1;

    v_payload := jsonb_build_object(
      'data',
      jsonb_build_array(
        jsonb_strip_nulls(
          jsonb_build_object(
            'event_name', v_event_name,
            'event_time', floor(extract(epoch from v_event_time))::bigint,
            'event_id', v_external_event_id,
            'action_source', 'website',
            'user_data', jsonb_strip_nulls(jsonb_build_object(
              'em', v_payload_data #> '{user_data,em}',
              'ph', v_payload_data #> '{user_data,ph}',
              'fbp', v_payload_data #>> '{user_data,fbp}',
              'fbc', v_payload_data #>> '{user_data,fbc}'
            )),
            'custom_data', jsonb_strip_nulls(jsonb_build_object(
              'value', v_payload_data #> '{custom_data,value}',
              'currency', v_payload_data #>> '{custom_data,currency}',
              'content_ids', coalesce(
                (
                  select jsonb_agg(coalesce(c.content ->> 'id', c.content ->> 'product_id'))
                  from jsonb_array_elements(coalesce(v_payload_data #> '{custom_data,contents}', '[]'::jsonb)) as c(content)
                ),
                '[]'::jsonb
              ),
              'content_type', 'product'
            ))
          )
        )
      )
    );

    begin
      select net.http_post(
        url := v_url,
        body := v_payload,
        headers := '{"Content-Type":"application/json"}'::jsonb
      )
      into v_request_id;

      update public.erp_mkt_capi_events e
      set
        send_status = 'sent',
        status = 'sent',
        sent_at = now(),
        last_error = null,
        response_payload = v_payload,
        last_attempt_at = now(),
        updated_at = now()
      where e.id = v_event_id;

      v_sent := v_sent + 1;
    exception when others then
      update public.erp_mkt_capi_events e
      set
        retry_count = coalesce(e.retry_count, 0) + 1,
        send_status = case
                        when coalesce(e.retry_count, 0) >= 5 then 'failed'
                        else 'retry'
                      end,
        status = case
                   when coalesce(e.retry_count, 0) >= 5 then 'deadletter'
                   else 'failed'
                 end,
        attempt_count = coalesce(e.attempt_count, 0) + 1,
        last_attempt_at = now(),
        last_error = left(sqlerrm, 2000),
        updated_at = now()
      where e.id = v_event_id;

      if v_retry_count >= 5 then
        v_failed := v_failed + 1;
      else
        v_retry := v_retry + 1;
      end if;
    end;
  end loop;

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
