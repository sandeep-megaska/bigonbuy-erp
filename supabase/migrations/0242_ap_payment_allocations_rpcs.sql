-- 0242_ap_payment_allocations_rpcs.sql
-- Phase-3B: AP allocation RPCs

------------------------------------------------------------
-- RPC: Allocate vendor payment
------------------------------------------------------------

drop function if exists public.erp_ap_allocate_vendor_payment(
  uuid, uuid, uuid, numeric, date, text, text, text
);

create function public.erp_ap_allocate_vendor_payment(
  p_vendor_id uuid,
  p_invoice_id uuid,
  p_payment_id uuid,
  p_allocated_amount numeric,
  p_allocation_date date,
  p_note text,
  p_source text,
  p_source_ref text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_invoice_vendor_id uuid;
  v_payment_vendor_id uuid;
  v_invoice_total numeric := 0;
  v_payment_amount numeric := 0;
  v_invoice_allocated_sum numeric := 0;
  v_payment_allocated_sum numeric := 0;
  v_invoice_is_void boolean := false;
  v_payment_is_void boolean := false;
  v_allocation_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_allocated_amount is null or p_allocated_amount <= 0 then
    raise exception 'Allocated amount must be greater than zero';
  end if;

  select
    i.vendor_id,
    coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax),
    i.is_void
  into v_invoice_vendor_id, v_invoice_total, v_invoice_is_void
  from public.erp_gst_purchase_invoices i
  where i.id = p_invoice_id
    and i.company_id = v_company_id;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice_vendor_id <> p_vendor_id then
    raise exception 'Invoice vendor does not match allocation vendor';
  end if;

  if v_invoice_is_void then
    raise exception 'Invoice is void';
  end if;

  select
    p.vendor_id,
    p.amount,
    p.is_void
  into v_payment_vendor_id, v_payment_amount, v_payment_is_void
  from public.erp_ap_vendor_payments p
  where p.id = p_payment_id
    and p.company_id = v_company_id;

  if not found then
    raise exception 'Payment not found';
  end if;

  if v_payment_vendor_id <> p_vendor_id then
    raise exception 'Payment vendor does not match allocation vendor';
  end if;

  if v_payment_is_void then
    raise exception 'Payment is void';
  end if;

  select coalesce(sum(a.allocated_amount), 0)
    into v_invoice_allocated_sum
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = v_company_id
      and a.invoice_id = p_invoice_id
      and a.is_void = false;

  select coalesce(sum(a.allocated_amount), 0)
    into v_payment_allocated_sum
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = v_company_id
      and a.payment_id = p_payment_id
      and a.is_void = false;

  if v_invoice_allocated_sum + p_allocated_amount > v_invoice_total then
    raise exception 'Allocation exceeds invoice outstanding amount';
  end if;

  if v_payment_allocated_sum + p_allocated_amount > v_payment_amount then
    raise exception 'Allocation exceeds payment unallocated amount';
  end if;

  insert into public.erp_ap_vendor_payment_allocations (
    company_id,
    vendor_id,
    invoice_id,
    payment_id,
    allocated_amount,
    allocation_date,
    note,
    source,
    source_ref,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_vendor_id,
    p_invoice_id,
    p_payment_id,
    p_allocated_amount,
    p_allocation_date,
    p_note,
    p_source,
    p_source_ref,
    v_actor,
    v_actor
  )
  returning id into v_allocation_id;

  return v_allocation_id;
end;
$$;

grant execute on function public.erp_ap_allocate_vendor_payment(
  uuid, uuid, uuid, numeric, date, text, text, text
) to authenticated;

------------------------------------------------------------
-- RPC: Void allocation
------------------------------------------------------------

drop function if exists public.erp_ap_allocation_void(uuid, text);

create function public.erp_ap_allocation_void(
  p_allocation_id uuid,
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
  v_updated_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  update public.erp_ap_vendor_payment_allocations
  set
    is_void = true,
    void_reason = p_void_reason,
    voided_at = now(),
    voided_by = v_actor,
    updated_at = now(),
    updated_by = v_actor
  where id = p_allocation_id
    and company_id = v_company_id
    and is_void = false
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Allocation not found or already voided';
  end if;
end;
$$;

grant execute on function public.erp_ap_allocation_void(uuid, text) to authenticated;

------------------------------------------------------------
-- RPC: Outstanding invoices list
------------------------------------------------------------

drop function if exists public.erp_ap_invoices_outstanding_list(
  uuid, date, date, text, int, int
);

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
      coalesce(sum(a.allocated_amount), 0) as allocated_total
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
    coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(
      coalesce(i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) - coalesce(a.allocated_total, 0),
      0
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

grant execute on function public.erp_ap_invoices_outstanding_list(
  uuid, date, date, text, int, int
) to authenticated;

------------------------------------------------------------
-- RPC: Unallocated payments list
------------------------------------------------------------

drop function if exists public.erp_ap_payments_unallocated_list(
  uuid, date, date, text, int, int
);

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
      coalesce(sum(a.allocated_amount), 0) as allocated_total
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
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(p.amount - coalesce(a.allocated_total, 0), 0) as unallocated_amount,
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

grant execute on function public.erp_ap_payments_unallocated_list(
  uuid, date, date, text, int, int
) to authenticated;

------------------------------------------------------------
-- RPC: Allocations for invoice
------------------------------------------------------------

drop function if exists public.erp_ap_allocations_for_invoice(uuid);

create function public.erp_ap_allocations_for_invoice(
  p_invoice_id uuid
)
returns table (
  allocation_id uuid,
  invoice_id uuid,
  payment_id uuid,
  vendor_id uuid,
  allocated_amount numeric,
  allocation_date date,
  note text,
  source text,
  source_ref text,
  is_void boolean,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  payment_date date,
  payment_amount numeric,
  payment_currency text,
  payment_mode text,
  payment_reference_no text,
  payment_note text,
  payment_source text,
  payment_source_ref text,
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
  with allocations as (
    select
      a.*,
      p.payment_date,
      p.amount as payment_amount,
      p.currency as payment_currency,
      p.mode as payment_mode,
      p.reference_no as payment_reference_no,
      p.note as payment_note,
      p.source as payment_source,
      p.source_ref as payment_source_ref
    from public.erp_ap_vendor_payment_allocations a
    join public.erp_ap_vendor_payments p
      on p.id = a.payment_id
      and p.company_id = a.company_id
    where a.company_id = v_company_id
      and a.invoice_id = p_invoice_id
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
    a.id as allocation_id,
    a.invoice_id,
    a.payment_id,
    a.vendor_id,
    a.allocated_amount,
    a.allocation_date,
    a.note,
    a.source,
    a.source_ref,
    a.is_void,
    a.void_reason,
    a.voided_at,
    a.voided_by,
    a.created_at,
    a.created_by,
    a.updated_at,
    a.updated_by,
    a.payment_date,
    a.payment_amount,
    a.payment_currency,
    a.payment_mode,
    a.payment_reference_no,
    a.payment_note,
    a.payment_source,
    a.payment_source_ref,
    (m.bank_txn_id is not null) as matched,
    m.bank_txn_id,
    m.txn_date,
    m.amount,
    m.description
  from allocations a
  left join matches m
    on m.matched_entity_id = a.payment_id
  order by a.allocation_date desc, a.created_at desc;
end;
$$;

grant execute on function public.erp_ap_allocations_for_invoice(uuid) to authenticated;
