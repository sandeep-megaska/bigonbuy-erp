-- FY-based document numbering for ERP documents

create or replace function public.erp_fy_label(p_date date)
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

  return format(
    'FY%s-%s',
    lpad((v_start_year % 100)::text, 2, '0'),
    lpad((v_end_year % 100)::text, 2, '0')
  );
end;
$$;

create or replace function public.erp_next_doc_no(
  p_doc_type text,
  p_for_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_type text := upper(trim(p_doc_type));
  v_fy_label text;
  v_fy_start date;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_doc_type not in ('PO', 'CN', 'DN', 'GRN', 'INV') then
    raise exception 'Invalid document type';
  end if;

  v_fy_label := public.erp_fy_label(p_for_date);
  v_fy_start := case
    when extract(month from p_for_date)::int >= 4 then make_date(extract(year from p_for_date)::int, 4, 1)
    else make_date(extract(year from p_for_date)::int - 1, 4, 1)
  end;

  insert into public.erp_doc_sequences (company_id, doc_type, fy_label, fy_start, next_seq)
  values (v_company_id, v_doc_type, v_fy_label, v_fy_start, 1)
  on conflict (company_id, doc_type, fy_label) do nothing;

  select next_seq
    into v_seq
    from public.erp_doc_sequences
    where company_id = v_company_id
      and doc_type = v_doc_type
      and fy_label = v_fy_label
    for update;

  update public.erp_doc_sequences
  set next_seq = next_seq + 1,
      updated_at = now()
  where company_id = v_company_id
    and doc_type = v_doc_type
    and fy_label = v_fy_label;

  return format('%s/%s/%s', v_fy_label, v_doc_type, lpad(v_seq::text, 6, '0'));
end;
$$;

revoke all on function public.erp_next_doc_no(text, date) from public;
grant execute on function public.erp_next_doc_no(text, date) to authenticated;

alter table public.erp_doc_sequences
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists doc_type text,
  add column if not exists fy_label text,
  add column if not exists fy_start date,
  add column if not exists updated_at timestamptz not null default now();

update public.erp_doc_sequences
set id = gen_random_uuid()
where id is null;

update public.erp_doc_sequences
set updated_at = now()
where updated_at is null;

update public.erp_doc_sequences
set
  doc_type = coalesce(doc_type, doc_key),
  fy_label = coalesce(fy_label, fiscal_year)
where doc_type is null
   or fy_label is null;

update public.erp_doc_sequences
set fy_start = make_date(
  case
    when fy_label ~ '^FY\d{2}-\d{2}$' then 2000 + substring(fy_label from 3 for 2)::int
    else extract(year from current_date)::int
  end,
  4,
  1
)
where fy_start is null;

alter table public.erp_doc_sequences
  alter column doc_type set not null,
  alter column fy_label set not null,
  alter column fy_start set not null,
  alter column id set not null;

alter table public.erp_doc_sequences
  drop constraint if exists erp_doc_sequences_pkey;

alter table public.erp_doc_sequences
  add constraint erp_doc_sequences_pkey primary key (id);

alter table public.erp_doc_sequences
  drop column if exists fiscal_year,
  drop column if exists doc_key;

alter table public.erp_doc_sequences
  add constraint erp_doc_sequences_company_doc_type_fy_label_key unique (company_id, doc_type, fy_label);

alter table public.erp_purchase_orders
  add column if not exists doc_no text null;

alter table public.erp_notes
  add column if not exists doc_no text null;

create unique index if not exists erp_purchase_orders_company_doc_no_key
  on public.erp_purchase_orders (company_id, doc_no)
  where doc_no is not null;

create unique index if not exists erp_notes_company_doc_no_key
  on public.erp_notes (company_id, doc_no)
  where doc_no is not null;

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

  v_doc_no := public.erp_next_doc_no(v_doc_type, v_note_date);

  update public.erp_notes
  set
    doc_no = v_doc_no,
    note_number = coalesce(note_number, v_doc_no),
    note_no = coalesce(note_no, v_doc_no),
    fiscal_year = coalesce(fiscal_year, public.erp_fy_label(v_note_date)),
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
  v_status text;
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_doc_type text;
  v_doc_no text;
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
      updated_at = now()
    where id = v_note_id;

    delete from public.erp_note_lines where note_id = v_note_id;
  else
    v_doc_type := case v_note_kind
      when 'credit' then 'CN'
      when 'debit' then 'DN'
      else 'NT'
    end;
    v_doc_no := public.erp_next_doc_no(v_doc_type, v_note_date);

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
      doc_no,
      note_number,
      note_no,
      fiscal_year,
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
      v_doc_no,
      v_doc_no,
      v_doc_no,
      public.erp_fy_label(v_note_date),
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

create or replace function public.erp_notes_list(
  p_party_type text default null,
  p_note_kind text default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_doc_no text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table(
  id uuid,
  doc_no text,
  party_type text,
  note_kind text,
  status text,
  note_date date,
  party_id uuid,
  party_name text,
  currency text,
  subtotal numeric,
  tax_total numeric,
  total numeric,
  source_type text,
  source_id uuid,
  approved_at timestamptz,
  created_at timestamptz
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
    n.id,
    n.doc_no,
    n.party_type,
    n.note_kind,
    n.status,
    n.note_date,
    n.party_id,
    n.party_name,
    n.currency,
    n.subtotal,
    n.tax_total,
    n.total,
    n.source_type,
    n.source_id,
    n.approved_at,
    n.created_at
  from public.erp_notes n
  where n.company_id = public.erp_current_company_id()
    and (p_party_type is null or p_party_type = '' or n.party_type = p_party_type)
    and (p_note_kind is null or p_note_kind = '' or n.note_kind = p_note_kind)
    and (p_status is null or p_status = '' or n.status = p_status)
    and (p_from is null or n.note_date >= p_from)
    and (p_to is null or n.note_date <= p_to)
    and (p_doc_no is null or p_doc_no = '' or n.doc_no ilike '%' || p_doc_no || '%')
  order by n.note_date desc, n.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

revoke all on function public.erp_notes_list(text, text, text, date, date, text, int, int) from public;
grant execute on function public.erp_notes_list(text, text, text, date, date, text, int, int) to authenticated;

create or replace function public.erp_note_approve(p_note_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text;
  v_doc_no text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status, doc_no
    into v_status, v_doc_no
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_status = 'approved' then
    return v_doc_no;
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft notes can be approved';
  end if;

  if v_doc_no is null then
    v_doc_no := public.erp_note_allocate_number(p_note_id);
  end if;

  update public.erp_notes
  set
    status = 'approved',
    approved_at = now(),
    approved_by = auth.uid(),
    updated_at = now()
  where id = p_note_id;

  return v_doc_no;
end;
$$;

revoke all on function public.erp_note_approve(uuid) from public;
grant execute on function public.erp_note_approve(uuid) to authenticated;

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
  v_doc_no text;
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

  v_doc_no := public.erp_next_doc_no('PO', coalesce(p_order_date, current_date));

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
    v_doc_no
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
  v_doc_no text;
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

  v_doc_no := public.erp_next_doc_no('PO', current_date);

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
    v_doc_no
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

create or replace function public.erp_proc_po_pdf_payload(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_payload jsonb;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select company_id
    into v_company_id
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
  ) then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'po', jsonb_build_object(
      'id', po.id,
      'doc_no', po.doc_no,
      'status', po.status,
      'order_date', po.order_date,
      'expected_delivery_date', po.expected_delivery_date,
      'notes', po.notes,
      'deliver_to_warehouse_id', po.deliver_to_warehouse_id,
      'vendor_id', po.vendor_id
    ),
    'vendor', jsonb_build_object(
      'id', v.id,
      'legal_name', v.legal_name,
      'gstin', v.gstin,
      'contact_person', v.contact_person,
      'phone', v.phone,
      'email', v.email,
      'address', v.address,
      'address_line1', v.address_line1,
      'address_line2', v.address_line2,
      'city', v.city,
      'state', v.state,
      'pincode', v.pincode,
      'country', v.country
    ),
    'deliver_to',
      case
        when w.id is not null then jsonb_build_object('id', w.id, 'name', w.name)
        else null
      end,
    'lines', coalesce(lines.lines, '[]'::jsonb),
    'company', jsonb_build_object(
      'company_id', c.id,
      'legal_name', c.legal_name,
      'brand_name', c.brand_name,
      'currency_code', c.currency_code,
      'gstin', cs.gstin,
      'address_text', cs.address_text,
      'po_terms_text', cs.po_terms_text,
      'po_footer_address_text', cs.po_footer_address_text,
      'bigonbuy_logo_path', cs.bigonbuy_logo_path,
      'megaska_logo_path', cs.megaska_logo_path
    )
  )
  into v_payload
  from public.erp_purchase_orders po
  left join public.erp_vendors v on v.id = po.vendor_id
  left join public.erp_warehouses w on w.id = po.deliver_to_warehouse_id
  left join public.erp_companies c on c.id = po.company_id
  left join public.erp_company_settings cs on cs.company_id = po.company_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', pol.id,
        'variant_id', pol.variant_id,
        'ordered_qty', pol.ordered_qty,
        'unit_cost', pol.unit_cost,
        'sku', var.sku,
        'size', var.size,
        'color', var.color,
        'product_title', prod.title,
        'hsn_code', prod.hsn_code,
        'style_code', prod.style_code
      )
      order by pol.created_at
    ) as lines
    from public.erp_purchase_order_lines pol
    left join public.erp_variants var on var.id = pol.variant_id
    left join public.erp_products prod on prod.id = var.product_id
    where pol.purchase_order_id = po.id
      and pol.company_id = v_company_id
  ) lines on true
  where po.id = p_po_id;

  return v_payload;
end;
$$;

revoke all on function public.erp_proc_po_pdf_payload(uuid) from public;
grant execute on function public.erp_proc_po_pdf_payload(uuid) to authenticated;

notify pgrst, 'reload schema';
