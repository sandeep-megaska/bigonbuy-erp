-- Global ERP document numbering with FY sequences

create table if not exists public.erp_document_sequences (
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  financial_year text not null,
  doc_type text not null,
  last_sequence int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, financial_year, doc_type)
);

alter table public.erp_document_sequences enable row level security;
alter table public.erp_document_sequences force row level security;

do $$
begin
  drop policy if exists erp_document_sequences_select on public.erp_document_sequences;
  drop policy if exists erp_document_sequences_write on public.erp_document_sequences;

  create policy erp_document_sequences_select
    on public.erp_document_sequences
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
        )
      )
    );

  create policy erp_document_sequences_write
    on public.erp_document_sequences
    for all
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
            and cu.role_key in ('owner', 'admin', 'finance', 'procurement', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
    );
end;
$$;

create or replace function public.erp_financial_year_label(p_date date default current_date)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from p_date)::int;
  v_month int := extract(month from p_date)::int;
  v_start_year int;
  v_end_year int;
begin
  if v_month >= 4 then
    v_start_year := v_year;
  else
    v_start_year := v_year - 1;
  end if;

  v_end_year := v_start_year + 1;

  return format('%s-%s', v_start_year, lpad((v_end_year % 100)::text, 2, '0'));
end;
$$;

create or replace function public.erp_next_document_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_type text := upper(trim(p_doc_type));
  v_financial_year text := public.erp_financial_year_label(current_date);
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_doc_type not in ('PO', 'GRN', 'CINV', 'VINV', 'CN', 'DN') then
    raise exception 'Invalid document type';
  end if;

  insert into public.erp_document_sequences (company_id, financial_year, doc_type, last_sequence)
  values (v_company_id, v_financial_year, v_doc_type, 0)
  on conflict (company_id, financial_year, doc_type) do nothing;

  select last_sequence
    into v_seq
    from public.erp_document_sequences
    where company_id = v_company_id
      and financial_year = v_financial_year
      and doc_type = v_doc_type
    for update;

  update public.erp_document_sequences
  set last_sequence = last_sequence + 1,
      updated_at = now()
  where company_id = v_company_id
    and financial_year = v_financial_year
    and doc_type = v_doc_type
  returning last_sequence into v_seq;

  return format('%s/%s/%s', v_financial_year, v_doc_type, lpad(v_seq::text, 5, '0'));
end;
$$;

revoke all on function public.erp_next_document_number(text) from public;
grant execute on function public.erp_next_document_number(text) to authenticated;

alter table public.erp_notes
  add column if not exists reference_invoice_number text null,
  add column if not exists reference_invoice_date date null,
  add column if not exists reason text null,
  add column if not exists place_of_supply text null;

alter table public.erp_grns
  alter column grn_no drop default,
  alter column grn_no drop not null;

create or replace function public.erp_note_allocate_number(p_note_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_no text;
  v_note_kind text;
  v_note_date date;
  v_doc_type text;
  v_seq int;
  v_fy text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select doc_no, note_kind, note_date
    into v_doc_no, v_note_kind, v_note_date
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_doc_no is not null then
    return v_doc_no;
  end if;

  v_doc_type := case v_note_kind
    when 'credit' then 'CN'
    when 'debit' then 'DN'
    else 'NT'
  end;

  v_doc_no := public.erp_next_document_number(v_doc_type);
  v_seq := nullif(right(v_doc_no, 5), '')::int;
  v_fy := split_part(v_doc_no, '/', 1);

  update public.erp_notes
  set
    doc_no = v_doc_no,
    note_number = coalesce(note_number, v_doc_no),
    note_no = coalesce(note_no, v_doc_no),
    note_number_seq = coalesce(note_number_seq, v_seq),
    fiscal_year = coalesce(fiscal_year, v_fy),
    updated_at = now()
  where id = p_note_id
    and doc_no is null;

  select doc_no
    into v_doc_no
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id;

  return v_doc_no;
end;
$$;

revoke all on function public.erp_note_allocate_number(uuid) from public;
grant execute on function public.erp_note_allocate_number(uuid) to authenticated;

create or replace function public.erp_note_upsert(p_note jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_note_id uuid;
  v_party_type text := nullif(p_note->>'party_type', '');
  v_note_kind text := nullif(p_note->>'note_kind', '');
  v_note_date date := coalesce(nullif(p_note->>'note_date', '')::date, current_date);
  v_party_id uuid := nullif(p_note->>'party_id', '')::uuid;
  v_party_name text := nullif(p_note->>'party_name', '');
  v_currency text := coalesce(nullif(p_note->>'currency', ''), 'INR');
  v_source_type text := nullif(p_note->>'source_type', '');
  v_source_id uuid := nullif(p_note->>'source_id', '')::uuid;
  v_reference_invoice_number text := nullif(p_note->>'reference_invoice_number', '');
  v_reference_invoice_date date := nullif(p_note->>'reference_invoice_date', '')::date;
  v_reason text := nullif(p_note->>'reason', '');
  v_place_of_supply text := nullif(p_note->>'place_of_supply', '');
  v_status text;
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_party_type not in ('customer', 'vendor') then
    raise exception 'Invalid party_type';
  end if;

  if v_note_kind not in ('credit', 'debit') then
    raise exception 'Invalid note_kind';
  end if;

  if v_party_name is null then
    raise exception 'Party name is required';
  end if;

  if v_reference_invoice_number is null then
    raise exception 'Reference invoice number is required';
  end if;

  if v_reference_invoice_date is null then
    raise exception 'Reference invoice date is required';
  end if;

  if v_reason is null then
    raise exception 'Reason is required';
  end if;

  if v_place_of_supply is null then
    raise exception 'Place of supply is required';
  end if;

  if v_party_type = 'vendor' then
    if v_party_id is null then
      raise exception 'Vendor is required';
    end if;

    if not exists (
      select 1
      from public.erp_vendors v
      where v.id = v_party_id
        and v.company_id = v_company_id
    ) then
      raise exception 'Invalid vendor';
    end if;
  end if;

  if (p_note ? 'id') and nullif(p_note->>'id', '') is not null then
    v_note_id := (p_note->>'id')::uuid;

    select status
      into v_status
      from public.erp_notes
      where id = v_note_id
        and company_id = v_company_id
      for update;

    if not found then
      raise exception 'Note not found';
    end if;

    if v_status <> 'draft' then
      raise exception 'Only draft notes can be edited';
    end if;

    update public.erp_notes
    set
      party_type = v_party_type,
      note_kind = v_note_kind,
      note_date = v_note_date,
      party_id = v_party_id,
      party_name = v_party_name,
      currency = v_currency,
      source_type = v_source_type,
      source_id = v_source_id,
      reference_invoice_number = v_reference_invoice_number,
      reference_invoice_date = v_reference_invoice_date,
      reason = v_reason,
      place_of_supply = v_place_of_supply,
      updated_at = now()
    where id = v_note_id;

    delete from public.erp_note_lines where note_id = v_note_id;
  else
    insert into public.erp_notes (
      company_id,
      party_type,
      note_kind,
      status,
      note_date,
      party_id,
      party_name,
      currency,
      source_type,
      source_id,
      reference_invoice_number,
      reference_invoice_date,
      reason,
      place_of_supply,
      created_by,
      updated_at
    )
    values (
      v_company_id,
      v_party_type,
      v_note_kind,
      'draft',
      v_note_date,
      v_party_id,
      v_party_name,
      v_currency,
      v_source_type,
      v_source_id,
      v_reference_invoice_number,
      v_reference_invoice_date,
      v_reason,
      v_place_of_supply,
      auth.uid(),
      now()
    )
    returning id into v_note_id;
  end if;

  insert into public.erp_note_lines (
    note_id,
    line_no,
    item_type,
    variant_id,
    sku,
    title,
    hsn,
    qty,
    unit_rate,
    tax_rate,
    line_subtotal,
    line_tax,
    line_total
  )
  select
    v_note_id,
    line_no,
    coalesce(nullif(item_type, ''), 'manual'),
    variant_id,
    sku,
    title,
    hsn,
    qty,
    unit_rate,
    tax_rate,
    round(qty * unit_rate, 2),
    round(qty * unit_rate * tax_rate / 100, 2),
    round(qty * unit_rate * (1 + tax_rate / 100), 2)
  from (
    select
      (value->>'item_type')::text as item_type,
      nullif(value->>'variant_id', '')::uuid as variant_id,
      nullif(value->>'sku', '')::text as sku,
      nullif(value->>'title', '')::text as title,
      nullif(value->>'hsn', '')::text as hsn,
      coalesce(nullif(value->>'qty', '')::numeric, 0) as qty,
      coalesce(nullif(value->>'unit_rate', '')::numeric, 0) as unit_rate,
      coalesce(nullif(value->>'tax_rate', '')::numeric, 0) as tax_rate,
      ordinality as line_no
    from jsonb_array_elements(coalesce(p_note->'lines', '[]'::jsonb)) with ordinality
  ) as lines;

  select
    coalesce(sum(line_subtotal), 0),
    coalesce(sum(line_tax), 0),
    coalesce(sum(line_total), 0)
  into v_subtotal, v_tax_total, v_total
  from public.erp_note_lines
  where note_id = v_note_id;

  update public.erp_notes
  set
    subtotal = v_subtotal,
    tax_total = v_tax_total,
    total = v_total,
    updated_at = now()
  where id = v_note_id;

  return v_note_id;
end;
$$;

revoke all on function public.erp_note_upsert(jsonb) from public;
grant execute on function public.erp_note_upsert(jsonb) to authenticated;

create or replace function public.erp_note_get(p_note_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  perform public.erp_require_finance_reader();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select jsonb_build_object(
    'note', jsonb_build_object(
      'id', n.id,
      'doc_no', n.doc_no,
      'party_type', n.party_type,
      'note_kind', n.note_kind,
      'status', n.status,
      'note_date', n.note_date,
      'party_id', n.party_id,
      'party_name', n.party_name,
      'currency', n.currency,
      'subtotal', n.subtotal,
      'tax_total', n.tax_total,
      'total', n.total,
      'source_type', n.source_type,
      'source_id', n.source_id,
      'reference_invoice_number', n.reference_invoice_number,
      'reference_invoice_date', n.reference_invoice_date,
      'reason', n.reason,
      'place_of_supply', n.place_of_supply,
      'approved_at', n.approved_at,
      'approved_by', n.approved_by,
      'cancelled_at', n.cancelled_at,
      'cancelled_by', n.cancelled_by,
      'cancel_reason', n.cancel_reason,
      'created_at', n.created_at,
      'updated_at', n.updated_at
    ),
    'lines', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'line_no', l.line_no,
            'item_type', l.item_type,
            'variant_id', l.variant_id,
            'sku', l.sku,
            'title', l.title,
            'hsn', l.hsn,
            'qty', l.qty,
            'unit_rate', l.unit_rate,
            'tax_rate', l.tax_rate,
            'line_subtotal', l.line_subtotal,
            'line_tax', l.line_tax,
            'line_total', l.line_total
          )
          order by l.line_no
        )
        from public.erp_note_lines l
        where l.note_id = n.id
      ),
      '[]'::jsonb
    )
  )
  into v_payload
  from public.erp_notes n
  where n.id = p_note_id
    and n.company_id = v_company_id;

  return v_payload;
end;
$$;

revoke all on function public.erp_note_get(uuid) from public;
grant execute on function public.erp_note_get(uuid) to authenticated;

create or replace function public.erp_finance_note_pdf_payload(p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_payload jsonb;
begin
  perform public.erp_require_finance_reader();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select jsonb_build_object(
    'note', jsonb_build_object(
      'id', n.id,
      'doc_no', n.doc_no,
      'party_type', n.party_type,
      'note_kind', n.note_kind,
      'status', n.status,
      'note_date', n.note_date,
      'party_id', n.party_id,
      'party_name', n.party_name,
      'currency', n.currency,
      'subtotal', n.subtotal,
      'tax_total', n.tax_total,
      'total', n.total,
      'source_type', n.source_type,
      'source_id', n.source_id,
      'reference_invoice_number', n.reference_invoice_number,
      'reference_invoice_date', n.reference_invoice_date,
      'reason', n.reason,
      'place_of_supply', n.place_of_supply,
      'approved_at', n.approved_at,
      'approved_by', n.approved_by,
      'cancelled_at', n.cancelled_at,
      'cancelled_by', n.cancelled_by,
      'cancel_reason', n.cancel_reason,
      'created_at', n.created_at,
      'updated_at', n.updated_at
    ),
    'lines', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'line_no', l.line_no,
            'item_type', l.item_type,
            'variant_id', l.variant_id,
            'sku', l.sku,
            'title', l.title,
            'hsn', l.hsn,
            'qty', l.qty,
            'unit_rate', l.unit_rate,
            'tax_rate', l.tax_rate,
            'line_subtotal', l.line_subtotal,
            'line_tax', l.line_tax,
            'line_total', l.line_total
          )
          order by l.line_no
        )
        from public.erp_note_lines l
        where l.note_id = n.id
      ),
      '[]'::jsonb
    )
  )
  into v_payload
  from public.erp_notes n
  where n.id = p_note_id
    and n.company_id = v_company_id;

  return v_payload;
end;
$$;

revoke all on function public.erp_finance_note_pdf_payload(uuid) from public;
grant execute on function public.erp_finance_note_pdf_payload(uuid) to authenticated;

create or replace function public.erp_proc_po_approve(p_po_id uuid)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select company_id, status
    into v_company_id, v_status
  from public.erp_purchase_orders
  where id = p_po_id;

  if v_company_id is null then
    raise exception 'Purchase order not found';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'procurement')
  ) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'draft' then
    raise exception 'Purchase order is not in draft status';
  end if;

  update public.erp_purchase_orders
     set status = 'approved',
         doc_no = coalesce(doc_no, public.erp_next_document_number('PO')),
         updated_at = now()
   where id = p_po_id
     and company_id = v_company_id;

  return query
  select po.id, po.status
  from public.erp_purchase_orders po
  where po.id = p_po_id;
end;
$$;

revoke all on function public.erp_proc_po_approve(uuid) from public;
grant execute on function public.erp_proc_po_approve(uuid) to authenticated;

create or replace function public.erp_po_create_draft(
  p_vendor_id uuid,
  p_status text default 'draft',
  p_order_date date default current_date,
  p_expected_delivery_date date default null,
  p_notes text default null,
  p_deliver_to_warehouse_id uuid default null,
  p_rfq_id uuid default null,
  p_vendor_quote_id uuid default null,
  p_quote_ref_no text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_po_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = v_company_id
  ) then
    raise exception 'Vendor not found';
  end if;

  insert into public.erp_purchase_orders (
    company_id,
    vendor_id,
    status,
    order_date,
    expected_delivery_date,
    notes,
    deliver_to_warehouse_id,
    rfq_id,
    vendor_quote_id,
    quote_ref_no,
    doc_no
  )
  values (
    v_company_id,
    p_vendor_id,
    coalesce(nullif(p_status, ''), 'draft'),
    coalesce(p_order_date, current_date),
    p_expected_delivery_date,
    p_notes,
    p_deliver_to_warehouse_id,
    p_rfq_id,
    p_vendor_quote_id,
    p_quote_ref_no,
    null
  )
  returning id into v_po_id;

  return v_po_id;
end;
$$;

revoke all on function public.erp_po_create_draft(uuid, text, date, date, text, uuid, uuid, uuid, text) from public;
grant execute on function public.erp_po_create_draft(uuid, text, date, date, text, uuid, uuid, uuid, text) to authenticated;

create or replace function public.erp_po_create_from_reorder(
  p_vendor_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_po_id uuid;
  v_notes text;
  v_line_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items payload must be a JSON array';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = v_company_id
  ) then
    raise exception 'Vendor not found';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  v_notes := null;
  if p_reference is not null and trim(p_reference) <> '' then
    v_notes := 'Reference: ' || trim(p_reference);
  end if;
  if p_notes is not null and trim(p_notes) <> '' then
    if v_notes is null then
      v_notes := trim(p_notes);
    else
      v_notes := v_notes || E'\n' || trim(p_notes);
    end if;
  end if;

  insert into public.erp_purchase_orders (
    company_id,
    vendor_id,
    status,
    order_date,
    expected_delivery_date,
    notes,
    deliver_to_warehouse_id,
    doc_no
  )
  values (
    v_company_id,
    p_vendor_id,
    'draft',
    current_date,
    null,
    v_notes,
    p_warehouse_id,
    null
  )
  returning id into v_po_id;

  with input_rows as (
    select
      i.variant_id,
      greatest(coalesce(i.qty, 0), 0) as qty
    from jsonb_to_recordset(p_items) as i(
      variant_id uuid,
      qty int
    )
  ),
  filtered as (
    select i.variant_id, i.qty
    from input_rows i
    join public.erp_variants v
      on v.id = i.variant_id
     and v.company_id = v_company_id
    where i.qty > 0
  )
  insert into public.erp_purchase_order_lines (
    company_id,
    purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  )
  select
    v_company_id,
    v_po_id,
    f.variant_id,
    f.qty,
    null
  from filtered f;

  get diagnostics v_line_count = row_count;

  if v_line_count = 0 then
    raise exception 'No valid items to add';
  end if;

  return v_po_id;
end;
$$;

revoke all on function public.erp_po_create_from_reorder(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.erp_po_create_from_reorder(uuid, uuid, jsonb, text, text) to authenticated;

create or replace function public.erp_post_grn(p_grn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_grn record;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Only owner/admin can post GRNs';
  end if;

  select * into v_grn
    from public.erp_grns
   where id = p_grn_id
  for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted';
  end if;

  if exists (
    select 1
      from public.erp_grn_lines gl
     where gl.grn_id = p_grn_id
       and gl.received_qty > 0
       and exists (
        select 1
          from public.erp_purchase_order_lines pol
         where pol.id = gl.purchase_order_line_id
           and (coalesce(pol.received_qty, 0) + gl.received_qty > pol.ordered_qty)
       )
  ) then
    raise exception 'GRN quantities exceed ordered quantities';
  end if;

  if not exists (
    select 1
    from public.erp_grn_lines gl
    where gl.grn_id = p_grn_id
  ) then
    raise exception 'GRN has no lines to post';
  end if;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty_in,
    qty_out,
    unit_cost,
    entry_type,
    reference,
    created_by
  )
  select
    gl.company_id,
    gl.warehouse_id,
    gl.variant_id,
    gl.received_qty,
    0,
    gl.unit_cost,
    'grn_in',
    'GRN Receipt',
    'GRN:' || p_grn_id::text,
    v_actor
  from public.erp_grn_lines gl
  where gl.grn_id = p_grn_id;

  update public.erp_purchase_order_lines pol
     set received_qty = coalesce(pol.received_qty, 0) + gl.received_qty,
         updated_at = now()
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and pol.id = gl.purchase_order_line_id;

  update public.erp_purchase_orders po
     set status = case
                    when (
                      select count(*)
                      from public.erp_purchase_order_lines pol
                      where pol.purchase_order_id = po.id
                        and coalesce(pol.received_qty, 0) < pol.ordered_qty
                    ) = 0 then 'received'
                    when po.status = 'approved' then 'partially_received'
                    else po.status
                  end,
         updated_at = now()
   where po.id = v_grn.purchase_order_id;

  update public.erp_grns
     set status = 'posted',
         grn_no = coalesce(grn_no, public.erp_next_document_number('GRN')),
         received_at = now(),
         updated_at = now()
   where id = p_grn_id;

  return jsonb_build_object('status', 'posted', 'grn_id', p_grn_id);
end;
$$;

revoke all on function public.erp_post_grn(uuid) from public;
grant execute on function public.erp_post_grn(uuid) to authenticated;
