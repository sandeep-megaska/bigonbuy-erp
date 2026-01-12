-- 0048_hr_employee_contact_address_upsert.sql
-- HR employee contact/address upsert RPCs + company-scoped uniqueness

create unique index if not exists erp_employee_contacts_company_employee_type_key
  on public.erp_employee_contacts (company_id, employee_id, contact_type);

create unique index if not exists erp_employee_addresses_company_employee_type_key
  on public.erp_employee_addresses (company_id, employee_id, address_type);

create or replace function public.erp_hr_employee_contact_upsert(
  p_employee_id uuid,
  p_contact_type text,
  p_email text default null,
  p_phone text default null,
  p_is_primary boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_contact_id uuid;
begin
  perform public.erp_require_hr_writer();

  insert into public.erp_employee_contacts (
    company_id,
    employee_id,
    contact_type,
    email,
    phone,
    is_primary,
    created_by,
    updated_by
  )
  values (
    v_company_id,
    p_employee_id,
    p_contact_type,
    p_email,
    p_phone,
    coalesce(p_is_primary, false),
    v_actor,
    v_actor
  )
  on conflict (company_id, employee_id, contact_type) do update
    set email = excluded.email,
        phone = excluded.phone,
        is_primary = excluded.is_primary,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_contact_id;

  if coalesce(p_is_primary, false) then
    update public.erp_employee_contacts
       set is_primary = false,
           updated_at = now(),
           updated_by = v_actor
     where company_id = v_company_id
       and employee_id = p_employee_id
       and id <> v_contact_id
       and is_primary = true;
  end if;

  return v_contact_id;
end;
$$;

revoke all on function public.erp_hr_employee_contact_upsert(uuid, text, text, text, boolean) from public;
grant execute on function public.erp_hr_employee_contact_upsert(uuid, text, text, text, boolean) to authenticated;

create or replace function public.erp_hr_employee_address_upsert(
  p_employee_id uuid,
  p_address_type text,
  p_line1 text default null,
  p_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default null,
  p_is_primary boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_address_id uuid;
begin
  perform public.erp_require_hr_writer();

  insert into public.erp_employee_addresses (
    company_id,
    employee_id,
    address_type,
    line1,
    line2,
    city,
    state,
    postal_code,
    country,
    is_primary,
    created_by,
    updated_by
  )
  values (
    v_company_id,
    p_employee_id,
    p_address_type,
    p_line1,
    p_line2,
    p_city,
    p_state,
    p_postal_code,
    p_country,
    coalesce(p_is_primary, false),
    v_actor,
    v_actor
  )
  on conflict (company_id, employee_id, address_type) do update
    set line1 = excluded.line1,
        line2 = excluded.line2,
        city = excluded.city,
        state = excluded.state,
        postal_code = excluded.postal_code,
        country = excluded.country,
        is_primary = excluded.is_primary,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_address_id;

  if coalesce(p_is_primary, false) then
    update public.erp_employee_addresses
       set is_primary = false,
           updated_at = now(),
           updated_by = v_actor
     where company_id = v_company_id
       and employee_id = p_employee_id
       and id <> v_address_id
       and is_primary = true;
  end if;

  return v_address_id;
end;
$$;

revoke all on function public.erp_hr_employee_address_upsert(uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.erp_hr_employee_address_upsert(uuid, text, text, text, text, text, text, text, boolean) to authenticated;
