-- 0348_ap_vendor_payments_phase_f2.sql
-- Phase F2: Vendor payments posting + balances/aging + vendor ledger

------------------------------------------------------------
-- Table updates: vendor payments
------------------------------------------------------------

alter table public.erp_ap_vendor_payments
  add column if not exists payment_instrument_id uuid null references public.erp_gl_accounts (id) on delete set null,
  add column if not exists status text not null default 'draft',
  add column if not exists finance_journal_id uuid null references public.erp_fin_journals (id) on delete set null;

alter table public.erp_ap_vendor_payments
  drop constraint if exists erp_ap_vendor_payments_status_check;

alter table public.erp_ap_vendor_payments
  add constraint erp_ap_vendor_payments_status_check
  check (status in ('draft', 'approved', 'void'));

update public.erp_ap_vendor_payments
set status = case
  when is_void then 'void'
  else 'draft'
end
where status not in ('draft', 'approved', 'void')
  or status is null;

create index if not exists erp_ap_vendor_payments_company_vendor_date_idx
  on public.erp_ap_vendor_payments (company_id, vendor_id, payment_date desc);

------------------------------------------------------------
-- RPC: Vendor payment create (draft)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_create_draft(
  uuid, date, numeric, uuid, text, text
);

create function public.erp_ap_vendor_payment_create_draft(
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_instrument_id uuid default null,
  p_reference text default null,
  p_notes text default null
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
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  insert into public.erp_ap_vendor_payments (
    company_id,
    vendor_id,
    payment_date,
    amount,
    currency,
    mode,
    reference_no,
    note,
    payment_instrument_id,
    status,
    source,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_vendor_id,
    p_payment_date,
    p_amount,
    'INR',
    'bank',
    nullif(btrim(p_reference), ''),
    nullif(btrim(p_notes), ''),
    p_payment_instrument_id,
    'draft',
    'manual',
    v_actor,
    v_actor
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_ap_vendor_payment_create_draft(
  uuid, date, numeric, uuid, text, text
) from public;

grant execute on function public.erp_ap_vendor_payment_create_draft(
  uuid, date, numeric, uuid, text, text
) to authenticated;

------------------------------------------------------------
-- RPC: Vendor payment upsert (drafts only)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_upsert(
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
);

drop function if exists public.erp_ap_vendor_payment_upsert(
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
);

create function public.erp_ap_vendor_payment_upsert(
  p_id uuid,
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_instrument_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_currency text default 'INR',
  p_mode text default 'bank',
  p_source text default 'manual',
  p_source_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_status text;
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
    select status, is_void
      into v_status, v_is_void
    from public.erp_ap_vendor_payments
    where id = p_id
      and company_id = v_company_id
    for update;

    if v_status is null then
      raise exception 'Vendor payment not found';
    end if;

    if v_is_void or v_status <> 'draft' then
      raise exception 'Only draft payments can be edited';
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
      payment_instrument_id,
      status,
      source,
      source_ref,
      created_by,
      updated_by
    ) values (
      v_company_id,
      p_vendor_id,
      p_payment_date,
      p_amount,
      upper(coalesce(p_currency, 'INR')),
      coalesce(nullif(btrim(p_mode), ''), 'bank'),
      nullif(btrim(p_reference), ''),
      nullif(btrim(p_notes), ''),
      p_payment_instrument_id,
      'draft',
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
      reference_no = nullif(btrim(p_reference), ''),
      note = nullif(btrim(p_notes), ''),
      payment_instrument_id = p_payment_instrument_id,
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
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) is 'Insert or update AP vendor payments (draft only).';

revoke all on function public.erp_ap_vendor_payment_upsert(
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.erp_ap_vendor_payment_upsert(
  uuid,
  uuid,
  date,
  numeric,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

------------------------------------------------------------
-- RPC: Vendor payment allocations (set)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_set_allocations(uuid, jsonb);

create function public.erp_ap_vendor_payment_set_allocations(
  p_vendor_payment_id uuid,
  p_allocations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_total_allocated numeric := 0;
  v_allocation jsonb;
  v_invoice record;
  v_count int := 0;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_payment
  from public.erp_ap_vendor_payments
  where id = p_vendor_payment_id
    and company_id = v_company_id
  for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status <> 'draft' then
    raise exception 'Allocations can only be set for draft payments';
  end if;

  if p_allocations is null then
    p_allocations := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Allocations must be an array';
  end if;

  delete from public.erp_ap_vendor_payment_allocations
  where company_id = v_company_id
    and payment_id = p_vendor_payment_id;

  for v_allocation in
    select * from jsonb_array_elements(p_allocations)
  loop
    if (v_allocation->>'purchase_invoice_id') is null then
      raise exception 'Missing purchase_invoice_id in allocation';
    end if;

    if (v_allocation->>'amount') is null then
      raise exception 'Missing amount in allocation';
    end if;

    if (v_allocation->>'amount')::numeric <= 0 then
      raise exception 'Allocation amount must be greater than zero';
    end if;

    select
      i.id,
      i.vendor_id,
      i.is_void
    into v_invoice
    from public.erp_gst_purchase_invoices i
    where i.id = (v_allocation->>'purchase_invoice_id')::uuid
      and i.company_id = v_company_id;

    if v_invoice.id is null then
      raise exception 'Invoice not found';
    end if;

    if v_invoice.is_void then
      raise exception 'Invoice is void';
    end if;

    if v_invoice.vendor_id <> v_payment.vendor_id then
      raise exception 'Invoice vendor does not match payment vendor';
    end if;

    v_total_allocated := v_total_allocated + (v_allocation->>'amount')::numeric;

    insert into public.erp_ap_vendor_payment_allocations (
      company_id,
      vendor_id,
      invoice_id,
      payment_id,
      allocated_amount,
      allocation_date,
      source,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_payment.vendor_id,
      v_invoice.id,
      v_payment.id,
      (v_allocation->>'amount')::numeric,
      v_payment.payment_date,
      'manual',
      v_actor,
      v_actor
    );

    v_count := v_count + 1;
  end loop;

  if v_total_allocated > v_payment.amount then
    raise exception 'Allocated total exceeds payment amount';
  end if;

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'allocation_count', v_count,
    'allocated_total', v_total_allocated
  );
end;
$$;

revoke all on function public.erp_ap_vendor_payment_set_allocations(uuid, jsonb) from public;

grant execute on function public.erp_ap_vendor_payment_set_allocations(uuid, jsonb) to authenticated;

------------------------------------------------------------
-- RPC: Vendor payment approve (post journal)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_approve(uuid);

create function public.erp_ap_vendor_payment_approve(
  p_vendor_payment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_vendor_name text;
  v_payable_account record;
  v_bank_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_role_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select p.*, j.doc_no as posted_doc
    into v_payment
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.id = p_vendor_payment_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    raise exception 'Vendor payment is void';
  end if;

  if v_payment.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_payment.finance_journal_id, 'doc_no', v_payment.posted_doc);
  end if;

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payment.payment_instrument_id is not null then
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_payment.payment_instrument_id
        and a.company_id = v_company_id;
  else
    v_role_id := public.erp_fin_account_by_role('bank_main');
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_role_id;
  end if;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment posting accounts missing';
  end if;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    v_payment.payment_date,
    'posted',
    format('Vendor payment %s', coalesce(v_payment.reference_no, v_vendor_name, v_payment.id::text)),
    'vendor_payment',
    v_payment.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    1,
    v_payable_account.code,
    v_payable_account.name,
    format('Vendor payment %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    v_payment.amount,
    0
  );

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    2,
    v_bank_account.code,
    v_bank_account.name,
    'Vendor payment',
    0,
    v_payment.amount
  );

  v_total_debit := v_payment.amount;
  v_total_credit := v_payment.amount;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_ap_vendor_payments
     set finance_journal_id = v_journal_id,
         status = 'approved',
         updated_at = now(),
         updated_by = v_actor
   where id = v_payment.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

revoke all on function public.erp_ap_vendor_payment_approve(uuid) from public;

grant execute on function public.erp_ap_vendor_payment_approve(uuid) to authenticated;

------------------------------------------------------------
-- RPC: Vendor payment void (reversal journal)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_void(uuid, text);

create function public.erp_ap_vendor_payment_void(
  p_id uuid,
  p_void_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_vendor_name text;
  v_payable_account record;
  v_bank_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_role_id uuid;
  v_is_matched boolean;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select p.*
    into v_payment
    from public.erp_ap_vendor_payments p
    where p.company_id = v_company_id
      and p.id = p_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    return jsonb_build_object('voided', true);
  end if;

  if v_payment.status <> 'approved' then
    raise exception 'Only approved payments can be voided';
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

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payment.payment_instrument_id is not null then
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_payment.payment_instrument_id
        and a.company_id = v_company_id;
  else
    v_role_id := public.erp_fin_account_by_role('bank_main');
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_role_id;
  end if;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment reversal accounts missing';
  end if;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    current_date,
    'posted',
    format('Vendor payment void %s', coalesce(v_payment.reference_no, v_vendor_name, v_payment.id::text)),
    'vendor_payment_void',
    v_payment.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    1,
    v_bank_account.code,
    v_bank_account.name,
    'Vendor payment reversal',
    v_payment.amount,
    0
  );

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    2,
    v_payable_account.code,
    v_payable_account.name,
    format('Vendor payment void %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    0,
    v_payment.amount
  );

  update public.erp_fin_journals
  set total_debit = v_payment.amount,
      total_credit = v_payment.amount
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_ap_vendor_payments
  set
    is_void = true,
    status = 'void',
    void_reason = nullif(btrim(p_void_reason), ''),
    voided_at = now(),
    voided_by = v_actor,
    updated_at = now(),
    updated_by = v_actor
  where id = p_id
    and company_id = v_company_id;

  return jsonb_build_object('voided', true, 'journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

revoke all on function public.erp_ap_vendor_payment_void(uuid, text) from public;

grant execute on function public.erp_ap_vendor_payment_void(uuid, text) to authenticated;

------------------------------------------------------------
-- RPC: Vendor payments search + get (journal metadata)
------------------------------------------------------------

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
  payment_instrument_id uuid,
  status text,
  finance_journal_id uuid,
  journal_doc_no text,
  is_void boolean,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  allocation_count int,
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
      v.legal_name as vendor_name,
      j.doc_no as journal_doc_no
    from public.erp_ap_vendor_payments p
    left join public.erp_vendors v
      on v.id = p.vendor_id
      and v.company_id = p.company_id
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = p.company_id
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
  allocations as (
    select
      a.payment_id,
      a.company_id,
      count(*) filter (where a.is_void = false) as allocation_count
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
    group by a.payment_id, a.company_id
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
    p.payment_instrument_id,
    p.status,
    p.finance_journal_id,
    p.journal_doc_no,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    coalesce(a.allocation_count, 0) as allocation_count,
    (m.bank_txn_id is not null) as matched,
    m.bank_txn_id,
    m.txn_date,
    m.amount,
    m.description
  from payments p
  left join allocations a
    on a.payment_id = p.id
    and a.company_id = p.company_id
  left join matches m
    on m.matched_entity_id = p.id
  order by p.payment_date desc, p.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int)
  is 'Search vendor payments for a company with match metadata.';

revoke all on function public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int) from public;

grant execute on function public.erp_ap_vendor_payments_search(date, date, uuid, text, int, int)
  to authenticated;


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
  payment_instrument_id uuid,
  status text,
  finance_journal_id uuid,
  journal_doc_no text,
  is_void boolean,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  allocation_count int,
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
  with allocations as (
    select
      a.payment_id,
      a.company_id,
      count(*) filter (where a.is_void = false) as allocation_count
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
    group by a.payment_id, a.company_id
  )
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
    p.payment_instrument_id,
    p.status,
    p.finance_journal_id,
    j.doc_no as journal_doc_no,
    p.is_void,
    p.created_at,
    p.created_by,
    p.updated_at,
    p.updated_by,
    coalesce(a.allocation_count, 0) as allocation_count,
    (t.id is not null) as matched,
    t.id as matched_bank_txn_id,
    t.txn_date as matched_bank_txn_date,
    t.amount as matched_bank_txn_amount,
    t.description as matched_bank_txn_description
  from public.erp_ap_vendor_payments p
  left join public.erp_vendors v
    on v.id = p.vendor_id
    and v.company_id = p.company_id
  left join public.erp_fin_journals j
    on j.id = p.finance_journal_id
    and j.company_id = p.company_id
  left join allocations a
    on a.payment_id = p.id
    and a.company_id = p.company_id
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

revoke all on function public.erp_ap_vendor_payment_get(uuid) from public;

grant execute on function public.erp_ap_vendor_payment_get(uuid) to authenticated;

------------------------------------------------------------
-- RPC: Vendor balances + aging
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_balances(uuid);

create function public.erp_ap_vendor_balances(
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  total_bills numeric,
  total_payments numeric,
  total_advances numeric,
  net_payable numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payable_code text;
  v_advance_code text;
begin
  perform public.erp_require_finance_reader();

  select a.code into v_payable_code
  from public.erp_gl_accounts a
  where a.id = public.erp_fin_account_by_role('vendor_payable');

  select a.code into v_advance_code
  from public.erp_gl_accounts a
  where a.id = public.erp_fin_account_by_role('vendor_advance');

  return query
  with payable_lines as (
    select
      j.reference_type,
      j.reference_id,
      l.debit,
      l.credit
    from public.erp_fin_journal_lines l
    join public.erp_fin_journals j
      on j.id = l.journal_id
      and j.company_id = l.company_id
    where l.company_id = v_company_id
      and j.status <> 'void'
      and l.account_code = v_payable_code
  ),
  payable_mapped as (
    select
      case
        when p.reference_type = 'vendor_bill' then i.vendor_id
        when p.reference_type = 'vendor_payment' then vp.vendor_id
        else null
      end as vendor_id,
      p.reference_type,
      p.debit,
      p.credit
    from payable_lines p
    left join public.erp_gst_purchase_invoices i
      on i.id = p.reference_id
     and i.company_id = v_company_id
    left join public.erp_ap_vendor_payments vp
      on vp.id = p.reference_id
     and vp.company_id = v_company_id
  ),
  advances_lines as (
    select
      j.reference_type,
      j.reference_id,
      l.debit,
      l.credit
    from public.erp_fin_journal_lines l
    join public.erp_fin_journals j
      on j.id = l.journal_id
      and j.company_id = l.company_id
    where l.company_id = v_company_id
      and j.status <> 'void'
      and l.account_code = v_advance_code
  ),
  advances_mapped as (
    select
      case
        when a.reference_type = 'vendor_advance' then adv.vendor_id
        else null
      end as vendor_id,
      a.debit,
      a.credit
    from advances_lines a
    left join public.erp_ap_vendor_advances adv
      on adv.id = a.reference_id
     and adv.company_id = v_company_id
  ),
  payable_totals as (
    select
      vendor_id,
      sum(case when reference_type = 'vendor_bill' then credit else 0 end) as total_bills,
      sum(case when reference_type = 'vendor_payment' then debit else 0 end) as total_payments
    from payable_mapped
    where vendor_id is not null
    group by vendor_id
  ),
  advance_totals as (
    select
      vendor_id,
      sum(debit - credit) as total_advances
    from advances_mapped
    where vendor_id is not null
    group by vendor_id
  )
  select
    v.id as vendor_id,
    v.legal_name as vendor_name,
    coalesce(p.total_bills, 0) as total_bills,
    coalesce(p.total_payments, 0) as total_payments,
    coalesce(a.total_advances, 0) as total_advances,
    (coalesce(p.total_bills, 0) - coalesce(p.total_payments, 0) - coalesce(a.total_advances, 0)) as net_payable
  from public.erp_vendors v
  left join payable_totals p
    on p.vendor_id = v.id
  left join advance_totals a
    on a.vendor_id = v.id
  where v.company_id = v_company_id
    and (p_vendor_id is null or v.id = p_vendor_id)
  order by v.legal_name;
end;
$$;

revoke all on function public.erp_ap_vendor_balances(uuid) from public;

grant execute on function public.erp_ap_vendor_balances(uuid) to authenticated;


drop function if exists public.erp_ap_vendor_aging(date, uuid);

drop function if exists public.erp_ap_vendor_aging(uuid, date);

create function public.erp_ap_vendor_aging(
  p_vendor_id uuid default null,
  p_as_of date default current_date
) returns table(
  vendor_id uuid,
  vendor_name text,
  bucket_0_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  outstanding_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with allocations as (
    select
      a.invoice_id,
      a.company_id,
      coalesce(sum(a.allocated_amount), 0) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.is_void = false
    group by a.invoice_id, a.company_id
  ),
  invoices as (
    select
      i.id as invoice_id,
      i.vendor_id,
      i.company_id,
      v.legal_name as vendor_name,
      coalesce(i.due_date, i.invoice_date) as bucket_date,
      coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
      coalesce(a.allocated_total, 0) as allocated_total,
      greatest(
        coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) - coalesce(a.allocated_total, 0),
        0
      ) as outstanding_amount
    from public.erp_gst_purchase_invoices i
    left join public.erp_vendors v
      on v.id = i.vendor_id
      and v.company_id = i.company_id
    left join allocations a
      on a.invoice_id = i.id
      and a.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  )
  select
    inv.vendor_id,
    max(inv.vendor_name) as vendor_name,
    sum(case when p_as_of - inv.bucket_date <= 30 then inv.outstanding_amount else 0 end) as bucket_0_30,
    sum(case when p_as_of - inv.bucket_date between 31 and 60 then inv.outstanding_amount else 0 end) as bucket_31_60,
    sum(case when p_as_of - inv.bucket_date between 61 and 90 then inv.outstanding_amount else 0 end) as bucket_61_90,
    sum(case when p_as_of - inv.bucket_date > 90 then inv.outstanding_amount else 0 end) as bucket_90_plus,
    sum(inv.outstanding_amount) as outstanding_total
  from invoices inv
  group by inv.vendor_id;
end;
$$;

revoke all on function public.erp_ap_vendor_aging(uuid, date) from public;

grant execute on function public.erp_ap_vendor_aging(uuid, date) to authenticated;

------------------------------------------------------------
-- RPC: Vendor ledger timeline
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_ledger(uuid, date, date);

create function public.erp_ap_vendor_ledger(
  p_vendor_id uuid,
  p_from date default null,
  p_to date default null
) returns table(
  event_date date,
  event_type text,
  reference text,
  description text,
  debit_amount numeric,
  credit_amount numeric,
  journal_doc_no text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select * from (
    select
      i.invoice_date as event_date,
      'BILL'::text as event_type,
      i.invoice_no as reference,
      i.note as description,
      0::numeric as debit_amount,
      coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as credit_amount,
      j.doc_no as journal_doc_no,
      i.created_at
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
      and j.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.vendor_id = p_vendor_id
      and i.is_void = false
      and (p_from is null or i.invoice_date >= p_from)
      and (p_to is null or i.invoice_date <= p_to)

    union all

    select
      a.advance_date as event_date,
      'ADVANCE'::text as event_type,
      a.reference as reference,
      a.notes as description,
      a.amount as debit_amount,
      0::numeric as credit_amount,
      j.doc_no as journal_doc_no,
      a.created_at
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
      and j.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.vendor_id = p_vendor_id
      and a.is_void = false
      and (p_from is null or a.advance_date >= p_from)
      and (p_to is null or a.advance_date <= p_to)

    union all

    select
      p.payment_date as event_date,
      case when p.status = 'void' then 'VOID' else 'PAYMENT' end as event_type,
      p.reference_no as reference,
      p.note as description,
      case when p.status = 'void' then 0::numeric else p.amount end as debit_amount,
      case when p.status = 'void' then p.amount else 0::numeric end as credit_amount,
      j.doc_no as journal_doc_no,
      p.created_at
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and p.vendor_id = p_vendor_id
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)
  ) timeline
  order by event_date asc, created_at asc;
end;
$$;

revoke all on function public.erp_ap_vendor_ledger(uuid, date, date) from public;

grant execute on function public.erp_ap_vendor_ledger(uuid, date, date) to authenticated;

------------------------------------------------------------
-- RPC: Export helpers (aging/outstanding) — FIXED
-- Notes:
-- - There is NO erp_ap_vendor_balances() in DB; Codex created erp_ap_vendor_outstanding().
-- - Export wrappers must return TABLE(...), not "setof <function_name>".
-- - Function arg order in DB is (p_as_of date, p_vendor_id uuid).
------------------------------------------------------------

-- Drop any wrong/old signatures created by earlier attempts
drop function if exists public.erp_ap_vendor_aging_export(uuid, date);
drop function if exists public.erp_ap_vendor_outstanding_export(uuid, date);
drop function if exists public.erp_ap_vendor_balances_export(uuid);

-- OPTIONAL: Create a "balances" wrapper for convenience (balances == outstanding as-of date)
-- If you don't want this name, you can delete this function entirely.
drop function if exists public.erp_ap_vendor_balances(date, uuid);
drop function if exists public.erp_ap_vendor_balances(uuid);

create function public.erp_ap_vendor_balances(
  p_as_of date default current_date,
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding numeric,
  last_invoice_date date,
  last_payment_date date
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.erp_ap_vendor_outstanding(p_as_of, p_vendor_id);
$$;

revoke all on function public.erp_ap_vendor_balances(date, uuid) from public;
grant execute on function public.erp_ap_vendor_balances(date, uuid) to authenticated;

-- "Balances export" (kept for UI export convenience)
create function public.erp_ap_vendor_balances_export(
  p_as_of date default current_date,
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding numeric,
  last_invoice_date date,
  last_payment_date date
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.erp_ap_vendor_outstanding(p_as_of, p_vendor_id);
$$;

revoke all on function public.erp_ap_vendor_balances_export(date, uuid) from public;
grant execute on function public.erp_ap_vendor_balances_export(date, uuid) to authenticated;

-- Aging export (match your existing base aging columns + include vendor_name like your DB already shows)
drop function if exists public.erp_ap_vendor_aging_export(date, uuid);

drop function if exists public.erp_ap_vendor_aging_export(date, uuid);

create function public.erp_ap_vendor_aging_export(
  p_as_of date default current_date,
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  bucket_0_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  outstanding_total numeric
)
language sql
security definer
set search_path = public
as $$
  select
    i.vendor_id,
    v.legal_name as vendor_name,
    sum(case when p_as_of - i.invoice_date <= 30 then i.computed_invoice_total else 0 end) as bucket_0_30,
    sum(case when p_as_of - i.invoice_date between 31 and 60 then i.computed_invoice_total else 0 end) as bucket_31_60,
    sum(case when p_as_of - i.invoice_date between 61 and 90 then i.computed_invoice_total else 0 end) as bucket_61_90,
    sum(case when p_as_of - i.invoice_date > 90 then i.computed_invoice_total else 0 end) as bucket_90_plus,
    sum(i.computed_invoice_total) as outstanding_total
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v
    on v.id = i.vendor_id
   and v.company_id = i.company_id
  where i.company_id = public.erp_current_company_id()
    and i.is_void = false
    and i.invoice_date <= p_as_of
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  group by i.vendor_id, v.legal_name;
$$;

revoke all on function public.erp_ap_vendor_aging_export(date, uuid) from public;
grant execute on function public.erp_ap_vendor_aging_export(date, uuid) to authenticated;
