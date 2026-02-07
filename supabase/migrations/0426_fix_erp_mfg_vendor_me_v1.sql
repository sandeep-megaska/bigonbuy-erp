-- 0426_fix_erp_mfg_vendor_me_v1.sql
-- Fix vendor "me" RPC to validate sessions exactly like the known-good query.

create or replace function public.erp_mfg_vendor_me_v1(
  p_session_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text;
  v_vendor_id uuid;
  v_company_id uuid;
  v_vendor_code text;
  v_must_reset boolean;
begin
  if coalesce(p_session_token,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  -- IMPORTANT: use the shared hashing helper (same as login inserts)
  v_token_hash := public.erp_mfg_hash_token(p_session_token);

  select s.vendor_id, s.company_id, s.vendor_code
    into v_vendor_id, v_company_id, v_vendor_code
  from public.erp_mfg_sessions s
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if v_vendor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select au.must_reset_password
    into v_must_reset
  from public.erp_vendor_auth_users au
  where au.vendor_id = v_vendor_id
    and au.company_id = v_company_id
  limit 1;

  update public.erp_mfg_sessions
     set last_seen_at = now()
   where token_hash = v_token_hash;

  return jsonb_build_object(
    'ok', true,
    'vendor_id', v_vendor_id,
    'company_id', v_company_id,
    'vendor_code', v_vendor_code,
    'must_reset_password', coalesce(v_must_reset, true)
  );
end;
$$;

revoke all on function public.erp_mfg_vendor_me_v1(text) from public;
grant execute on function public.erp_mfg_vendor_me_v1(text) to anon;
