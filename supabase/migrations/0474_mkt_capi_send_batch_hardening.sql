-- 0474_mkt_capi_send_batch_hardening.sql
-- Hardening:
-- 1) Skip events older than 7 days (Meta requirement)
-- 2) Ensure user_data.external_id is present and non-null
-- 3) Keep existing behavior otherwise (pg_net returns request id)

create or replace function public.erp_mkt_capi_send_batch_v1(
  p_actor_user_id uuid default null::uuid,
  p_batch_size integer default 200
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_processed int := 0;
  v_sent int := 0;
  v_retry int := 0;
  v_failed int := 0;
  v_skipped int := 0;

  r record;
  v_pixel_id text;
  v_token text;
  v_url text;
  v_payload jsonb;
  v_resp jsonb;

  v_company_id uuid := public.erp_current_company_id();
  v_next_retry int;

  v_now_epoch bigint := floor(extract(epoch from now()));
  v_min_epoch bigint := floor(extract(epoch from (now() - interval '7 days')));
  v_event_epoch bigint;
  v_ext0 text;
  v_ext_fill text;
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  select s.meta_pixel_id, s.meta_access_token
    into v_pixel_id, v_token
  from public.erp_mkt_settings s
  where s.company_id = v_company_id;

  if coalesce(v_pixel_id,'') = '' or coalesce(v_token,'') = '' then
    raise exception 'Meta CAPI settings missing in erp_mkt_settings for company %: meta_pixel_id/meta_access_token', v_company_id;
  end if;

  v_url := 'https://graph.facebook.com/v19.0/' || v_pixel_id || '/events?access_token=' || v_token;

  for r in
    select *
    from public.erp_mkt_capi_events
    where send_status in ('queued','retry')
      and coalesce(retry_count,0) <= 5
    order by created_at
    limit p_batch_size
    for update skip locked
  loop
    v_processed := v_processed + 1;

    -- 1) Skip too-old events (Meta requires within 7 days)
    begin
      v_event_epoch := null;
      if r.event_time is not null then
        v_event_epoch := r.event_time::bigint;
      else
        -- If payload has event_time but column missing, try payload (defensive)
        v_event_epoch := nullif((r.payload->>'event_time')::bigint, 0);
      end if;
    exception when others then
      v_event_epoch := null;
    end;

    if v_event_epoch is not null and v_event_epoch < v_min_epoch then
      update public.erp_mkt_capi_events
      set
        send_status     = 'skipped_too_old',
        last_attempt_at = now(),
        attempt_count   = coalesce(attempt_count,0) + 1,
        last_error      = 'skipped: event_time older than 7 days',
        response_payload = jsonb_build_object(
          'skip_reason', 'event_time_too_old',
          'event_time', v_event_epoch,
          'min_epoch', v_min_epoch
        ),
        updated_at = now()
      where id = r.id;

      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      v_payload := coalesce(r.payload, '{}'::jsonb);

      -- 2) Ensure user_data.external_id[0] exists and non-null
      v_ext0 := v_payload #>> '{user_data,external_id,0}';
      if v_ext0 is null or btrim(v_ext0) = '' then
        v_ext_fill := coalesce(r.identity_id::text, r.event_id, r.id::text);

        v_payload := jsonb_set(
          v_payload,
          '{user_data,external_id}',
          to_jsonb(array[v_ext_fill]),
          true
        );
      end if;

      -- Send (pg_net) - returns request id/job info
      select net.http_post(
        url := v_url,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := v_payload
      ) into v_resp;

      update public.erp_mkt_capi_events
      set
        send_status      = 'sent',
        sent_at          = now(),
        last_attempt_at  = now(),
        attempt_count    = coalesce(attempt_count,0) + 1,
        retry_count      = 0,
        last_error       = null,
        payload          = v_payload, -- persist injected external_id if we added it
        response_payload = jsonb_build_object(
          'request', v_payload,
          'response', v_resp
        ),
        updated_at       = now()
      where id = r.id;

      v_sent := v_sent + 1;

    exception when others then
      v_next_retry := coalesce(r.retry_count,0) + 1;

      update public.erp_mkt_capi_events
      set
        retry_count     = v_next_retry,
        send_status     = case when v_next_retry >= 5 then 'failed' else 'retry' end,
        last_attempt_at = now(),
        attempt_count   = coalesce(attempt_count,0) + 1,
        last_error      = sqlerrm,
        response_payload = jsonb_build_object(
          'error', sqlerrm,
          'sqlstate', sqlstate
        ),
        updated_at      = now()
      where id = r.id;

      if v_next_retry >= 5 then
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
    'failed', v_failed,
    'skipped_too_old', v_skipped
  );
end;
$function$;
