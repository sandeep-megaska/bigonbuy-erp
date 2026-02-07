-- Fix ambiguous vendor_code reference in vendor portal enable RPC

create or replace function public.erp_vendor_portal_enable(
  p_vendor_id uuid,
  p_company_id uuid
) returns table (
  vendor_id uuid,
  vendor_code text,
  temp_password text,
  login_url text
)
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
begin
  if p_vendor_id is null or p_company_id is null then
    raise exception 'vendor_id and company_id are required';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = p_company_id
  ) then
    raise exception 'Vendor % not found for company %', p_vendor_id, p_company_id;
  end if;

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

  select string_agg(substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1), '')
    into v_temp_password
  from generate_series(1, 12);

  v_password_hash := extensions.crypt(v_temp_password, extensions.gen_salt('bf'));

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
  returning id into vendor_id;

  update public.erp_vendors v
     set portal_auth_user_id = (
       select au.id
       from public.erp_vendor_auth_users au
       where au.company_id = p_company_id
         and au.vendor_id = p_vendor_id
     )
   where v.id = p_vendor_id
     and v.company_id = p_company_id;

  vendor_id := p_vendor_id;
  vendor_code := l_vendor_code;
  temp_password := v_temp_password;
  login_url := '/mfg/login';
  return next;
end;
$$;

revoke all on function public.erp_vendor_portal_enable(uuid, uuid) from public;
grant execute on function public.erp_vendor_portal_enable(uuid, uuid) to authenticated;
