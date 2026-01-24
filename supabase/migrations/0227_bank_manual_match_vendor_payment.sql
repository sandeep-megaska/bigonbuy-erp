-- 0227_bank_manual_match_vendor_payment.sql
-- Phase-2D-B: Manual match/unmatch bank transactions to AP vendor payments

drop function if exists public.erp_bank_match_vendor_payment(uuid, uuid, text, text);

create function public.erp_bank_match_vendor_payment(
  p_bank_txn_id uuid,
  p_vendor_payment_id uuid,
  p_confidence text default 'manual',
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_updated int;
  v_is_void boolean;
  v_is_matched boolean;
  v_pay_exists boolean;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select t.is_void, t.is_matched
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
  into v_is_void, v_is_matched;

  if v_is_void is null then
    raise exception 'Bank transaction not found';
  end if;

  if v_is_void = true then
    raise exception 'Bank transaction is void';
  end if;

  if v_is_matched = true then
    raise exception 'Already matched';
  end if;

  select exists (
    select 1
    from public.erp_ap_vendor_payments vp
    where vp.id = p_vendor_payment_id
      and vp.company_id = v_company_id
      and coalesce(vp.is_void, false) = false
  ) into v_pay_exists;

  if not v_pay_exists then
    raise exception 'Vendor payment not found';
  end if;

  update public.erp_bank_transactions t
  set
    is_matched = true,
    matched_entity_type = 'vendor_payment',
    matched_entity_id = p_vendor_payment_id,
    match_confidence = coalesce(nullif(btrim(p_confidence), ''), 'manual'),
    match_notes = nullif(btrim(p_notes), ''),
    updated_at = now(),
    updated_by = v_actor
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
    and t.is_matched = false;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

drop function if exists public.erp_bank_unmatch(uuid, text);

create function public.erp_bank_unmatch(
  p_bank_txn_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_updated int;
  v_old_notes text;
  v_reason text;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'Reason is required';
  end if;

  select t.match_notes
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
  into v_old_notes;

  if v_old_notes is null and not found then
    raise exception 'Bank transaction not found';
  end if;

  update public.erp_bank_transactions t
  set
    is_matched = false,
    matched_entity_type = null,
    matched_entity_id = null,
    match_confidence = null,
    match_notes = (
      '[UNMATCH ' || now()::text || '] ' || v_reason ||
      case when v_old_notes is null or btrim(v_old_notes) = '' then '' else E'\n' || v_old_notes end
    ),
    updated_at = now(),
    updated_by = v_actor
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
    and t.is_matched = true;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

grant execute on function public.erp_bank_match_vendor_payment(uuid, uuid, text, text) to authenticated;
grant execute on function public.erp_bank_unmatch(uuid, text) to authenticated;
