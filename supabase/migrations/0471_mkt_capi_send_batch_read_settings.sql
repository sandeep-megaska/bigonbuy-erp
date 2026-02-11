-- 0471_mkt_capi_send_batch_read_settings.sql
-- Fix: erp_mkt_capi_send_batch_v1 must read Meta CAPI settings from erp_mkt_settings (company scoped),
-- not from app.settings.*.

create or replace function public.erp_mkt_capi_send_batch_v1(
  p_actor_user_id uuid,
  p_limit integer default 200
) returns table(
  dequeued_count integer,
  queued_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_pixel_id text;
  v_access_token text;
  v_test_event_code text;
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  select s.meta_pixel_id, s.meta_access_token, s.meta_test_event_code
    into v_pixel_id, v_access_token, v_test_event_code
  from public.erp_mkt_settings s
  where s.company_id = v_company_id;

  if coalesce(v_pixel_id,'') = '' or coalesce(v_access_token,'') = '' then
    raise exception 'Meta CAPI settings missing in erp_mkt_settings for company %: meta_pixel_id/meta_access_token', v_company_id;
  end if;

  -- NOTE: Keep the rest of your existing logic exactly as-is.
  -- Only replace the old app.settings reads with v_pixel_id / v_access_token / v_test_event_code.
  --
  -- You likely already:
  -- 1) select events with send_status='queued' (and maybe retries)
  -- 2) mark them dequeued / processing
  -- 3) return counts
  --
  -- Ensure wherever you previously referenced:
  --   current_setting('app.settings.meta_pixel_id', true)
  --   current_setting('app.settings.meta_access_token', true)
  -- you now use v_pixel_id / v_access_token.

  -- TEMP placeholder until you paste the remaining body:
  -- If you want, paste the current function body and I’ll splice this in precisely.

  dequeued_count := 0;
  queued_count := 0;
  return next;
end;
$$;
