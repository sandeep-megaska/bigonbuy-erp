-- 0295_hr_employee_profile_statutory_bank_emergency_rpcs.sql
-- HR employee profile RPCs: statutory, bank, emergency

create or replace function public.erp_hr_employee_statutory_get(
  p_employee_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  select to_jsonb(row_data)
    into v_payload
    from (
      select
        s.id as id,
        s.employee_id as employee_id,
        s.pan as pan,
        s.uan as uan,
        s.pf_number as pf_number,
        s.esic_number as esic_number,
        s.professional_tax_number as professional_tax_number,
        s.created_at as created_at,
        s.updated_at as updated_at
      from public.erp_employee_statutory s
      where s.company_id = v_company_id
        and s.employee_id = p_employee_id
      limit 1
    ) as row_data;

  return v_payload;
end;
$$;

revoke all on function public.erp_hr_employee_statutory_get(uuid) from public;
grant execute on function public.erp_hr_employee_statutory_get(uuid) to authenticated;

create or replace function public.erp_hr_employee_statutory_upsert(
  p_employee_id uuid,
  p_pan text default null,
  p_uan text default null,
  p_pf_number text default null,
  p_esic_number text default null,
  p_professional_tax_number text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_employee_statutory (
    company_id,
    employee_id,
    pan,
    uan,
    pf_number,
    esic_number,
    professional_tax_number,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    p_pan,
    p_uan,
    p_pf_number,
    p_esic_number,
    p_professional_tax_number,
    v_actor,
    v_actor
  )
  on conflict (employee_id) do update
    set pan = excluded.pan,
        uan = excluded.uan,
        pf_number = excluded.pf_number,
        esic_number = excluded.esic_number,
        professional_tax_number = excluded.professional_tax_number,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_hr_employee_statutory_upsert(uuid, text, text, text, text, text) from public;
grant execute on function public.erp_hr_employee_statutory_upsert(uuid, text, text, text, text, text) to authenticated;

create or replace function public.erp_hr_employee_bank_get(
  p_employee_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  select to_jsonb(row_data)
    into v_payload
    from (
      select
        b.id as id,
        b.employee_id as employee_id,
        b.bank_name as bank_name,
        b.branch_name as branch_name,
        b.account_holder_name as account_holder_name,
        b.account_number as account_number,
        b.ifsc_code as ifsc_code,
        b.account_type as account_type,
        b.is_primary as is_primary,
        b.created_at as created_at,
        b.updated_at as updated_at
      from public.erp_employee_bank_accounts b
      where b.company_id = v_company_id
        and b.employee_id = p_employee_id
      order by b.is_primary desc, b.created_at desc
      limit 1
    ) as row_data;

  return v_payload;
end;
$$;

revoke all on function public.erp_hr_employee_bank_get(uuid) from public;
grant execute on function public.erp_hr_employee_bank_get(uuid) to authenticated;

create or replace function public.erp_hr_employee_bank_upsert(
  p_employee_id uuid,
  p_bank_name text,
  p_branch_name text default null,
  p_account_holder_name text default null,
  p_account_number text,
  p_ifsc_code text default null,
  p_account_type text default null,
  p_is_primary boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_is_primary boolean := coalesce(p_is_primary, true);
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_employee_bank_accounts (
    company_id,
    employee_id,
    bank_name,
    branch_name,
    account_holder_name,
    account_number,
    ifsc_code,
    account_type,
    is_primary,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    p_bank_name,
    p_branch_name,
    p_account_holder_name,
    p_account_number,
    p_ifsc_code,
    p_account_type,
    v_is_primary,
    v_actor,
    v_actor
  )
  on conflict (employee_id, is_primary) where is_primary do update
    set bank_name = excluded.bank_name,
        branch_name = excluded.branch_name,
        account_holder_name = excluded.account_holder_name,
        account_number = excluded.account_number,
        ifsc_code = excluded.ifsc_code,
        account_type = excluded.account_type,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_id;

  if v_is_primary then
    update public.erp_employee_bank_accounts
       set is_primary = false,
           updated_at = now(),
           updated_by = v_actor
     where company_id = v_company_id
       and employee_id = p_employee_id
       and id <> v_id
       and is_primary = true;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_hr_employee_bank_upsert(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.erp_hr_employee_bank_upsert(uuid, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.erp_hr_employee_emergency_get(
  p_employee_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  select to_jsonb(row_data)
    into v_payload
    from (
      select
        c.id as id,
        c.employee_id as employee_id,
        c.full_name as full_name,
        c.relationship as relationship,
        c.phone as phone,
        c.email as email,
        c.is_primary as is_primary,
        c.created_at as created_at,
        c.updated_at as updated_at
      from public.erp_employee_emergency_contacts c
      where c.company_id = v_company_id
        and c.employee_id = p_employee_id
      order by c.is_primary desc, c.created_at desc
      limit 1
    ) as row_data;

  return v_payload;
end;
$$;

revoke all on function public.erp_hr_employee_emergency_get(uuid) from public;
grant execute on function public.erp_hr_employee_emergency_get(uuid) to authenticated;

create or replace function public.erp_hr_employee_emergency_upsert(
  p_employee_id uuid,
  p_full_name text,
  p_relationship text default null,
  p_phone text default null,
  p_email text default null,
  p_is_primary boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_is_primary boolean := coalesce(p_is_primary, true);
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  insert into public.erp_employee_emergency_contacts (
    company_id,
    employee_id,
    full_name,
    relationship,
    phone,
    email,
    is_primary,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_employee_id,
    p_full_name,
    p_relationship,
    p_phone,
    p_email,
    v_is_primary,
    v_actor,
    v_actor
  )
  on conflict (employee_id, is_primary) where is_primary do update
    set full_name = excluded.full_name,
        relationship = excluded.relationship,
        phone = excluded.phone,
        email = excluded.email,
        updated_at = now(),
        updated_by = v_actor
  returning id into v_id;

  if v_is_primary then
    update public.erp_employee_emergency_contacts
       set is_primary = false,
           updated_at = now(),
           updated_by = v_actor
     where company_id = v_company_id
       and employee_id = p_employee_id
       and id <> v_id
       and is_primary = true;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_hr_employee_emergency_upsert(uuid, text, text, text, text, boolean) from public;
grant execute on function public.erp_hr_employee_emergency_upsert(uuid, text, text, text, text, boolean) to authenticated;
