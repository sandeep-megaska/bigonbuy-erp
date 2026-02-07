-- 0XYZ_mfg_vendor_sessions_and_login_v2.sql
-- Vendor portal sessions + login (no service role, no app secret).
-- Uses SECURITY DEFINER RPCs and DB-stored session token hashes.

-- Requirements:
-- - extensions.pgcrypto is available (Supabase typically exposes digest/gen_random_bytes/crypt/gen_salt via extensions schema)
-- - public.erp_vendors exists
-- - public.erp_vendor_auth_users exists

-- Session table: stores only token_hash (sha256) not raw token.
create table if not exists public.erp_mfg_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  vendor_code text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_seen_at timestamptz null
);

create unique index if not exists erp_mfg_sessions_token_hash_ux
  on public.erp_mfg_sessions(token_hash);

create index if not exists erp_mfg_sessions_vendor_active_idx
  on public.erp_mfg_sessions(vendor_id, revoked_at, expires_at);

comment on table public.erp_mfg_sessions is 'Manufacturer portal sessions. Raw token stored only in cookie; DB stores sha256(token) in token_hash.';

-- Helper: hash a session token consistently
create or replace function public.erp_mfg_hash_token(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke all on function public.erp_mfg_hash_token(text) from public;
grant execute on function public.erp_mfg_hash_token(text) to anon, authenticated;

-- LOGIN v2: validates vendor_code + password and CREATES a session token.
create or replace function public.erp_mfg_vendor_login_v2(
  p_vendor_code text,
  p_password text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor_id uuid;
  v_company_id uuid;
  v_vendor_code text;
  v_hash text;
  v_must_reset boolean;
  v_is_active boolean;
  v_portal_enabled boolean;
  v_portal_status text;

  v_session_token text;
  v_token_hash text;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  if coalesce(trim(p_vendor_code),'') = '' or coalesce(p_password,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'vendor_code and password are required');
  end if;

  -- Find vendor by vendor_code (case-insensitive)
  select v.id, v.company_id, v.vendor_code, v.portal_enabled, v.portal_status
    into v_vendor_id, v_company_id, v_vendor_code, v_portal_enabled, v_portal_status
  from public.erp_vendors v
  where lower(v.vendor_code) = lower(trim(p_vendor_code))
  limit 1;

  -- Do NOT leak existence; keep message generic
  if v_vendor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid credentials');
  end if;

  if not coalesce(v_portal_enabled,false) then
    return jsonb_build_object('ok', false, 'error', 'Invalid credentials');
  end if;

  select au.password_hash, au.must_reset_password, au.is_active
    into v_hash, v_must_reset, v_is_active
  from public.erp_vendor_auth_users au
  where au.vendor_id = v_vendor_id
    and au.company_id = v_company_id
  limit 1;

  if v_hash is null or not coalesce(v_is_active,true) then
    return jsonb_build_object('ok', false, 'error', 'Invalid credentials');
  end if;

  if extensions.crypt(p_password, v_hash) <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'Invalid credentials');
  end if;

  -- Create session token (raw) + store only hash
  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := public.erp_mfg_hash_token(v_session_token);

  insert into public.erp_mfg_sessions (
    company_id, vendor_id, vendor_code, token_hash, created_at, expires_at
  ) values (
    v_company_id, v_vendor_id, v_vendor_code, v_token_hash, now(), v_expires_at
  );

  -- Update vendor last login stamp (optional but useful)
  update public.erp_vendors v
     set portal_last_login_at = now(),
         updated_at = now()
   where v.id = v_vendor_id;

  return jsonb_build_object(
    'ok', true,
    'vendor_id', v_vendor_id,
    'company_id', v_company_id,
    'vendor_code', v_vendor_code,
    'must_reset_password', coalesce(v_must_reset,true),
    'session_token', v_session_token,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.erp_mfg_vendor_login_v2(text, text) from public;
grant execute on function public.erp_mfg_vendor_login_v2(text, text) to anon;

-- ME: validate a session token and return vendor identity
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

  -- read must_reset flag
  select au.must_reset_password
    into v_must_reset
  from public.erp_vendor_auth_users au
  where au.vendor_id = v_vendor_id and au.company_id = v_company_id
  limit 1;

  update public.erp_mfg_sessions
     set last_seen_at = now()
   where token_hash = v_token_hash;

  return jsonb_build_object(
    'ok', true,
    'vendor_id', v_vendor_id,
    'company_id', v_company_id,
    'vendor_code', v_vendor_code,
    'must_reset_password', coalesce(v_must_reset,true)
  );
end;
$$;

revoke all on function public.erp_mfg_vendor_me_v1(text) from public;
grant execute on function public.erp_mfg_vendor_me_v1(text) to anon;

-- LOGOUT: revoke session
create or replace function public.erp_mfg_vendor_logout_v1(
  p_session_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text;
begin
  if coalesce(p_session_token,'') = '' then
    return jsonb_build_object('ok', true);
  end if;

  v_token_hash := public.erp_mfg_hash_token(p_session_token);

  update public.erp_mfg_sessions
     set revoked_at = now()
   where token_hash = v_token_hash
     and revoked_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.erp_mfg_vendor_logout_v1(text) from public;
grant execute on function public.erp_mfg_vendor_logout_v1(text) to anon;

-- RESET PASSWORD: requires valid session token
create or replace function public.erp_mfg_vendor_reset_password_v1(
  p_session_token text,
  p_new_password text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text;
  v_vendor_id uuid;
  v_company_id uuid;
  v_new_hash text;
begin
  if coalesce(p_session_token,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  if coalesce(p_new_password,'') = '' or length(p_new_password) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Password too short');
  end if;

  v_token_hash := public.erp_mfg_hash_token(p_session_token);

  select s.vendor_id, s.company_id
    into v_vendor_id, v_company_id
  from public.erp_mfg_sessions s
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if v_vendor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  v_new_hash := extensions.crypt(p_new_password, extensions.gen_salt('bf'));

  update public.erp_vendor_auth_users
     set password_hash = v_new_hash,
         must_reset_password = false,
         updated_at = now()
   where vendor_id = v_vendor_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.erp_mfg_vendor_reset_password_v1(text, text) from public;
grant execute on function public.erp_mfg_vendor_reset_password_v1(text, text) to anon;
