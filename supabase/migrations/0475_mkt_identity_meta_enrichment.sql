-- 0475_mkt_identity_meta_enrichment.sql
-- Purpose:
-- Create canonical hashing helpers and Meta user_data builder
-- used by CAPI payload generation.

create extension if not exists pgcrypto;

-- Helper: normalize email
create or replace function public.erp_norm_email(p_email text)
returns text
language sql
immutable
as $$
select lower(trim(p_email));
$$;

-- Helper: normalize phone (digits only)
create or replace function public.erp_norm_phone(p_phone text)
returns text
language sql
immutable
as $$
select regexp_replace(p_phone, '[^0-9]', '', 'g');
$$;

-- Helper: sha256 hex
-- Helper: sha256 hex (Supabase: pgcrypto functions are in schema "extensions")
create or replace function public.erp_sha256_hex(p_val text)
returns text
language sql
immutable
as $$
select encode(extensions.digest(p_val, 'sha256'), 'hex');
$$;


-- Build Meta user_data JSON from identity
create or replace function public.erp_mkt_identity_meta_user_data_build_v1(
  p_identity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text;
  v_phone text;
  v_fbp text;
  v_fbc text;

  v_user jsonb := '{}'::jsonb;
begin
  select
    i.email,
    i.phone,
    i.fbp,
    i.fbc
  into
    v_email,
    v_phone,
    v_fbp,
    v_fbc
  from public.erp_mkt_identity_map i
  where i.id = p_identity_id;

  if v_email is not null then
    v_user := v_user || jsonb_build_object(
      'em', public.erp_sha256_hex(public.erp_norm_email(v_email))
    );
  end if;

  if v_phone is not null then
    v_user := v_user || jsonb_build_object(
      'ph', public.erp_sha256_hex(public.erp_norm_phone(v_phone))
    );
  end if;

  if v_fbp is not null then
    v_user := v_user || jsonb_build_object('fbp', v_fbp);
  end if;

  if v_fbc is not null then
    v_user := v_user || jsonb_build_object('fbc', v_fbc);
  end if;

  return v_user;
end;
$$;
