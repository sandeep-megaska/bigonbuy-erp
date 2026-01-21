-- Proper CN/DN numbering with fiscal year sequences
-- DROP old versions if they exist (return type changed)

drop function if exists public.erp_note_get(uuid);
drop function if exists public.erp_notes_list(
  text, text, text, date, date, int, int
);
drop function if exists public.erp_note_approve(uuid);
drop function if exists public.erp_finance_note_pdf_payload(uuid);

alter table public.erp_notes
  add column if not exists note_number text null,
  add column if not exists note_number_seq int null,
  add column if not exists fiscal_year text null,
  add column if not exists approved_at timestamptz null;

update public.erp_notes
set note_number = note_no
where note_number is null
  and note_no is not null;

create table if not exists public.erp_doc_sequences (
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  fiscal_year text not null,
  doc_key text not null,
  next_seq int not null default 1,
  primary key (company_id, fiscal_year, doc_key)
);

create unique index if not exists erp_notes_company_note_number_key
  on public.erp_notes (company_id, note_number)
  where note_number is not null;

alter table public.erp_doc_sequences enable row level security;
alter table public.erp_doc_sequences force row level security;

do $$
begin
  drop policy if exists erp_doc_sequences_select on public.erp_doc_sequences;
  drop policy if exists erp_doc_sequences_write on public.erp_doc_sequences;

  create policy erp_doc_sequences_select
    on public.erp_doc_sequences
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

  create policy erp_doc_sequences_write
    on public.erp_doc_sequences
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
    );
end;
$$;

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

create or replace function public.erp_note_allocate_number(p_note_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_note_number text;
  v_note_kind text;
  v_note_date date;
  v_doc_key text;
  v_fiscal_year text;
  v_seq int;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select note_number, note_kind, note_date
    into v_note_number, v_note_kind, v_note_date
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_note_number is not null then
    return v_note_number;
  end if;

  v_doc_key := case v_note_kind
    when 'credit' then 'CN'
    when 'debit' then 'DN'
    else 'NT'
  end;

  v_fiscal_year := public.erp_fiscal_year(v_note_date);

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

  v_note_number := v_fiscal_year || '/' || v_doc_key || '/' || lpad(v_seq::text, 6, '0');

  update public.erp_notes
  set
    note_number = v_note_number,
    note_number_seq = v_seq,
    fiscal_year = v_fiscal_year,
    note_no = v_note_number,
    updated_at = now()
  where id = p_note_id
    and note_number is null;

  select note_number
    into v_note_number
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id;

  return v_note_number;
end;
$$;

revoke all on function public.erp_note_allocate_number(uuid) from public;
grant execute on function public.erp_note_allocate_number(uuid) to authenticated;

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

  if v_payload is null then
    raise exception 'Note not found';
  end if;

  return v_payload;
end;
$$;

revoke all on function public.erp_note_get(uuid) from public;
grant execute on function public.erp_note_get(uuid) to authenticated;

create or replace function public.erp_notes_list(
  p_party_type text,
  p_note_kind text,
  p_status text default '',
  p_from date default null,
  p_to date default null,
  p_limit int default 50,
  p_offset int default 0
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
  order by n.note_date desc, n.created_at desc
  limit coalesce(p_limit, 50)
  offset coalesce(p_offset, 0);
end;
$$;

revoke all on function public.erp_notes_list(text, text, text, date, date, int, int) from public;
grant execute on function public.erp_notes_list(text, text, text, date, date, int, int) to authenticated;

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
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status, note_number
    into v_status, v_note_number
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

  v_note_number := public.erp_note_allocate_number(p_note_id);

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
      'note_number', n.note_number,
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
      'cancel_reason', n.cancel_reason
    ),
    'party', jsonb_build_object(
      'name', coalesce(v.legal_name, n.party_name),
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
    'lines', coalesce(lines.lines, '[]'::jsonb),
    'company', jsonb_build_object(
      'company_id', c.id,
      'legal_name', c.legal_name,
      'brand_name', c.brand_name,
      'currency_code', c.currency_code,
      'gstin', cs.gstin,
      'address_text', cs.address_text,
      'bigonbuy_logo_path', cs.bigonbuy_logo_path,
      'megaska_logo_path', cs.megaska_logo_path
    )
  )
  into v_payload
  from public.erp_notes n
  left join public.erp_vendors v on v.id = n.party_id and n.party_type = 'vendor'
  left join public.erp_companies c on c.id = n.company_id
  left join public.erp_company_settings cs on cs.company_id = n.company_id
  left join lateral (
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
    ) as lines
    from public.erp_note_lines l
    where l.note_id = n.id
  ) lines on true
  where n.id = p_note_id
    and n.company_id = v_company_id;

  if v_payload is null then
    raise exception 'Note not found';
  end if;

  return v_payload;
end;
$$;

revoke all on function public.erp_finance_note_pdf_payload(uuid) from public;
grant execute on function public.erp_finance_note_pdf_payload(uuid) to authenticated;
