-- 0352_ap_outstanding_hardening.sql
-- Phase F2-B: AP Outstanding + Aging + Vendor Ledger hardening

------------------------------------------------------------
-- RPC: Vendor balances (as-of)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_balances(uuid);
drop function if exists public.erp_ap_vendor_balances(date, uuid);
drop function if exists public.erp_ap_vendor_balances(uuid, date);
drop function if exists public.erp_ap_vendor_balances_export(date, uuid);
drop function if exists public.erp_ap_vendor_balances_export(uuid, date);

create function public.erp_ap_vendor_balances(
  p_vendor_id uuid default null,
  p_as_of date default current_date
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
begin
  perform public.erp_require_finance_reader();

  -- Net payable = posted bills - approved payments - approved advances (all as-of date).
  return query
  with bills as (
    select
      i.vendor_id,
      sum(coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)) as total_bills
    from public.erp_gst_purchase_invoices i
    where i.company_id = v_company_id
      and i.status = 'posted'
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    group by i.vendor_id
  ),
  payments as (
    select
      p.vendor_id,
      sum(p.amount) as total_payments
    from public.erp_ap_vendor_payments p
    where p.company_id = v_company_id
      and p.status = 'approved'
      and p.is_void = false
      and p.payment_date <= p_as_of
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
    group by p.vendor_id
  ),
  advances as (
    select
      a.vendor_id,
      sum(a.amount) as total_advances
    from public.erp_ap_vendor_advances a
    where a.company_id = v_company_id
      and a.status = 'approved'
      and a.is_void = false
      and a.advance_date <= p_as_of
      and (p_vendor_id is null or a.vendor_id = p_vendor_id)
    group by a.vendor_id
  )
  select
    v.id as vendor_id,
    v.legal_name as vendor_name,
    coalesce(b.total_bills, 0::numeric) as total_bills,
    coalesce(p.total_payments, 0::numeric) as total_payments,
    coalesce(a.total_advances, 0::numeric) as total_advances,
    (coalesce(b.total_bills, 0::numeric)
      - coalesce(p.total_payments, 0::numeric)
      - coalesce(a.total_advances, 0::numeric)) as net_payable
  from public.erp_vendors v
  left join bills b
    on b.vendor_id = v.id
  left join payments p
    on p.vendor_id = v.id
  left join advances a
    on a.vendor_id = v.id
  where v.company_id = v_company_id
    and (p_vendor_id is null or v.id = p_vendor_id)
  order by v.legal_name;
end;
$$;

revoke all on function public.erp_ap_vendor_balances(uuid, date) from public;
grant execute on function public.erp_ap_vendor_balances(uuid, date) to authenticated;

create function public.erp_ap_vendor_balances_export(
  p_vendor_id uuid default null,
  p_as_of date default current_date
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
begin
  perform public.erp_require_finance_reader();

  return query
  with bills as (
    select
      i.vendor_id,
      sum(coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)) as total_bills
    from public.erp_gst_purchase_invoices i
    where i.company_id = v_company_id
      and i.status = 'posted'
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    group by i.vendor_id
  ),
  payments as (
    select
      p.vendor_id,
      sum(p.amount) as total_payments
    from public.erp_ap_vendor_payments p
    where p.company_id = v_company_id
      and p.status = 'approved'
      and p.is_void = false
      and p.payment_date <= p_as_of
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
    group by p.vendor_id
  ),
  advances as (
    select
      a.vendor_id,
      sum(a.amount) as total_advances
    from public.erp_ap_vendor_advances a
    where a.company_id = v_company_id
      and a.status = 'approved'
      and a.is_void = false
      and a.advance_date <= p_as_of
      and (p_vendor_id is null or a.vendor_id = p_vendor_id)
    group by a.vendor_id
  )
  select
    v.id as vendor_id,
    v.legal_name as vendor_name,
    coalesce(b.total_bills, 0::numeric) as total_bills,
    coalesce(p.total_payments, 0::numeric) as total_payments,
    coalesce(a.total_advances, 0::numeric) as total_advances,
    (coalesce(b.total_bills, 0::numeric)
      - coalesce(p.total_payments, 0::numeric)
      - coalesce(a.total_advances, 0::numeric)) as net_payable
  from public.erp_vendors v
  left join bills b
    on b.vendor_id = v.id
  left join payments p
    on p.vendor_id = v.id
  left join advances a
    on a.vendor_id = v.id
  where v.company_id = v_company_id
    and (p_vendor_id is null or v.id = p_vendor_id)
  order by v.legal_name;
end;
$$;

revoke all on function public.erp_ap_vendor_balances_export(uuid, date) from public;
grant execute on function public.erp_ap_vendor_balances_export(uuid, date) to authenticated;

------------------------------------------------------------
-- RPC: Vendor aging (as-of, outstanding only)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_aging(date, uuid);
drop function if exists public.erp_ap_vendor_aging(uuid, date);
drop function if exists public.erp_ap_vendor_aging_export(date, uuid);
drop function if exists public.erp_ap_vendor_aging_export(uuid, date);

create function public.erp_ap_vendor_aging(
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
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  -- Aging is computed on outstanding amounts (invoice total minus allocations as-of).
  return query
  with allocations as (
    select
      a.invoice_id,
      a.company_id,
      coalesce(sum(a.allocated_amount), 0::numeric) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.is_void = false
      and a.allocation_date <= p_as_of
    group by a.invoice_id, a.company_id
  ),
  invoices as (
    select
      i.id as invoice_id,
      i.vendor_id,
      v.legal_name as vendor_name,
      coalesce(i.due_date, i.invoice_date) as bucket_date,
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
      coalesce(a.allocated_total, 0::numeric) as allocated_total,
      greatest(
        coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
          - coalesce(a.allocated_total, 0::numeric),
        0::numeric
      ) as outstanding_amount
    from public.erp_gst_purchase_invoices i
    left join public.erp_vendors v
      on v.id = i.vendor_id
      and v.company_id = i.company_id
    left join allocations a
      on a.invoice_id = i.id
      and a.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.status = 'posted'
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  )
  select
    inv.vendor_id,
    max(inv.vendor_name) as vendor_name,
    sum(case when p_as_of - inv.bucket_date <= 30 then inv.outstanding_amount else 0::numeric end) as bucket_0_30,
    sum(case when p_as_of - inv.bucket_date between 31 and 60 then inv.outstanding_amount else 0::numeric end) as bucket_31_60,
    sum(case when p_as_of - inv.bucket_date between 61 and 90 then inv.outstanding_amount else 0::numeric end) as bucket_61_90,
    sum(case when p_as_of - inv.bucket_date > 90 then inv.outstanding_amount else 0::numeric end) as bucket_90_plus,
    sum(inv.outstanding_amount) as outstanding_total
  from invoices inv
  group by inv.vendor_id;
end;
$$;

revoke all on function public.erp_ap_vendor_aging(date, uuid) from public;
grant execute on function public.erp_ap_vendor_aging(date, uuid) to authenticated;

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
      coalesce(sum(a.allocated_amount), 0::numeric) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.is_void = false
      and a.allocation_date <= p_as_of
    group by a.invoice_id, a.company_id
  ),
  invoices as (
    select
      i.id as invoice_id,
      i.vendor_id,
      v.legal_name as vendor_name,
      coalesce(i.due_date, i.invoice_date) as bucket_date,
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
      coalesce(a.allocated_total, 0::numeric) as allocated_total,
      greatest(
        coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
          - coalesce(a.allocated_total, 0::numeric),
        0::numeric
      ) as outstanding_amount
    from public.erp_gst_purchase_invoices i
    left join public.erp_vendors v
      on v.id = i.vendor_id
      and v.company_id = i.company_id
    left join allocations a
      on a.invoice_id = i.id
      and a.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.status = 'posted'
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  )
  select
    inv.vendor_id,
    max(inv.vendor_name) as vendor_name,
    sum(case when p_as_of - inv.bucket_date <= 30 then inv.outstanding_amount else 0::numeric end) as bucket_0_30,
    sum(case when p_as_of - inv.bucket_date between 31 and 60 then inv.outstanding_amount else 0::numeric end) as bucket_31_60,
    sum(case when p_as_of - inv.bucket_date between 61 and 90 then inv.outstanding_amount else 0::numeric end) as bucket_61_90,
    sum(case when p_as_of - inv.bucket_date > 90 then inv.outstanding_amount else 0::numeric end) as bucket_90_plus,
    sum(inv.outstanding_amount) as outstanding_total
  from invoices inv
  group by inv.vendor_id;
end;
$$;

revoke all on function public.erp_ap_vendor_aging_export(date, uuid) from public;
grant execute on function public.erp_ap_vendor_aging_export(date, uuid) to authenticated;

------------------------------------------------------------
-- RPC: Outstanding invoices list (posted only)
------------------------------------------------------------

drop function if exists public.erp_ap_invoices_outstanding_list(uuid, date, date, text, int, int);

create function public.erp_ap_invoices_outstanding_list(
  p_vendor_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  invoice_id uuid,
  vendor_id uuid,
  vendor_name text,
  invoice_no text,
  invoice_date date,
  invoice_total numeric,
  allocated_total numeric,
  outstanding_amount numeric,
  currency text,
  source text,
  validation_status text,
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
  with allocations as (
    select
      a.invoice_id,
      a.company_id,
      coalesce(sum(a.allocated_amount), 0::numeric) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = v_company_id
      and a.is_void = false
    group by a.invoice_id, a.company_id
  )
  select
    i.id as invoice_id,
    i.vendor_id,
    v.legal_name as vendor_name,
    i.invoice_no,
    i.invoice_date,
    coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
    coalesce(a.allocated_total, 0::numeric) as allocated_total,
    greatest(
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
        - coalesce(a.allocated_total, 0::numeric),
      0::numeric
    ) as outstanding_amount,
    coalesce(i.currency, 'INR') as currency,
    i.source,
    i.validation_status,
    i.is_void
  from public.erp_gst_purchase_invoices i
  left join public.erp_vendors v
    on v.id = i.vendor_id
    and v.company_id = i.company_id
  left join allocations a
    on a.invoice_id = i.id
    and a.company_id = i.company_id
  where i.company_id = v_company_id
    and i.status = 'posted'
    and i.is_void = false
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
    and (
      p_q is null
      or btrim(p_q) = ''
      or coalesce(i.invoice_no, '') ilike ('%' || p_q || '%')
      or coalesce(i.note, '') ilike ('%' || p_q || '%')
      or coalesce(i.source_ref, '') ilike ('%' || p_q || '%')
      or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
    )
  order by i.invoice_date desc, i.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.erp_ap_invoices_outstanding_list(uuid, date, date, text, int, int) from public;
grant execute on function public.erp_ap_invoices_outstanding_list(uuid, date, date, text, int, int) to authenticated;

------------------------------------------------------------
-- RPC: Unallocated payments list (approved only)
------------------------------------------------------------

drop function if exists public.erp_ap_payments_unallocated_list(uuid, date, date, text, int, int);

create function public.erp_ap_payments_unallocated_list(
  p_vendor_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  payment_id uuid,
  vendor_id uuid,
  vendor_name text,
  payment_date date,
  payment_amount numeric,
  allocated_total numeric,
  unallocated_amount numeric,
  currency text,
  mode text,
  reference_no text,
  note text,
  source text,
  is_void boolean,
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
declare
  v_company_id uuid := public.erp_current_company_id();
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
    where p.company_id = v_company_id
      and p.status = 'approved'
      and p.is_void = false
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
      and (
        p_q is null
        or btrim(p_q) = ''
        or coalesce(p.reference_no, '') ilike ('%' || p_q || '%')
        or coalesce(p.note, '') ilike ('%' || p_q || '%')
        or coalesce(p.mode, '') ilike ('%' || p_q || '%')
        or coalesce(p.source_ref, '') ilike ('%' || p_q || '%')
        or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
      )
  ),
  allocations as (
    select
      a.payment_id,
      a.company_id,
      coalesce(sum(a.allocated_amount), 0::numeric) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = v_company_id
      and a.is_void = false
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
    where t.company_id = v_company_id
      and t.is_matched = true
      and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
  )
  select
    p.id as payment_id,
    p.vendor_id,
    p.vendor_name,
    p.payment_date,
    p.amount as payment_amount,
    coalesce(a.allocated_total, 0::numeric) as allocated_total,
    greatest(p.amount - coalesce(a.allocated_total, 0::numeric), 0::numeric) as unallocated_amount,
    p.currency,
    p.mode,
    p.reference_no,
    p.note,
    p.source,
    p.is_void,
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

revoke all on function public.erp_ap_payments_unallocated_list(uuid, date, date, text, int, int) from public;
grant execute on function public.erp_ap_payments_unallocated_list(uuid, date, date, text, int, int) to authenticated;

------------------------------------------------------------
-- RPC: Vendor ledger timeline (bills, advances, payments, allocations, voids)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_ledger(uuid, date, date);

create function public.erp_ap_vendor_ledger(
  p_vendor_id uuid,
  p_from date default null,
  p_to date default null
) returns table (
  txn_date date,
  txn_type text,
  reference_no text,
  doc_no text,
  description text,
  debit_amount numeric,
  credit_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    timeline.txn_date,
    timeline.txn_type,
    timeline.reference_no,
    timeline.doc_no,
    timeline.description,
    timeline.debit_amount,
    timeline.credit_amount
  from (
    select
      i.invoice_date as txn_date,
      'bill'::text as txn_type,
      i.invoice_no as reference_no,
      j.doc_no as doc_no,
      i.note as description,
      0::numeric as debit_amount,
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as credit_amount,
      i.created_at
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
      and j.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.vendor_id = p_vendor_id
      and i.status = 'posted'
      and i.is_void = false
      and (p_from is null or i.invoice_date >= p_from)
      and (p_to is null or i.invoice_date <= p_to)

    union all

    select
      (i.voided_at)::date as txn_date,
      'void'::text as txn_type,
      i.invoice_no as reference_no,
      j.doc_no as doc_no,
      coalesce(i.void_reason, 'Bill voided')::text as description,
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as debit_amount,
      0::numeric as credit_amount,
      i.voided_at as created_at
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
      and j.company_id = i.company_id
    where i.company_id = public.erp_current_company_id()
      and i.vendor_id = p_vendor_id
      and i.is_void = true
      and i.voided_at is not null
      and (p_from is null or i.voided_at::date >= p_from)
      and (p_to is null or i.voided_at::date <= p_to)

    union all

    select
      a.advance_date as txn_date,
      'advance'::text as txn_type,
      a.reference as reference_no,
      j.doc_no as doc_no,
      a.notes as description,
      a.amount as debit_amount,
      0::numeric as credit_amount,
      a.created_at
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
      and j.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.vendor_id = p_vendor_id
      and a.status = 'approved'
      and a.is_void = false
      and (p_from is null or a.advance_date >= p_from)
      and (p_to is null or a.advance_date <= p_to)

    union all

    select
      (a.voided_at)::date as txn_date,
      'void'::text as txn_type,
      a.reference as reference_no,
      j.doc_no as doc_no,
      coalesce(a.void_reason, 'Advance voided')::text as description,
      0::numeric as debit_amount,
      a.amount as credit_amount,
      a.voided_at as created_at
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
      and j.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.vendor_id = p_vendor_id
      and a.is_void = true
      and a.voided_at is not null
      and (p_from is null or a.voided_at::date >= p_from)
      and (p_to is null or a.voided_at::date <= p_to)

    union all

    select
      p.payment_date as txn_date,
      'payment'::text as txn_type,
      p.reference_no as reference_no,
      j.doc_no as doc_no,
      p.note as description,
      p.amount as debit_amount,
      0::numeric as credit_amount,
      p.created_at
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and p.vendor_id = p_vendor_id
      and p.status = 'approved'
      and p.is_void = false
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)

    union all

    select
      (p.voided_at)::date as txn_date,
      'void'::text as txn_type,
      p.reference_no as reference_no,
      j.doc_no as doc_no,
      coalesce(p.void_reason, 'Payment voided')::text as description,
      0::numeric as debit_amount,
      p.amount as credit_amount,
      p.voided_at as created_at
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and p.vendor_id = p_vendor_id
      and p.is_void = true
      and p.voided_at is not null
      and (p_from is null or p.voided_at::date >= p_from)
      and (p_to is null or p.voided_at::date <= p_to)

    union all

    select
      a.allocation_date as txn_date,
      'allocation'::text as txn_type,
      coalesce(p.reference_no, i.invoice_no)::text as reference_no,
      j.doc_no as doc_no,
      ('Allocation to bill ' || coalesce(i.invoice_no, i.id::text))::text as description,
      0::numeric as debit_amount,
      0::numeric as credit_amount,
      a.created_at
    from public.erp_ap_vendor_payment_allocations a
    join public.erp_ap_vendor_payments p
      on p.id = a.payment_id
      and p.company_id = a.company_id
    left join public.erp_gst_purchase_invoices i
      on i.id = a.invoice_id
      and i.company_id = a.company_id
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.vendor_id = p_vendor_id
      and a.is_void = false
      and (p_from is null or a.allocation_date >= p_from)
      and (p_to is null or a.allocation_date <= p_to)

    union all

    select
      (a.voided_at)::date as txn_date,
      'void'::text as txn_type,
      coalesce(p.reference_no, i.invoice_no)::text as reference_no,
      j.doc_no as doc_no,
      coalesce(a.void_reason, 'Payment allocation voided')::text as description,
      0::numeric as debit_amount,
      0::numeric as credit_amount,
      a.voided_at as created_at
    from public.erp_ap_vendor_payment_allocations a
    join public.erp_ap_vendor_payments p
      on p.id = a.payment_id
      and p.company_id = a.company_id
    left join public.erp_gst_purchase_invoices i
      on i.id = a.invoice_id
      and i.company_id = a.company_id
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
      and j.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.vendor_id = p_vendor_id
      and a.is_void = true
      and a.voided_at is not null
      and (p_from is null or a.voided_at::date >= p_from)
      and (p_to is null or a.voided_at::date <= p_to)

    union all

    select
      (ba.created_at)::date as txn_date,
      'allocation'::text as txn_type,
      coalesce(adv.reference, bill.invoice_no)::text as reference_no,
      j.doc_no as doc_no,
      ('Advance allocation to bill ' || coalesce(bill.invoice_no, bill.id::text))::text as description,
      0::numeric as debit_amount,
      0::numeric as credit_amount,
      ba.created_at
    from public.erp_ap_vendor_bill_advance_allocations ba
    join public.erp_ap_vendor_advances adv
      on adv.id = ba.advance_id
      and adv.company_id = ba.company_id
    left join public.erp_gst_purchase_invoices bill
      on bill.id = ba.bill_id
      and bill.company_id = ba.company_id
    left join public.erp_fin_journals j
      on j.id = adv.finance_journal_id
      and j.company_id = adv.company_id
    where ba.company_id = public.erp_current_company_id()
      and adv.vendor_id = p_vendor_id
      and ba.is_void = false
      and (p_from is null or ba.created_at::date >= p_from)
      and (p_to is null or ba.created_at::date <= p_to)

    union all

    select
      (ba.voided_at)::date as txn_date,
      'void'::text as txn_type,
      coalesce(adv.reference, bill.invoice_no)::text as reference_no,
      j.doc_no as doc_no,
      coalesce(ba.void_reason, 'Advance allocation voided')::text as description,
      0::numeric as debit_amount,
      0::numeric as credit_amount,
      ba.voided_at as created_at
    from public.erp_ap_vendor_bill_advance_allocations ba
    join public.erp_ap_vendor_advances adv
      on adv.id = ba.advance_id
      and adv.company_id = ba.company_id
    left join public.erp_gst_purchase_invoices bill
      on bill.id = ba.bill_id
      and bill.company_id = ba.company_id
    left join public.erp_fin_journals j
      on j.id = adv.finance_journal_id
      and j.company_id = adv.company_id
    where ba.company_id = public.erp_current_company_id()
      and adv.vendor_id = p_vendor_id
      and ba.is_void = true
      and ba.voided_at is not null
      and (p_from is null or ba.voided_at::date >= p_from)
      and (p_to is null or ba.voided_at::date <= p_to)
  ) timeline
  order by timeline.txn_date asc nulls last, timeline.created_at asc nulls last, timeline.txn_type asc;
end;
$$;

revoke all on function public.erp_ap_vendor_ledger(uuid, date, date) from public;
grant execute on function public.erp_ap_vendor_ledger(uuid, date, date) to authenticated;
