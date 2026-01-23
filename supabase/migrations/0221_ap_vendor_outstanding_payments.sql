-- 0221_ap_vendor_outstanding_payments.sql
-- Phase-2C: AP vendor payments + outstanding + aging + exports

------------------------------------------------------------
-- TABLE: Vendor Payments
------------------------------------------------------------

create table if not exists public.erp_ap_vendor_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id()
    references public.erp_companies (id) on delete restrict,
  vendor_id uuid not null
    references public.erp_vendors (id) on delete restrict,
  payment_date date not null,
  amount numeric not null,
  currency text not null default 'INR',
  mode text not null default 'bank',
  reference_no text null,
  note text null,
  source text not null default 'manual',
  source_ref text null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

alter table public.erp_ap_vendor_payments enable row level security;

drop policy if exists erp_ap_vendor_payments_select on public.erp_ap_vendor_payments;
create policy erp_ap_vendor_payments_select
  on public.erp_ap_vendor_payments
  for select
  using (company_id = public.erp_current_company_id());

------------------------------------------------------------
-- RPC: Payment Upsert
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_upsert(
  uuid, date, numeric, text, text, text, text, text, text, uuid
);

create function public.erp_ap_vendor_payment_upsert(
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency text default 'INR',
  p_mode text default 'bank',
  p_reference_no text default null,
  p_note text default null,
  p_source text default 'manual',
  p_source_ref text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  if p_id is null then
    insert into public.erp_ap_vendor_payments (
      company_id, vendor_id, payment_date, amount, currency,
      mode, reference_no, note, source, source_ref,
      created_by, updated_by
    )
    values (
      v_company_id, p_vendor_id, p_payment_date, p_amount, p_currency,
      p_mode, p_reference_no, p_note, p_source, p_source_ref,
      auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    update public.erp_ap_vendor_payments
    set
      vendor_id = p_vendor_id,
      payment_date = p_payment_date,
      amount = p_amount,
      currency = p_currency,
      mode = p_mode,
      reference_no = p_reference_no,
      note = p_note,
      source = p_source,
      source_ref = p_source_ref,
      updated_at = now(),
      updated_by = auth.uid()
    where id = p_id
      and company_id = v_company_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.erp_ap_vendor_payment_upsert(
  uuid, date, numeric, text, text, text, text, text, text, uuid
) to authenticated;

------------------------------------------------------------
-- RPC: Void Payment
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_payment_void(uuid, text);

create function public.erp_ap_vendor_payment_void(
  p_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_writer();

  update public.erp_ap_vendor_payments
  set
    is_void = true,
    void_reason = p_reason,
    voided_at = now(),
    voided_by = auth.uid(),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_id
    and company_id = public.erp_current_company_id();

  return true;
end;
$$;

grant execute on function public.erp_ap_vendor_payment_void(uuid, text) to authenticated;

------------------------------------------------------------
-- RPC: Vendor Outstanding
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_outstanding(date, uuid);

create function public.erp_ap_vendor_outstanding(
  p_as_of date,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding numeric,
  last_invoice_date date,
  last_payment_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    v.id,
    v.legal_name,
    coalesce(sum(i.computed_invoice_total), 0),
    coalesce(sum(p.amount), 0),
    coalesce(sum(i.computed_invoice_total), 0)
      - coalesce(sum(p.amount), 0),
    max(i.invoice_date),
    max(p.payment_date)
  from public.erp_vendors v
  left join public.erp_gst_purchase_invoices i
    on i.vendor_id = v.id
    and i.company_id = public.erp_current_company_id()
    and i.is_void = false
    and i.invoice_date <= p_as_of
  left join public.erp_ap_vendor_payments p
    on p.vendor_id = v.id
    and p.company_id = public.erp_current_company_id()
    and p.is_void = false
    and p.payment_date <= p_as_of
  where v.company_id = public.erp_current_company_id()
    and (p_vendor_id is null or v.id = p_vendor_id)
  group by v.id, v.legal_name;
end;
$$;

grant execute on function public.erp_ap_vendor_outstanding(date, uuid) to authenticated;

------------------------------------------------------------
-- RPC: Vendor Aging (simple bucket)
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_aging(date, uuid);

create function public.erp_ap_vendor_aging(
  p_as_of date,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
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
  select
    i.vendor_id,
    sum(case when p_as_of - i.invoice_date <= 30 then i.computed_invoice_total else 0 end),
    sum(case when p_as_of - i.invoice_date between 31 and 60 then i.computed_invoice_total else 0 end),
    sum(case when p_as_of - i.invoice_date between 61 and 90 then i.computed_invoice_total else 0 end),
    sum(case when p_as_of - i.invoice_date > 90 then i.computed_invoice_total else 0 end),
    sum(i.computed_invoice_total)
  from public.erp_gst_purchase_invoices i
  where i.company_id = public.erp_current_company_id()
    and i.is_void = false
    and i.invoice_date <= p_as_of
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  group by i.vendor_id;
end;
$$;

grant execute on function public.erp_ap_vendor_aging(date, uuid) to authenticated;
