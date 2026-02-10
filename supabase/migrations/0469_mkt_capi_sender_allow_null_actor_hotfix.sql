-- 0469_mkt_capi_sender_allow_null_actor_hotfix.sql
-- Fix: allow cron/scheduler to run without actor user id.

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
  v_processed int := 0;
  v_sent int := 0;
  v_retry int := 0;
  v_failed int := 0;

  r record;
  v_pixel_id text;
  v_token text;
  v_url text;
  v_payload jsonb;
  v_resp jsonb;
begin
  -- IMPORTANT: scheduler runs with NULL actor; no hard requirement.

  -- Read settings (fail fast with clear error if missing)
  begin
    v_pixel_id := current_setting('app.settings.meta_pixel_id', true);
    v_token    := current_setting('app.settings.meta_access_token', true);
  exception when others then
    v_pixel_id := null;
    v_token := null;
  end;

  if v_pixel_id is null or v_token is null then
    raise exception 'Meta CAPI settings missing: app.settings.meta_pixel_id / app.settings.meta_access_token';
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

    begin
      -- Build payload from your stored event JSON.
      -- Assumption: you already store a Meta-ready JSON in a column like payload/event_payload.
      -- Codex should inspect the table and use the correct column.
      -- For safety here, we use r.payload if it exists; Codex must adapt.
      v_payload := coalesce(r.payload, r.event_payload, '{}'::jsonb);

      -- Send (pg_net)
      select net.http_post(
        url := v_url,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := v_payload
      ) into v_resp;

      update public.erp_mkt_capi_events
      set
        send_status = 'sent',
        last_attempt_at = now(),
        response_payload = jsonb_build_object(
          'request', v_payload,
          'response', v_resp
        )
      where id = r.id;

      v_sent := v_sent + 1;

    exception when others then
      update public.erp_mkt_capi_events
      set
        retry_count = coalesce(retry_count,0) + 1,
        last_attempt_at = now(),
        send_status = case when coalesce(retry_count,0) + 1 >= 5 then 'failed' else 'retry' end,
        response_payload = jsonb_build_object(
          'error', sqlerrm
        )
      where id = r.id;

      if coalesce(r.retry_count,0) + 1 >= 5 then
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
