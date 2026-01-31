-- 0342_ap_vendor_tds_profiles.sql
-- Vendor TDS profile RPCs (table + policies created in 0340)

create or replace function public.erp_vendor_tds_profile_upsert(
  p_profile jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_profile_id uuid;
  v_vendor_id uuid := nullif(p_profile->>'vendor_id', '')::uuid;
  v_section text := nullif(trim(coalesce(p_profile->>'tds_section', '')), '');
  v_rate numeric := coalesce(nullif(p_profile->>'tds_rate', '')::numeric, 0);
  v_threshold numeric := nullif(p_profile->>'threshold_amount', '')::numeric;
  v_effective_from date := coalesce(nullif(p_profile->>'effective_from', '')::date, current_date);
  v_effective_to date := nullif(p_profile->>'effective_to', '')::date;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if v_section is null then
    raise exception 'tds_section is required';
  end if;

  if v_rate < 0 then
    raise exception 'tds_rate must be >= 0';
  end if;

  if (p_profile ? 'id') and nullif(p_profile->>'id', '') is not null then
    v_profile_id := (p_profile->>'id')::uuid;

    update public.erp_vendor_tds_profiles
       set tds_section = v_section,
           tds_rate = v_rate,
           threshold_amount = v_threshold,
           effective_from = v_effective_from,
           effective_to = v_effective_to,
           updated_at = now(),
           updated_by = v_actor
     where id = v_profile_id
       and company_id = v_company_id
       and is_void = false
    returning id into v_profile_id;

    if v_profile_id is null then
      raise exception 'TDS profile not found';
    end if;
  else
    insert into public.erp_vendor_tds_profiles (
      company_id,
      vendor_id,
      tds_section,
      tds_rate,
      threshold_amount,
      effective_from,
      effective_to,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_vendor_id,
      v_section,
      v_rate,
      v_threshold,
      v_effective_from,
      v_effective_to,
      v_actor,
      v_actor
    ) returning id into v_profile_id;
  end if;

  return v_profile_id;
end;
$$;

revoke all on function public.erp_vendor_tds_profile_upsert(jsonb) from public;
grant execute on function public.erp_vendor_tds_profile_upsert(jsonb) to authenticated;

create or replace function public.erp_vendor_tds_profile_void(
  p_profile_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  update public.erp_vendor_tds_profiles
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_profile_id
     and company_id = v_company_id
     and is_void = false
  returning id into v_id;

  if v_id is null then
    raise exception 'TDS profile not found';
  end if;

  return true;
end;
$$;

revoke all on function public.erp_vendor_tds_profile_void(uuid, text) from public;
grant execute on function public.erp_vendor_tds_profile_void(uuid, text) to authenticated;

create or replace function public.erp_vendor_tds_profiles_list(
  p_vendor_id uuid
) returns table (
  profile_id uuid,
  vendor_id uuid,
  tds_section text,
  tds_rate numeric,
  threshold_amount numeric,
  effective_from date,
  effective_to date,
  is_void boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  select
    t.id as profile_id,
    t.vendor_id,
    t.tds_section,
    t.tds_rate,
    t.threshold_amount,
    t.effective_from,
    t.effective_to,
    t.is_void
  from public.erp_vendor_tds_profiles t
  where t.company_id = v_company_id
    and t.vendor_id = p_vendor_id
    and t.is_void = false
  order by t.effective_from desc;
end;
$$;

revoke all on function public.erp_vendor_tds_profiles_list(uuid) from public;
grant execute on function public.erp_vendor_tds_profiles_list(uuid) to authenticated;

create or replace function public.erp_vendor_tds_profile_latest(
  p_vendor_id uuid,
  p_for_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_vendor_tds_profiles;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_row
    from public.erp_vendor_tds_profiles t
    where t.company_id = v_company_id
      and t.vendor_id = p_vendor_id
      and t.is_void = false
      and t.effective_from <= coalesce(p_for_date, current_date)
      and (t.effective_to is null or t.effective_to >= coalesce(p_for_date, current_date))
    order by t.effective_from desc
    limit 1;

  if v_row.id is null then
    return jsonb_build_object('tds_section', null, 'tds_rate', null);
  end if;

  return jsonb_build_object(
    'tds_section', v_row.tds_section,
    'tds_rate', v_row.tds_rate,
    'effective_from', v_row.effective_from,
    'effective_to', v_row.effective_to
  );
end;
$$;

revoke all on function public.erp_vendor_tds_profile_latest(uuid, date) from public;
grant execute on function public.erp_vendor_tds_profile_latest(uuid, date) to authenticated;
