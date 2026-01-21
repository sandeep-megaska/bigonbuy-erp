-- Unify ERP document numbering with FY-based sequences

create table if not exists public.erp_doc_sequences (
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  fiscal_year text not null,
  doc_key text not null,
  next_seq int not null default 1,
  primary key (company_id, fiscal_year, doc_key)
);

alter table public.erp_doc_sequences
  add column if not exists fiscal_year text,
  add column if not exists doc_key text,
  add column if not exists next_seq int;

update public.erp_doc_sequences
set fiscal_year = coalesce(fiscal_year, fy_label)
where fiscal_year is null
  and fy_label is not null;

update public.erp_doc_sequences
set doc_key = coalesce(doc_key, doc_type)
where doc_key is null
  and doc_type is not null;

create unique index if not exists erp_doc_sequences_company_fiscal_year_doc_key_key
  on public.erp_doc_sequences (company_id, fiscal_year, doc_key);

create or replace function public.erp_fiscal_year(p_date date default current_date)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_start_year int := extract(year from p_date)::int;
  v_end_year int;
  v_month int := extract(month from p_date)::int;
begin
  if v_month < 4 then
    v_start_year := v_start_year - 1;
  end if;

  v_end_year := v_start_year + 1;

  return format(
    'FY%s-%s',
    lpad((v_start_year % 100)::text, 2, '0'),
    lpad((v_end_year % 100)::text, 2, '0')
  );
end;
$$;

create or replace function public.erp_doc_allocate_number(p_doc_key text, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_key text := upper(trim(p_doc_key));
  v_fiscal_year text;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  v_fiscal_year := public.erp_fiscal_year(p_date);

  insert into public.erp_doc_sequences (company_id, fiscal_year, doc_key, next_seq)
  values (v_company_id, v_fiscal_year, v_doc_key, 1)
  on conflict (company_id, fiscal_year, doc_key) do nothing;

  select next_seq
    into v_seq
    from public.erp_doc_sequences
    where company_id = v_company_id
      and fiscal_year = v_fiscal_year
      and doc_key = v_doc_key
    for update;

  update public.erp_doc_sequences
  set next_seq = next_seq + 1
  where company_id = v_company_id
    and fiscal_year = v_fiscal_year
    and doc_key = v_doc_key;

  return v_fiscal_year || '/' || v_doc_key || '/' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_doc_allocate_number(text, date) from public;
grant execute on function public.erp_doc_allocate_number(text, date) to authenticated;

create unique index if not exists erp_purchase_orders_company_doc_no_key
  on public.erp_purchase_orders (company_id, doc_no)
  where doc_no is not null;

create unique index if not exists erp_notes_company_note_number_key
  on public.erp_notes (company_id, note_number)
  where note_number is not null;

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
  v_doc_no text;
  v_order_date date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select company_id, status, doc_no, order_date
    into v_company_id, v_status, v_doc_no, v_order_date
    from public.erp_purchase_orders
    where id = p_po_id
    for update;

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

  if v_doc_no is null then
    v_doc_no := public.erp_doc_allocate_number('PO', coalesce(v_order_date, current_date));
  end if;

  update public.erp_purchase_orders
     set status = 'approved',
         doc_no = coalesce(doc_no, v_doc_no),
         po_no = coalesce(po_no, v_doc_no),
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
      'note_number', n.note_number,
      'party_type', n.party_type,
      'note_kind', n.note_kind,
      'status', n.status,
      'note_date', n.note_date,
      'party_id', n.party_id,
      'party_name', n.party_name,
      'currency', n.currency,
      'reference_invoice_number', n.reference_invoice_number,
      'reference_invoice_date', n.reference_invoice_date,
      'reason', n.reason,
      'place_of_supply', n.place_of_supply,
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
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
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
      ) order by l.line_no), '[]'::jsonb)
      from public.erp_note_lines l
      where l.note_id = n.id
    )
  )
  into v_payload
  from public.erp_notes n
  where n.id = p_note_id
    and n.company_id = v_company_id;

  if v_payload is null then
    raise exception 'Note not found';
  end if;

  return v_payload;
end;
$$;

revoke all on function public.erp_note_get(uuid) from public;
grant execute on function public.erp_note_get(uuid) to authenticated;
-- Must DROP before changing RETURNS TABLE (OUT columns)
drop function if exists public.erp_notes_list(text,text,text,date,date,text,int,int);
drop function if exists public.erp_notes_list(text,text,text,date,date,int,int); -- older signature (if any)

create function public.erp_notes_list(
  p_party_type text,
  p_note_kind text,
  p_status text,
  p_from date,
  p_to date,
  p_doc_no text,
  p_limit int,
  p_offset int
)
returns table (

  id uuid,
  note_number text,
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
    n.note_number,
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
    and (p_doc_no is null or p_doc_no = '' or n.note_number ilike '%' || p_doc_no || '%')
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
  v_note_number text;
  v_note_kind text;
  v_note_date date;
  v_doc_key text;
  v_fiscal_year text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status, note_number, note_kind, note_date
    into v_status, v_note_number, v_note_kind, v_note_date
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_status = 'approved' then
    return v_note_number;
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft notes can be approved';
  end if;

  if v_note_number is null then
    v_doc_key := case v_note_kind
      when 'credit' then 'CN'
      when 'debit' then 'DN'
      else 'NT'
    end;

    v_note_number := public.erp_doc_allocate_number(v_doc_key, v_note_date);
    v_fiscal_year := public.erp_fiscal_year(v_note_date);

    update public.erp_notes
    set
      note_number = v_note_number,
      note_no = coalesce(note_no, v_note_number),
      fiscal_year = coalesce(fiscal_year, v_fiscal_year),
      updated_at = now()
    where id = p_note_id
      and note_number is null;
  end if;

  update public.erp_notes
  set
    status = 'approved',
    approved_at = now(),
    approved_by = auth.uid(),
    updated_at = now()
  where id = p_note_id;

  return v_note_number;
end;
$$;

revoke all on function public.erp_note_approve(uuid) from public;
grant execute on function public.erp_note_approve(uuid) to authenticated;

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
      'po_no', po.po_no,
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
