-- Vendor portal: v2 RPCs return JSONB to avoid OUT-param ambiguity forever.

create or replace function public.erp_vendor_portal_enable_v2(
  p_vendor_id uuid,
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
  l_vendor_code text;
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_temp_password text;
  v_password_hash text;
  l_auth_row_id uuid;
begin
  if p_vendor_id is null or p_company_id is null then
    raise exception 'vendor_id and company_id are required';
  end if;

  -- Admin auth (ERP user must be logged in)
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  -- Ensure vendor exists in same company
  if not exists (
    select 1 from public.erp_vendors v
     where v.id = p_vendor_id and v.company_id = p_company_id
  ) then
    raise exception 'Vendor not found';
  end if;

  -- Ensure vendor_code + enable portal
  update public.erp_vendors v
     set vendor_code = coalesce(v.vendor_code, public.erp_next_vendor_code(v.company_id)),
         portal_enabled = true,
         portal_status = 'invited',
         portal_temp_password_set_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where v.id = p_vendor_id
     and v.company_id = p_company_id
  returning v.vendor_code into l_vendor_code;

  -- Generate temp password
  select string_agg(substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1), '')
    into v_temp_password
  from generate_series(1, 12);

  v_password_hash := extensions.crypt(v_temp_password, extensions.gen_salt('bf'));

  -- Upsert vendor auth row (your custom vendor auth table)
  insert into public.erp_vendor_auth_users (
    company_id,
    vendor_id,
    password_hash,
    is_active,
    must_reset_password,
    created_at,
    updated_at,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_vendor_id,
    v_password_hash,
    true,
    true,
    now(),
    now(),
    auth.uid(),
    auth.uid()
  )
  on conflict (company_id, vendor_id)
  do update set
    password_hash = excluded.password_hash,
    is_active = true,
    must_reset_password = true,
    updated_at = now(),
    updated_by = auth.uid()
  returning id into l_auth_row_id;

  -- Link back on vendor row
  update public.erp_vendors v
     set portal_auth_user_id = l_auth_row_id,
         updated_at = now(),
         updated_by = auth.uid()
   where v.id = p_vendor_id
     and v.company_id = p_company_id;

  return jsonb_build_object(
    'vendor_id', p_vendor_id,
    'vendor_code', l_vendor_code,
    'temp_password', v_temp_password,
    'login_url', '/mfg/login'
  );
end;
$$;

revoke all on function public.erp_vendor_portal_enable_v2(uuid, uuid) from public;
grant execute on function public.erp_vendor_portal_enable_v2(uuid, uuid) to authenticated;


-- Vendor login RPC (NO Supabase auth session required)
-- Accepts vendor_code + password, validates against erp_vendor_auth_users hash.
create or replace function public.erp_mfg_vendor_login_v1(
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
  v_hash text;
  v_must_reset boolean;
  v_is_active boolean;
  v_portal_enabled boolean;
  v_portal_status text;
begin
  if coalesce(trim(p_vendor_code),'') = '' or coalesce(p_password,'') = '' then
    return jsonb_build_object('ok', false, 'error', 'vendor_code and password are required');
  end if;

  select v.id, v.company_id, v.portal_enabled, v.portal_status
    into v_vendor_id, v_company_id, v_portal_enabled, v_portal_status
  from public.erp_vendors v
  where lower(v.vendor_code) = lower(trim(p_vendor_code))
  limit 1;

  if v_vendor_id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid credentials');
  end if;

  if not coalesce(v_portal_enabled,false) then
    return jsonb_build_object('ok', false, 'error', 'Portal not enabled');
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

  return jsonb_build_object(
    'ok', true,
    'vendor_id', v_vendor_id,
    'company_id', v_company_id,
    'vendor_code', trim(p_vendor_code),
    'must_reset_password', coalesce(v_must_reset,true)
  );
end;
$$;

revoke all on function public.erp_mfg_vendor_login_v1(text, text) from public;
-- allow vendors (not logged in) to call via API using anon key OR route with service role.
-- safest: keep it NOT granted to anon, and call via service role in API.
grant execute on function public.erp_mfg_vendor_login_v1(text, text) to service_role;
