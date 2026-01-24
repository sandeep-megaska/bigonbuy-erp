-- 0238_ap_vendor_payments_rpcs.sql
-- Phase-3A: Vendor payments RPCs + matching metadata

drop function if exists public.erp_ap_vendor_payment_upsert(
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
);

create function public.erp_ap_vendor_payment_upsert(
  p_id uuid default null,
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency text,
  p_mode text,
  p_reference_no text default null,
  p_note text default null,
  p_source text default 'manual',
  p_source_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_is_void boolean;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_id is not null then
    select is_void
      into v_is_void
    from public.erp_ap_vendor_payments
    where id = p_id
      and company_id = v_company_id;

    if v_is_void is null then
      raise exception 'Vendor payment not found';
    end if;

    if v_is_void = true then
      raise exception 'Vendor payment is void';
    end if;
  end if;

  if p_id is null then
    insert into public.erp_ap_vendor_payments (
      company_id,
      vendor_id,
      payment_date,
      amount,
      currency,
      mode,
      reference_no,
      note,
      source,
      source_ref,
      created_by,
      updated_by
    )
    values (
      v_company_id,
      p_vendor_id,
      p_payment_date,
      p_amount,
      upper(coalesce(p_currency, 'INR')),
      coalesce(nullif(btrim(p_mode), ''), 'bank'),
      nullif(btrim(p_reference_no), ''),
      nullif(btrim(p_note), ''),
      coalesce(nullif(btrim(p_source), ''), 'manual'),
      nullif(btrim(p_source_ref), ''),
      v_actor,
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_ap_vendor_payments
    set
      vendor_id = p_vendor_id,
      payment_date = p_payment_date,
      amount = p_amount,
      currency = upper(coalesce(p_currency, currency)),
      mode = coalesce(nullif(btrim(p_mode), ''), mode),
      reference_no = nullif(btrim(p_reference_no), ''),
      note = nullif(btrim(p_note), ''),
      source = coalesce(nullif(btrim(p_source), ''), source),
      source_ref = nullif(btrim(p_source_ref), ''),
      updated_at = now(),
      updated_by = v_actor
    where id = p_id
      and company_id = v_company_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.erp_ap_vendor_payment_upsert(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text
) is 'Insert or update AP vendor payments with audit fields.';

drop function if exists public.erp_ap_vendor_payment_void(uuid, text);

create function public.erp_ap_vendor_payment_void(
  p_id uuid,
  p_void_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_is_void boolean;
  v_is_matched boolean;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select vp.is_void
    into v_is_void
  from public.erp_ap_vendor_payments vp
  where vp.id = p_id
    and vp.company_id = v_company_id;

  if v_is_void is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_is_void = true then
    raise exception 'Vendor payment already voided';
  end if;

  select exists (
    select 1
    from public.erp_bank_transactions t
    where t.company_id = v_company_id
      and t.is_matched = true
      and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
      and t.matched_entity_id = p_id
  ) into v_is_matched;

  if v_is_matched then
    raise exception 'Payment is matched to a bank transaction. Unmatch first.';
  end if;

  update public.erp_ap_vendor_payments
  set
    is_void = true,
    void_reason = nullif(btrim(p_void_reason), ''),
    voided_at = now(),
    voided_by = v_actor,
    updated_at = now(),
    updated_by = v_actor
  where id = p_id
    and company_id = v_company_id;
end;
$$;

comment on function public.erp_ap_vendor_payment_void(uuid, text)
  is 'Soft-void a vendor payment with reason.';

drop function if exists public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int);

create function public.erp_ap_vendor_payments_search(
  p_from date default null,
  p_to date default null,
  p_vendor_id uuid default null,
  p_q text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  company_id uuid,
  vendor_id uuid,
  vendor_name text,
  payment_date date,
  amount numeric,
  currency text,
  mode text,
  reference_no text,
  note text,
  source text,
  source_ref text,
  is_void boolean,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  matched boolean,
  matched_bank_txn_id uuid,
  matched_bank_txn_date date,
  matched_bank_txn_amount numeric,
  matched_bank_txn_description text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with payments as (
    select
      p.*,
      v.legal_name as vendor_name
    from public.erp_ap_vendor_payments p
    left join public.erp_vendors v
      on v.id = p.vendor_id
      and v.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
      and (
        p_q is null or btrim(p_q) = ''
        or coalesce(p.reference_no, '') ilike ('%' || p_q || '%')
        or coalesce(p.note, '') ilike ('%' || p_q || '%')
        or coalesce(p.mode, '') ilike ('%' || p_q || '%')
        or coalesce(p.source_ref, '') ilike ('%' || p_q || '%')
      )
  ),
  matches as (
    select
      t.id as bank_txn_id,
      t.txn_date,
      t.amount,
      t.description,
      t.matched_entity_id
    from public.erp_bank_transactions t
    where t.company_id = public.erp_current_company_id()
      and t.is_matched = true
      and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
  )
  select
    p.id,
    p.company_id,
    p.vendor_id,
    p.vendor_name,
    p.payment_date,
    p.amount,
    p.currency,
    p.mode,
    p.reference_no,
    p.note,
    p.source,
    p.source_ref,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    (m.bank_txn_id is not null) as matched,
    m.bank_txn_id,
    m.txn_date,
    m.amount,
    m.description
  from payments p
  left join matches m
    on m.matched_entity_id = p.id
  order by p.payment_date desc, p.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int)
  is 'Search vendor payments for a company with match metadata.';

drop function if exists public.erp_ap_vendor_payment_get(uuid);

create function public.erp_ap_vendor_payment_get(
  p_id uuid
)
returns table (
  id uuid,
  company_id uuid,
  vendor_id uuid,
  vendor_name text,
  payment_date date,
  amount numeric,
  currency text,
  mode text,
  reference_no text,
  note text,
  source text,
  source_ref text,
  is_void boolean,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  matched boolean,
  matched_bank_txn_id uuid,
  matched_bank_txn_date date,
  matched_bank_txn_amount numeric,
  matched_bank_txn_description text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    p.id,
    p.company_id,
    p.vendor_id,
    v.legal_name as vendor_name,
    p.payment_date,
    p.amount,
    p.currency,
    p.mode,
    p.reference_no,
    p.note,
    p.source,
    p.source_ref,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    (t.id is not null) as matched,
    t.id as matched_bank_txn_id,
    t.txn_date as matched_bank_txn_date,
    t.amount as matched_bank_txn_amount,
    t.description as matched_bank_txn_description
  from public.erp_ap_vendor_payments p
  left join public.erp_vendors v
    on v.id = p.vendor_id
    and v.company_id = p.company_id
  left join public.erp_bank_transactions t
    on t.company_id = p.company_id
    and t.is_matched = true
    and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
    and t.matched_entity_id = p.id
  where p.company_id = public.erp_current_company_id()
    and p.id = p_id;
end;
$$;

comment on function public.erp_ap_vendor_payment_get(uuid)
  is 'Fetch a single vendor payment with match metadata.';

grant execute on function public.erp_ap_vendor_payment_upsert(
  uuid,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

grant execute on function public.erp_ap_vendor_payment_void(uuid, text) to authenticated;

grant execute on function public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int)
  to authenticated;

grant execute on function public.erp_ap_vendor_payment_get(uuid) to authenticated;
