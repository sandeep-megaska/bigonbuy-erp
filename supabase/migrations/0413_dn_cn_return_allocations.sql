-- 0413_dn_cn_return_allocations.sql
-- DN/CN from inventory returns + generic finance allocations

alter table public.erp_return_receipts
  add column if not exists party_type text null,
  add column if not exists party_id uuid null,
  add column if not exists party_name text null;

alter table public.erp_return_receipts
  drop constraint if exists erp_return_receipts_party_type_check;

alter table public.erp_return_receipts
  add constraint erp_return_receipts_party_type_check
  check (party_type is null or party_type in ('vendor','customer'));

alter table public.erp_notes
  add column if not exists source_type text null,
  add column if not exists source_id uuid null;

create index if not exists erp_notes_company_source_idx
  on public.erp_notes (company_id, source_type, source_id);

create index if not exists erp_notes_company_party_status_idx
  on public.erp_notes (company_id, party_type, party_id, status);

alter table public.erp_notes
  drop constraint if exists erp_notes_source_type_check;

alter table public.erp_notes
  add constraint erp_notes_source_type_check
  check (
    source_type is null
    or source_type in ('inventory_return_receipt', 'sales_return_receipt')
  );

create table if not exists public.erp_fin_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  alloc_date date not null default current_date,
  from_entity_type text not null,
  from_entity_id uuid not null,
  to_entity_type text not null,
  to_entity_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  comment text null,
  status text not null default 'active' check (status in ('active','void')),
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  voided_at timestamptz null,
  voided_by uuid null,
  void_reason text null
);

create index if not exists erp_fin_allocations_company_from_idx
  on public.erp_fin_allocations (company_id, from_entity_type, from_entity_id);
create index if not exists erp_fin_allocations_company_to_idx
  on public.erp_fin_allocations (company_id, to_entity_type, to_entity_id);
create index if not exists erp_fin_allocations_company_date_idx
  on public.erp_fin_allocations (company_id, alloc_date);

alter table public.erp_fin_allocations enable row level security;
alter table public.erp_fin_allocations force row level security;

do $$
begin
  drop policy if exists erp_fin_allocations_select on public.erp_fin_allocations;
  drop policy if exists erp_fin_allocations_write on public.erp_fin_allocations;

  create policy erp_fin_allocations_select
    on public.erp_fin_allocations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_fin_allocations_write
    on public.erp_fin_allocations
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        )
      )
    )
    with check (company_id = public.erp_current_company_id());
end $$;

create or replace function public.erp_note_create_from_return_receipt(
  p_company_id uuid,
  p_return_receipt_id uuid,
  p_party_type text,
  p_note_kind text,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt record;
  v_note_id uuid;
  v_party_type text := lower(trim(p_party_type));
  v_note_kind text := lower(trim(p_note_kind));
  v_party_id uuid;
  v_party_name text;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'Invalid company context';
  end if;

  if v_party_type not in ('vendor','customer') then
    raise exception 'Invalid party type';
  end if;

  if v_note_kind not in ('debit','credit') then
    raise exception 'Invalid note kind';
  end if;

  select r.* into v_receipt
  from public.erp_return_receipts r
  where r.id = p_return_receipt_id
    and r.company_id = p_company_id;

  if v_receipt.id is null then
    raise exception 'Return receipt not found';
  end if;

  v_party_id := v_receipt.party_id;
  v_party_name := nullif(trim(coalesce(v_receipt.party_name, '')), '');

  if (v_party_type = 'vendor' and v_note_kind <> 'debit') or (v_party_type = 'customer' and v_note_kind <> 'credit') then
    raise exception 'Unsupported note kind for party type';
  end if;

  if v_party_name is null then
    raise exception 'Return receipt party details are required before creating note';
  end if;

  select n.id into v_note_id
  from public.erp_notes n
  where n.company_id = p_company_id
    and n.source_type = 'inventory_return_receipt'
    and n.source_id = p_return_receipt_id
    and n.party_type = v_party_type
    and n.note_kind = v_note_kind
  order by n.created_at desc
  limit 1;

  if v_note_id is not null then
    return v_note_id;
  end if;

  insert into public.erp_notes (
    company_id, party_type, note_kind, status, note_date, party_id, party_name, currency,
    source_type, source_id, notes
  ) values (
    p_company_id, v_party_type, v_note_kind, 'draft', coalesce(v_receipt.receipt_date,current_date),
    v_party_id, v_party_name, 'INR', 'inventory_return_receipt', p_return_receipt_id,
    coalesce(p_reason, v_receipt.notes)
  ) returning id into v_note_id;

  insert into public.erp_note_lines (
    note_id, line_no, item_type, variant_id, sku, title, hsn, qty, unit_rate, tax_rate,
    line_subtotal, line_tax, line_total
  )
  select
    v_note_id,
    row_number() over (order by l.created_at, l.id),
    'variant',
    l.variant_id,
    vr.sku,
    pr.title,
    pr.hsn_code,
    l.qty,
    0,
    0,
    0,
    0,
    0
  from public.erp_return_receipt_lines l
  left join public.erp_variants vr on vr.id = l.variant_id
  left join public.erp_products pr on pr.id = vr.product_id
  where l.company_id = p_company_id
    and l.receipt_id = p_return_receipt_id;

  return v_note_id;
end;
$$;

revoke all on function public.erp_note_create_from_return_receipt(uuid, uuid, text, text, text) from public;
grant execute on function public.erp_note_create_from_return_receipt(uuid, uuid, text, text, text) to authenticated;

create or replace function public.erp_fin_allocations_create(
  p_company_id uuid,
  p_from_entity_type text,
  p_from_entity_id uuid,
  p_to_entity_type text,
  p_to_entity_id uuid,
  p_amount numeric,
  p_comment text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_from_type text := lower(trim(p_from_entity_type));
  v_to_type text := lower(trim(p_to_entity_type));
  v_id uuid;
  v_from_party uuid;
  v_to_party uuid;
  v_available numeric := 0;
  v_outstanding numeric := 0;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company context';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Allocation amount must be > 0';
  end if;

  if v_to_type = 'vendor_bill' then
    select i.vendor_id,
      greatest(
        coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax)
        - coalesce((select sum(a.allocated_amount) from public.erp_ap_vendor_payment_allocations a where a.company_id=v_company_id and a.invoice_id=i.id and a.is_void=false),0)
        - coalesce((select sum(a.allocated_amount) from public.erp_ap_vendor_bill_advance_allocations a where a.company_id=v_company_id and a.bill_id=i.id and a.is_void=false),0)
        - coalesce((select sum(a.amount) from public.erp_fin_allocations a where a.company_id=v_company_id and a.to_entity_type='vendor_bill' and a.to_entity_id=i.id and a.status='active'),0),
      0)
    into v_to_party, v_outstanding
    from public.erp_gst_purchase_invoices i
    where i.company_id=v_company_id and i.id=p_to_entity_id and i.is_void=false;
  elsif v_to_type = 'customer_invoice' then
    select i.customer_id,
      greatest(
        coalesce(i.total,0)
        - coalesce((select sum(a.amount) from public.erp_fin_allocations a where a.company_id=v_company_id and a.to_entity_type='customer_invoice' and a.to_entity_id=i.id and a.status='active'),0),
      0)
    into v_to_party, v_outstanding
    from public.erp_invoices i
    where i.company_id=v_company_id and i.id=p_to_entity_id and i.status in ('issued');
  else
    raise exception 'Unsupported target type';
  end if;

  if v_to_party is null then
    raise exception 'Target document not found';
  end if;

  if v_from_type = 'vendor_note' then
    select n.party_id,
      greatest(n.total - coalesce((select sum(a.amount) from public.erp_fin_allocations a where a.company_id=v_company_id and a.from_entity_type='vendor_note' and a.from_entity_id=n.id and a.status='active'),0),0)
    into v_from_party, v_available
    from public.erp_notes n
    where n.company_id=v_company_id and n.id=p_from_entity_id and n.party_type='vendor' and n.note_kind='debit' and n.status='approved';
  elsif v_from_type = 'customer_note' then
    select n.party_id,
      greatest(n.total - coalesce((select sum(a.amount) from public.erp_fin_allocations a where a.company_id=v_company_id and a.from_entity_type='customer_note' and a.from_entity_id=n.id and a.status='active'),0),0)
    into v_from_party, v_available
    from public.erp_notes n
    where n.company_id=v_company_id and n.id=p_from_entity_id and n.party_type='customer' and n.note_kind='credit' and n.status='approved';
  elsif v_from_type = 'vendor_advance' then
    select a.vendor_id,
      greatest(a.amount - coalesce((select sum(x.amount) from public.erp_fin_allocations x where x.company_id=v_company_id and x.from_entity_type='vendor_advance' and x.from_entity_id=a.id and x.status='active'),0),0)
    into v_from_party, v_available
    from public.erp_ap_vendor_advances a
    where a.company_id=v_company_id and a.id=p_from_entity_id and a.status='approved' and a.is_void=false;
  else
    raise exception 'Unsupported source type';
  end if;

  if v_from_party is distinct from v_to_party then
    raise exception 'Party mismatch between source and target';
  end if;

  if p_amount > v_available then
    raise exception 'Allocation exceeds available credit';
  end if;

  if p_amount > v_outstanding then
    raise exception 'Allocation exceeds target outstanding';
  end if;

  insert into public.erp_fin_allocations(
    company_id, alloc_date, from_entity_type, from_entity_id, to_entity_type, to_entity_id, amount, comment, status
  ) values (
    v_company_id, current_date, v_from_type, p_from_entity_id, v_to_type, p_to_entity_id, p_amount, p_comment, 'active'
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_fin_allocations_create(uuid, text, uuid, text, uuid, numeric, text) from public;
grant execute on function public.erp_fin_allocations_create(uuid, text, uuid, text, uuid, numeric, text) to authenticated;

create or replace function public.erp_fin_allocations_list(
  p_company_id uuid,
  p_to_entity_type text default null,
  p_to_entity_id uuid default null,
  p_from_entity_type text default null,
  p_from_entity_id uuid default null
) returns table (
  allocation_id uuid,
  alloc_date date,
  from_entity_type text,
  from_entity_id uuid,
  to_entity_type text,
  to_entity_id uuid,
  amount numeric,
  status text,
  comment text,
  created_at timestamptz,
  voided_at timestamptz,
  void_reason text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.alloc_date,
    a.from_entity_type,
    a.from_entity_id,
    a.to_entity_type,
    a.to_entity_id,
    a.amount,
    a.status,
    a.comment,
    a.created_at,
    a.voided_at,
    a.void_reason
  from public.erp_fin_allocations a
  where a.company_id = public.erp_current_company_id()
    and p_company_id = public.erp_current_company_id()
    and (p_to_entity_type is null or a.to_entity_type = p_to_entity_type)
    and (p_to_entity_id is null or a.to_entity_id = p_to_entity_id)
    and (p_from_entity_type is null or a.from_entity_type = p_from_entity_type)
    and (p_from_entity_id is null or a.from_entity_id = p_from_entity_id)
  order by a.alloc_date desc, a.created_at desc;
$$;

revoke all on function public.erp_fin_allocations_list(uuid, text, uuid, text, uuid) from public;
grant execute on function public.erp_fin_allocations_list(uuid, text, uuid, text, uuid) to authenticated;

create or replace function public.erp_fin_allocations_void(
  p_company_id uuid,
  p_allocation_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'Invalid company context';
  end if;

  update public.erp_fin_allocations
  set status='void', voided_at=now(), voided_by=auth.uid(), void_reason=p_reason
  where company_id = p_company_id
    and id = p_allocation_id
    and status = 'active';

  if not found then
    raise exception 'Allocation not found or already void';
  end if;
end;
$$;

revoke all on function public.erp_fin_allocations_void(uuid, uuid, text) from public;
grant execute on function public.erp_fin_allocations_void(uuid, uuid, text) to authenticated;

create or replace function public.erp_ap_credits_unallocated_list(
  p_vendor_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  credit_id uuid,
  vendor_id uuid,
  vendor_name text,
  credit_date date,
  credit_amount numeric,
  allocated_total numeric,
  unallocated_amount numeric,
  currency text,
  reference_no text,
  note text,
  source text
)
language sql
security definer
set search_path = public
as $$
  with credits as (
    select p.id as credit_id, p.vendor_id, v.legal_name as vendor_name, p.payment_date as credit_date,
      p.amount as credit_amount, coalesce(p.currency, 'INR') as currency,
      p.reference_no, p.note, 'vendor_payment'::text as source
    from public.erp_ap_vendor_payments p
    left join public.erp_vendors v on v.id = p.vendor_id and v.company_id = p.company_id
    where p.company_id = public.erp_current_company_id()
      and p.status = 'approved'
      and p.is_void = false
      and (p_from is null or p.payment_date >= p_from)
      and (p_to is null or p.payment_date <= p_to)
      and (p_vendor_id is null or p.vendor_id = p_vendor_id)

    union all

    select a.id as credit_id, a.vendor_id, v.legal_name as vendor_name, a.advance_date as credit_date,
      a.amount as credit_amount, coalesce(a.currency, 'INR') as currency,
      a.reference as reference_no, a.notes as note, 'vendor_advance'::text as source
    from public.erp_ap_vendor_advances a
    left join public.erp_vendors v on v.id = a.vendor_id and v.company_id = a.company_id
    where a.company_id = public.erp_current_company_id()
      and a.status = 'approved'
      and a.is_void = false
      and (p_from is null or a.advance_date >= p_from)
      and (p_to is null or a.advance_date <= p_to)
      and (p_vendor_id is null or a.vendor_id = p_vendor_id)

    union all

    select n.id as credit_id, n.party_id as vendor_id, n.party_name as vendor_name, n.note_date as credit_date,
      n.total as credit_amount, coalesce(n.currency, 'INR') as currency,
      n.note_no as reference_no, n.notes as note, 'vendor_note'::text as source
    from public.erp_notes n
    where n.company_id = public.erp_current_company_id()
      and n.party_type = 'vendor'
      and n.note_kind = 'debit'
      and n.status = 'approved'
      and (p_from is null or n.note_date >= p_from)
      and (p_to is null or n.note_date <= p_to)
      and (p_vendor_id is null or n.party_id = p_vendor_id)
  ), alloc as (
    select a.from_entity_type, a.from_entity_id, sum(a.amount) as allocated_total
    from public.erp_fin_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.status = 'active'
    group by a.from_entity_type, a.from_entity_id
  )
  select c.credit_id, c.vendor_id, c.vendor_name, c.credit_date, c.credit_amount,
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(c.credit_amount - coalesce(a.allocated_total, 0), 0) as unallocated_amount,
    c.currency, c.reference_no, c.note, c.source
  from credits c
  left join alloc a on a.from_entity_type = c.source and a.from_entity_id = c.credit_id
  where (
    p_q is null or btrim(p_q) = ''
    or coalesce(c.reference_no, '') ilike ('%' || p_q || '%')
    or coalesce(c.note, '') ilike ('%' || p_q || '%')
    or coalesce(c.vendor_name, '') ilike ('%' || p_q || '%')
  )
  order by c.credit_date desc, c.credit_id desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.erp_ap_credits_unallocated_list(uuid, date, date, text, int, int) to authenticated;

create or replace function public.erp_ar_invoices_outstanding_list(
  p_customer_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  invoice_id uuid,
  customer_id uuid,
  customer_name text,
  doc_no text,
  invoice_date date,
  invoice_total numeric,
  allocated_total numeric,
  outstanding_amount numeric,
  currency text,
  status text
)
language sql
security definer
set search_path = public
as $$
  with alloc as (
    select a.to_entity_id as invoice_id, sum(a.amount) as allocated_total
    from public.erp_fin_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.to_entity_type = 'customer_invoice'
      and a.status = 'active'
    group by a.to_entity_id
  )
  select i.id, i.customer_id, i.customer_name, i.doc_no, i.invoice_date,
    i.total as invoice_total,
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(i.total - coalesce(a.allocated_total, 0), 0) as outstanding_amount,
    coalesce(i.currency, 'INR') as currency,
    i.status
  from public.erp_invoices i
  left join alloc a on a.invoice_id = i.id
  where i.company_id = public.erp_current_company_id()
    and i.status = 'issued'
    and (p_customer_id is null or i.customer_id = p_customer_id)
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
    and (
      p_q is null or btrim(p_q) = ''
      or coalesce(i.doc_no, '') ilike ('%' || p_q || '%')
      or coalesce(i.customer_name, '') ilike ('%' || p_q || '%')
    )
  order by i.invoice_date desc, i.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.erp_ar_invoices_outstanding_list(uuid, date, date, text, int, int) to authenticated;

create or replace function public.erp_ar_credits_unallocated_list(
  p_customer_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  credit_id uuid,
  customer_id uuid,
  customer_name text,
  credit_date date,
  credit_amount numeric,
  allocated_total numeric,
  unallocated_amount numeric,
  currency text,
  reference_no text,
  note text,
  source text
)
language sql
security definer
set search_path = public
as $$
  with credits as (
    select n.id as credit_id, n.party_id as customer_id, n.party_name as customer_name,
      n.note_date as credit_date, n.total as credit_amount, coalesce(n.currency, 'INR') as currency,
      n.note_no as reference_no, n.notes as note, 'customer_note'::text as source
    from public.erp_notes n
    where n.company_id = public.erp_current_company_id()
      and n.party_type = 'customer'
      and n.note_kind = 'credit'
      and n.status = 'approved'
      and (p_from is null or n.note_date >= p_from)
      and (p_to is null or n.note_date <= p_to)
      and (p_customer_id is null or n.party_id = p_customer_id)
  ), alloc as (
    select a.from_entity_id as credit_id, sum(a.amount) as allocated_total
    from public.erp_fin_allocations a
    where a.company_id = public.erp_current_company_id()
      and a.from_entity_type = 'customer_note'
      and a.status = 'active'
    group by a.from_entity_id
  )
  select c.credit_id, c.customer_id, c.customer_name, c.credit_date, c.credit_amount,
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(c.credit_amount - coalesce(a.allocated_total, 0), 0) as unallocated_amount,
    c.currency, c.reference_no, c.note, c.source
  from credits c
  left join alloc a on a.credit_id = c.credit_id
  where (
    p_q is null or btrim(p_q) = ''
    or coalesce(c.reference_no, '') ilike ('%' || p_q || '%')
    or coalesce(c.note, '') ilike ('%' || p_q || '%')
    or coalesce(c.customer_name, '') ilike ('%' || p_q || '%')
  )
  order by c.credit_date desc, c.credit_id desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.erp_ar_credits_unallocated_list(uuid, date, date, text, int, int) to authenticated;
