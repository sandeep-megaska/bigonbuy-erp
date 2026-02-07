-- Grant vendor portal access via Supabase auth.users identity (ERP session required).

insert into public.erp_roles (key, name)
values ('vendor', 'Vendor')
on conflict (key) do nothing;

create unique index if not exists erp_vendors_company_vendor_code_uniq
  on public.erp_vendors (company_id, vendor_code)
  where vendor_code is not null;

create or replace function public.erp_grant_vendor_portal_access(
  p_vendor_id uuid,
  p_email text,
  p_role_key text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_vendor public.erp_vendors;
  v_normalized_email text;
  v_normalized_role text;
  v_role_exists boolean := false;
  v_is_authorized boolean := false;
  v_is_owner boolean := false;
  v_candidate_vendor_code text;
  v_constraint_name text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_vendor_id is null or p_auth_user_id is null then
    raise exception 'vendor_id and auth user id are required';
  end if;

  v_normalized_email := lower(trim(coalesce(p_email, '')));
  if v_normalized_email = '' then
    raise exception 'Email is required';
  end if;

  v_normalized_role := coalesce(nullif(trim(p_role_key), ''), 'vendor');

  select exists (
    select 1
    from public.erp_roles r
    where r.key = v_normalized_role
  ) into v_role_exists;

  if not v_role_exists then
    raise exception 'Invalid role_key: %', v_normalized_role;
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized: owner/admin only';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and cu.role_key = 'owner'
      and coalesce(cu.is_active, true)
  ) into v_is_owner;

  if v_normalized_role = 'owner' and not v_is_owner then
    raise exception 'Only an existing owner can assign the owner role';
  end if;

  select *
    into v_vendor
    from public.erp_vendors v
   where v.id = p_vendor_id
     and v.company_id = v_company_id
   for update;

  if not found then
    raise exception 'Vendor not found for this company';
  end if;

  if v_vendor.portal_auth_user_id is not null and v_vendor.portal_auth_user_id <> p_auth_user_id then
    raise exception 'Vendor already linked to another auth user';
  end if;

  if coalesce(nullif(v_vendor.vendor_code, ''), '') = '' then
    loop
      v_candidate_vendor_code := public.erp_next_vendor_code(v_company_id);
      exit when not exists (
        select 1
        from public.erp_vendors existing
        where existing.company_id = v_company_id
          and existing.vendor_code = v_candidate_vendor_code
      );
    end loop;

    update public.erp_vendors
       set vendor_code = v_candidate_vendor_code,
           updated_at = now(),
           updated_by = v_actor
     where id = p_vendor_id
       and company_id = v_company_id
    returning * into v_vendor;
  end if;

  begin
    insert into public.erp_company_users (
      company_id,
      user_id,
      role_key,
      email,
      is_active,
      updated_at
    )
    values (
      v_company_id,
      p_auth_user_id,
      v_normalized_role,
      v_normalized_email,
      true,
      now()
    )
    on conflict (company_id, user_id) do update
      set role_key = excluded.role_key,
          email = coalesce(excluded.email, public.erp_company_users.email),
          is_active = true,
          updated_at = now();

    update public.erp_vendors
       set email = v_normalized_email,
           portal_enabled = true,
           portal_status = 'invited',
           portal_auth_user_id = p_auth_user_id,
           portal_temp_password_set_at = now(),
           updated_at = now(),
           updated_by = v_actor
     where id = p_vendor_id
       and company_id = v_company_id
    returning * into v_vendor;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
      if v_constraint_name = 'erp_vendors_portal_auth_user_id_uniq' then
        raise exception 'Conflict: auth user already linked to another vendor';
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'ok', true,
    'vendor_id', v_vendor.id,
    'vendor_code', v_vendor.vendor_code,
    'user_id', p_auth_user_id,
    'role_key', v_normalized_role,
    'email', v_normalized_email
  );
end;
$$;

revoke all on function public.erp_grant_vendor_portal_access(uuid, text, text, uuid) from public;
grant execute on function public.erp_grant_vendor_portal_access(uuid, text, text, uuid) to authenticated;
