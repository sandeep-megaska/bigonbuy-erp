-- 0473_mkt_capi_send_batch_payload_fix.sql
-- Fix: erp_mkt_capi_send_batch_v1 referenced non-existent r.event_payload.
-- Use r.payload only, and update canonical tracking fields consistently.

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

  r record;
  v_pixel_id text;
  v_token text;
  v_url text;
  v_payload jsonb;
  v_resp jsonb;

  v_company_id uuid := public.erp_current_company_id();
  v_next_retry int;
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  -- Read settings from erp_mkt_settings
  select s.meta_pixel_id, s.meta_access_token
    into v_pixel_id, v_token
  from public.erp_mkt_settings s
  where s.company_id = v_company_id;

  if coalesce(v_pixel_id,'') = '' or coalesce(v_token,'') = '' then
    raise exception 'Meta CAPI settings missing in erp_mkt_settings for company %: meta_pixel_id/meta_access_token', v_company_id;
  end if;

  -- Keep existing graph version to avoid behavioral change
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
      v_payload := coalesce(r.payload, '{}'::jsonb);

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
        last_error       = null,
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
    'failed', v_failed
  );
end;
$function$;
