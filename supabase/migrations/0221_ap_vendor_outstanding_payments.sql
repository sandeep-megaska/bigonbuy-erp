-- AP vendor payments + outstanding + aging + exports

create table if not exists public.erp_ap_vendor_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
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
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_ap_vendor_payments_company_id_idx
  on public.erp_ap_vendor_payments (company_id);

create index if not exists erp_ap_vendor_payments_company_vendor_idx
  on public.erp_ap_vendor_payments (company_id, vendor_id);

create index if not exists erp_ap_vendor_payments_company_payment_date_idx
  on public.erp_ap_vendor_payments (company_id, payment_date);

alter table public.erp_ap_vendor_payments enable row level security;
alter table public.erp_ap_vendor_payments force row level security;

do $$
begin
  drop policy if exists erp_ap_vendor_payments_select on public.erp_ap_vendor_payments;
  create policy erp_ap_vendor_payments_select
    on public.erp_ap_vendor_payments
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create or replace function public.erp_ap_vendor_payment_upsert(
  p_id uuid default null,
  p_vendor_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency text default 'INR',
  p_mode text default 'bank',
  p_reference_no text default null,
  p_note text default null,
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
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
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
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_company_id,
      p_vendor_id,
      p_payment_date,
      p_amount,
      coalesce(p_currency, 'INR'),
      coalesce(p_mode, 'bank'),
      p_reference_no,
      p_note,
      coalesce(p_source, 'manual'),
      p_source_ref,
      now(),
      v_actor,
      now(),
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_ap_vendor_payments
    set
      vendor_id = p_vendor_id,
      payment_date = p_payment_date,
      amount = p_amount,
      currency = coalesce(p_currency, 'INR'),
      mode = coalesce(p_mode, 'bank'),
      reference_no = p_reference_no,
      note = p_note,
      source = coalesce(p_source, 'manual'),
      source_ref = p_source_ref,
      updated_at = now(),
      updated_by = v_actor
    where id = p_id
      and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      insert into public.erp_ap_vendor_payments (
        id,
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
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        p_id,
        v_company_id,
        p_vendor_id,
        p_payment_date,
        p_amount,
        coalesce(p_currency, 'INR'),
        coalesce(p_mode, 'bank'),
        p_reference_no,
        p_note,
        coalesce(p_source, 'manual'),
        p_source_ref,
        now(),
        v_actor,
        now(),
        v_actor
      )
      returning id into v_id;
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.erp_ap_vendor_payment_void(
  p_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_updated boolean := false;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  update public.erp_ap_vendor_payments
  set
    is_void = true,
    void_reason = p_reason,
    voided_at = now(),
    voided_by = v_actor,
    updated_at = now(),
    updated_by = v_actor
  where id = p_id
    and company_id = v_company_id
    and is_void = false;

  get diagnostics v_updated = row_count > 0;

  return v_updated;
end;
$$;

create or replace function public.erp_ap_vendor_outstanding(
  p_as_of date,
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with invoice_totals as (
    select
      i.vendor_id,
      sum(l.line_total) as invoice_total
    from public.erp_gst_purchase_invoices i
    join public.erp_gst_purchase_invoice_lines l
      on l.invoice_id = i.id
     and l.company_id = i.company_id
     and l.is_void = false
    where i.company_id = public.erp_current_company_id()
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    group by i.vendor_id
  ),
  payment_totals as (
    select
      p.vendor_id,
      sum(p.amount) as payment_total
    from public.erp_ap_vendor_payments p
    where p.company_id = public.erp_current_company_id()
      and p.is_void = false
      and p.payment_date <= p_as_of
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
    group by p.vendor_id
  ),
  vendor_ids as (
    select vendor_id from invoice_totals
    union
    select vendor_id from payment_totals
  )
  select
    v_id.vendor_id as vendor_id,
    v.legal_name as vendor_name,
    coalesce(it.invoice_total, 0) as invoice_total,
    coalesce(pt.payment_total, 0) as payment_total,
    coalesce(it.invoice_total, 0) - coalesce(pt.payment_total, 0) as outstanding_total
  from vendor_ids v_id
  join public.erp_vendors v
    on v.id = v_id.vendor_id
   and v.company_id = public.erp_current_company_id()
  left join invoice_totals it on it.vendor_id = v_id.vendor_id
  left join payment_totals pt on pt.vendor_id = v_id.vendor_id
  order by v.legal_name;
end;
$$;

create or replace function public.erp_ap_vendor_aging(
  p_as_of date,
  p_vendor_id uuid default null
) returns table (
  vendor_id uuid,
  bucket_0_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  outstanding_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with invoice_totals as (
    select
      i.vendor_id,
      i.id as invoice_id,
      i.invoice_date,
      sum(l.line_total) as invoice_total
    from public.erp_gst_purchase_invoices i
    join public.erp_gst_purchase_invoice_lines l
      on l.invoice_id = i.id
     and l.company_id = i.company_id
     and l.is_void = false
    where i.company_id = public.erp_current_company_id()
      and i.is_void = false
      and i.invoice_date <= p_as_of
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    group by i.vendor_id, i.id, i.invoice_date
  ),
  payment_totals as (
    select
      p.vendor_id,
      sum(p.amount) as payment_total
    from public.erp_ap_vendor_payments p
    where p.company_id = public.erp_current_company_id()
      and p.is_void = false
      and p.payment_date <= p_as_of
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
    group by p.vendor_id
  ),
  invoice_ordered as (
    select
      it.vendor_id,
      it.invoice_id,
      it.invoice_date,
      it.invoice_total,
      sum(it.invoice_total) over (
        partition by it.vendor_id
        order by it.invoice_date, it.invoice_id
        rows between unbounded preceding and current row
      ) as cumulative_total,
      coalesce(pt.payment_total, 0) as payment_total
    from invoice_totals it
    left join payment_totals pt on pt.vendor_id = it.vendor_id
  ),
  invoice_outstanding as (
    select
      io.vendor_id,
      io.invoice_id,
      io.invoice_date,
      greatest(
        0,
        io.invoice_total - least(
          io.invoice_total,
          greatest(0, io.payment_total - (io.cumulative_total - io.invoice_total))
        )
      ) as outstanding_amount
    from invoice_ordered io
  )
  select
    io.vendor_id,
    sum(case when (p_as_of - io.invoice_date) between 0 and 30 then io.outstanding_amount else 0 end) as bucket_0_30,
    sum(case when (p_as_of - io.invoice_date) between 31 and 60 then io.outstanding_amount else 0 end) as bucket_31_60,
    sum(case when (p_as_of - io.invoice_date) between 61 and 90 then io.outstanding_amount else 0 end) as bucket_61_90,
    sum(case when (p_as_of - io.invoice_date) > 90 then io.outstanding_amount else 0 end) as bucket_90_plus,
    sum(io.outstanding_amount) as outstanding_total
  from invoice_outstanding io
  group by io.vendor_id;
end;
$$;

create or replace function public.erp_ap_vendor_outstanding_export(
  p_as_of date
) returns table (
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    o.vendor_id,
    o.vendor_name,
    o.invoice_total,
    o.payment_total,
    o.outstanding_total
  from public.erp_ap_vendor_outstanding(p_as_of, null) o;
end;
$$;

create or replace function public.erp_ap_vendor_ledger_export(
  p_from date,
  p_to date,
  p_vendor_id uuid default null
) returns table (
  date date,
  type text,
  vendor_name text,
  reference text,
  amount numeric,
  note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with invoice_totals as (
    select
      i.id as invoice_id,
      i.vendor_id,
      i.invoice_date,
      i.invoice_no,
      i.note,
      sum(l.line_total) as invoice_total
    from public.erp_gst_purchase_invoices i
    join public.erp_gst_purchase_invoice_lines l
      on l.invoice_id = i.id
     and l.company_id = i.company_id
     and l.is_void = false
    where i.company_id = public.erp_current_company_id()
      and i.is_void = false
      and i.invoice_date between p_from and p_to
      and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    group by i.id, i.vendor_id, i.invoice_date, i.invoice_no, i.note
  ),
  payments as (
    select
      p.vendor_id,
      p.payment_date,
      p.reference_no,
      p.source_ref,
      p.amount,
      p.note
    from public.erp_ap_vendor_payments p
    where p.company_id = public.erp_current_company_id()
      and p.is_void = false
      and p.payment_date between p_from and p_to
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)
  )
  select
    it.invoice_date as date,
    'invoice'::text as type,
    v.legal_name as vendor_name,
    it.invoice_no as reference,
    it.invoice_total as amount,
    it.note as note
  from invoice_totals it
  join public.erp_vendors v
    on v.id = it.vendor_id
   and v.company_id = public.erp_current_company_id()

  union all

  select
    p.payment_date as date,
    'payment'::text as type,
    v.legal_name as vendor_name,
    coalesce(p.reference_no, p.source_ref) as reference,
    p.amount as amount,
    p.note as note
  from payments p
  join public.erp_vendors v
    on v.id = p.vendor_id
   and v.company_id = public.erp_current_company_id()

  order by date, vendor_name, type;
end;
$$;

revoke all on function public.erp_ap_vendor_payment_upsert(uuid, uuid, date, numeric, text, text, text, text, text, text) from public;
revoke all on function public.erp_ap_vendor_payment_upsert(uuid, uuid, date, numeric, text, text, text, text, text, text) from authenticated;
grant execute on function public.erp_ap_vendor_payment_upsert(uuid, uuid, date, numeric, text, text, text, text, text, text) to authenticated;

revoke all on function public.erp_ap_vendor_payment_void(uuid, text) from public;
revoke all on function public.erp_ap_vendor_payment_void(uuid, text) from authenticated;
grant execute on function public.erp_ap_vendor_payment_void(uuid, text) to authenticated;

revoke all on function public.erp_ap_vendor_outstanding(date, uuid) from public;
revoke all on function public.erp_ap_vendor_outstanding(date, uuid) from authenticated;
grant execute on function public.erp_ap_vendor_outstanding(date, uuid) to authenticated;

revoke all on function public.erp_ap_vendor_aging(date, uuid) from public;
revoke all on function public.erp_ap_vendor_aging(date, uuid) from authenticated;
grant execute on function public.erp_ap_vendor_aging(date, uuid) to authenticated;

revoke all on function public.erp_ap_vendor_outstanding_export(date) from public;
revoke all on function public.erp_ap_vendor_outstanding_export(date) from authenticated;
grant execute on function public.erp_ap_vendor_outstanding_export(date) to authenticated;

revoke all on function public.erp_ap_vendor_ledger_export(date, date, uuid) from public;
revoke all on function public.erp_ap_vendor_ledger_export(date, date, uuid) from authenticated;
grant execute on function public.erp_ap_vendor_ledger_export(date, date, uuid) to authenticated;
