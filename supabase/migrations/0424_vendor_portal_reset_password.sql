-- 0424_vendor_portal_reset_password.sql
-- Adds vendor portal password reset/regen (admin action) and ensures vendor auth row exists.

create or replace function public.erp_vendor_portal_reset_password_v1(
  p_vendor_id uuid,
  p_company_id uuid,
  p_auth_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_authorized boolean := false;
  v_vendor_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  v_temp_password text;
  v_password_hash text;
begin
  if p_vendor_id is null or p_company_id is null then
    raise exception 'vendor_id and company_id are required';
  end if;

  -- authorize ERP admin
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

  -- ensure vendor exists and vendor_code exists
  update public.erp_vendors v
     set vendor_code = coalesce(v.vendor_code, public.erp_next_vendor_code(v.company_id)),
         portal_enabled = true,
         portal_status = 'invited',
         portal_temp_password_set_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where v.id = p_vendor_id
     and v.company_id = p_company_id
  returning v.vendor_code into v_vendor_code;

  if v_vendor_code is null then
    raise exception 'Vendor not found';
  end if;

  -- generate temp password (12 chars)
  select string_agg(substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1), '')
    into v_temp_password
  from generate_series(1, 12);

  v_password_hash := extensions.crypt(v_temp_password, extensions.gen_salt('bf'));

  -- upsert vendor auth row (this is what vendor login checks!)
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
    updated_by = auth.uid();

  -- optionally link auth user id on vendor record (if your admin endpoint provisions one)
  if p_auth_user_id is not null then
    update public.erp_vendors v
       set portal_auth_user_id = p_auth_user_id,
           updated_at = now(),
           updated_by = auth.uid()
     where v.id = p_vendor_id and v.company_id = p_company_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'vendor_id', p_vendor_id,
    'vendor_code', v_vendor_code,
    'temp_password', v_temp_password,
    'login_url', '/mfg/login'
  );
end;
$$;

revoke all on function public.erp_vendor_portal_reset_password_v1(uuid, uuid, uuid) from public;
grant execute on function public.erp_vendor_portal_reset_password_v1(uuid, uuid, uuid) to authenticated;
