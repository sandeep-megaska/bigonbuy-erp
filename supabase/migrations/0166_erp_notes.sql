-- Credit/Debit Notes (Customers + Vendors)

create table if not exists public.erp_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  note_no text null,
  party_type text not null,
  note_kind text not null,
  status text not null default 'draft',
  note_date date not null default current_date,
  party_id uuid null,
  party_name text not null,
  currency text not null default 'INR',
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  source_type text null,
  source_id uuid null,
  notes text null,
  approved_at timestamptz null,
  approved_by uuid null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_notes_party_type_check check (party_type in ('customer', 'vendor')),
  constraint erp_notes_note_kind_check check (note_kind in ('credit', 'debit')),
  constraint erp_notes_status_check check (status in ('draft', 'approved', 'cancelled'))
);

create table if not exists public.erp_note_lines (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.erp_notes (id) on delete cascade,
  line_no int not null default 1,
  item_type text not null default 'manual',
  variant_id uuid null,
  sku text null,
  title text null,
  hsn text null,
  qty numeric(14,3) not null default 1,
  unit_rate numeric(14,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  line_tax numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint erp_note_lines_item_type_check check (item_type in ('manual', 'variant')),
  constraint erp_note_lines_qty_check check (qty >= 0),
  constraint erp_note_lines_unit_rate_check check (unit_rate >= 0),
  constraint erp_note_lines_tax_rate_check check (tax_rate >= 0)
);

create table if not exists public.erp_note_number_sequences (
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  party_type text not null,
  note_kind text not null,
  last_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, party_type, note_kind),
  constraint erp_note_number_sequences_party_type_check check (party_type in ('customer', 'vendor')),
  constraint erp_note_number_sequences_note_kind_check check (note_kind in ('credit', 'debit'))
);

create table if not exists public.erp_note_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  note_id uuid not null references public.erp_notes (id) on delete cascade,
  settlement_date date not null default current_date,
  amount numeric(14,2) not null default 0,
  reference text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint erp_note_settlements_amount_check check (amount >= 0)
);

create unique index if not exists erp_notes_company_note_no_key
  on public.erp_notes (company_id, note_no);

create index if not exists erp_notes_company_status_idx
  on public.erp_notes (company_id, party_type, note_kind, status, note_date);

create index if not exists erp_note_lines_note_id_idx
  on public.erp_note_lines (note_id);

create index if not exists erp_note_settlements_note_id_idx
  on public.erp_note_settlements (note_id);

alter table public.erp_notes enable row level security;
alter table public.erp_notes force row level security;
alter table public.erp_note_lines enable row level security;
alter table public.erp_note_lines force row level security;
alter table public.erp_note_number_sequences enable row level security;
alter table public.erp_note_number_sequences force row level security;
alter table public.erp_note_settlements enable row level security;
alter table public.erp_note_settlements force row level security;

do $$
begin
  drop policy if exists erp_notes_select on public.erp_notes;
  drop policy if exists erp_notes_write on public.erp_notes;
  drop policy if exists erp_note_lines_select on public.erp_note_lines;
  drop policy if exists erp_note_lines_write on public.erp_note_lines;
  drop policy if exists erp_note_number_sequences_select on public.erp_note_number_sequences;
  drop policy if exists erp_note_number_sequences_write on public.erp_note_number_sequences;
  drop policy if exists erp_note_settlements_select on public.erp_note_settlements;
  drop policy if exists erp_note_settlements_write on public.erp_note_settlements;

  create policy erp_notes_select
    on public.erp_notes
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

  create policy erp_notes_write
    on public.erp_notes
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

  create policy erp_note_lines_select
    on public.erp_note_lines
    for select
    using (
      exists (
        select 1
        from public.erp_notes n
        where n.id = note_id
          and n.company_id = public.erp_current_company_id()
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
      )
    );

  create policy erp_note_lines_write
    on public.erp_note_lines
    for all
    using (
      exists (
        select 1
        from public.erp_notes n
        where n.id = note_id
          and n.company_id = public.erp_current_company_id()
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
    )
    with check (
      exists (
        select 1
        from public.erp_notes n
        where n.id = note_id
          and n.company_id = public.erp_current_company_id()
      )
    );

  create policy erp_note_number_sequences_select
    on public.erp_note_number_sequences
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

  create policy erp_note_number_sequences_write
    on public.erp_note_number_sequences
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

  create policy erp_note_settlements_select
    on public.erp_note_settlements
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

  create policy erp_note_settlements_write
    on public.erp_note_settlements
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
      'note_no', n.note_no,
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
  note_no text,
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
    n.note_no,
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
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_party_type text;
  v_note_kind text;
  v_status text;
  v_seq bigint;
  v_prefix text;
  v_note_no text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select party_type, note_kind, status
    into v_party_type, v_note_kind, v_status
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft notes can be approved';
  end if;

  insert into public.erp_note_number_sequences (company_id, party_type, note_kind, last_seq, updated_at)
  values (v_company_id, v_party_type, v_note_kind, 1, now())
  on conflict (company_id, party_type, note_kind)
  do update set last_seq = public.erp_note_number_sequences.last_seq + 1,
                updated_at = now()
  returning last_seq into v_seq;

  v_prefix := case v_note_kind
    when 'credit' then 'CN'
    when 'debit' then 'DN'
    else 'NT'
  end || '-' || case v_party_type when 'customer' then 'C' else 'V' end;

  v_note_no := v_prefix || lpad(v_seq::text, 6, '0');

  update public.erp_notes
  set
    note_no = v_note_no,
    status = 'approved',
    approved_at = now(),
    approved_by = auth.uid(),
    updated_at = now()
  where id = p_note_id;
end;
$$;

revoke all on function public.erp_note_approve(uuid) from public;
grant execute on function public.erp_note_approve(uuid) to authenticated;

create or replace function public.erp_note_cancel(p_note_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status
    into v_status
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_status <> 'approved' then
    raise exception 'Only approved notes can be cancelled';
  end if;

  update public.erp_notes
  set
    status = 'cancelled',
    cancel_reason = nullif(p_reason, ''),
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    updated_at = now()
  where id = p_note_id;
end;
$$;

revoke all on function public.erp_note_cancel(uuid, text) from public;
grant execute on function public.erp_note_cancel(uuid, text) to authenticated;
