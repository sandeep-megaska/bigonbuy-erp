-- Invoices MVP (FY numbering enforced)

alter table public.erp_company_settings
  add column if not exists state text;

create table if not exists public.erp_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  doc_no text null,
  doc_no_seq int null,
  fiscal_year text null,
  status text not null default 'draft',
  invoice_date date not null default current_date,
  customer_name text not null,
  customer_gstin text null,
  place_of_supply text not null,
  billing_address_line1 text null,
  billing_address_line2 text null,
  billing_city text null,
  billing_state text null,
  billing_pincode text null,
  billing_country text null,
  shipping_address_line1 text null,
  shipping_address_line2 text null,
  shipping_city text null,
  shipping_state text null,
  shipping_pincode text null,
  shipping_country text null,
  currency text not null default 'INR',
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  igst_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0,
  sgst_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  issued_at timestamptz null,
  issued_by uuid null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_invoices_status_check check (status in ('draft', 'issued', 'cancelled'))
);

create table if not exists public.erp_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.erp_invoices (id) on delete cascade,
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
  updated_at timestamptz not null default now(),
  constraint erp_invoice_lines_item_type_check check (item_type in ('manual', 'variant')),
  constraint erp_invoice_lines_qty_check check (qty >= 0),
  constraint erp_invoice_lines_unit_rate_check check (unit_rate >= 0),
  constraint erp_invoice_lines_tax_rate_check check (tax_rate >= 0),
  constraint erp_invoice_lines_invoice_line_no_key unique (invoice_id, line_no)
);

create index if not exists erp_invoices_company_date_idx
  on public.erp_invoices (company_id, invoice_date);

create index if not exists erp_invoices_company_status_idx
  on public.erp_invoices (company_id, status);

create unique index if not exists erp_invoices_company_doc_no_key
  on public.erp_invoices (company_id, doc_no)
  where doc_no is not null;

create index if not exists erp_invoice_lines_invoice_id_idx
  on public.erp_invoice_lines (invoice_id);

alter table public.erp_invoices enable row level security;
alter table public.erp_invoices force row level security;
alter table public.erp_invoice_lines enable row level security;
alter table public.erp_invoice_lines force row level security;

do $$
begin
  drop policy if exists erp_invoices_select on public.erp_invoices;
  drop policy if exists erp_invoices_insert on public.erp_invoices;
  drop policy if exists erp_invoices_update on public.erp_invoices;
  drop policy if exists erp_invoice_lines_select on public.erp_invoice_lines;
  drop policy if exists erp_invoice_lines_insert on public.erp_invoice_lines;
  drop policy if exists erp_invoice_lines_update on public.erp_invoice_lines;

  create policy erp_invoices_select
    on public.erp_invoices
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

  create policy erp_invoices_insert
    on public.erp_invoices
    for insert
    with check (
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

  create policy erp_invoices_update
    on public.erp_invoices
    for update
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
    with check (company_id = public.erp_current_company_id());

  create policy erp_invoice_lines_select
    on public.erp_invoice_lines
    for select
    using (
      exists (
        select 1
        from public.erp_invoices i
        where i.id = invoice_id
          and i.company_id = public.erp_current_company_id()
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

  create policy erp_invoice_lines_insert
    on public.erp_invoice_lines
    for insert
    with check (
      exists (
        select 1
        from public.erp_invoices i
        where i.id = invoice_id
          and i.company_id = public.erp_current_company_id()
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
    );

  create policy erp_invoice_lines_update
    on public.erp_invoice_lines
    for update
    using (
      exists (
        select 1
        from public.erp_invoices i
        where i.id = invoice_id
          and i.company_id = public.erp_current_company_id()
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
        from public.erp_invoices i
        where i.id = invoice_id
          and i.company_id = public.erp_current_company_id()
      )
    );
end;
$$;

create or replace function public.erp_doc_allocate_number(p_doc_id uuid, p_doc_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_key text := upper(trim(p_doc_key));
  v_doc_date date;
  v_fiscal_year text;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_doc_id is null then
    raise exception 'doc_id is required';
  end if;

  if v_doc_key = '' then
    raise exception 'doc_key is required';
  end if;

  case v_doc_key
    when 'PO' then
      select order_date
        into v_doc_date
        from public.erp_purchase_orders
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Purchase order not found';
      end if;
    when 'GRN' then
      select received_at::date
        into v_doc_date
        from public.erp_grns
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'GRN not found';
      end if;
    when 'CN', 'DN' then
      select note_date
        into v_doc_date
        from public.erp_notes
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Note not found';
      end if;
    when 'INV' then
      select invoice_date
        into v_doc_date
        from public.erp_invoices
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Invoice not found';
      end if;
    else
      raise exception 'Unsupported document key: %', v_doc_key;
  end case;

  if v_doc_date is null then
    v_doc_date := current_date;
  end if;

  v_fiscal_year := public.erp_fiscal_year(v_doc_date);

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

revoke all on function public.erp_doc_allocate_number(uuid, text) from public;
grant execute on function public.erp_doc_allocate_number(uuid, text) to authenticated;

create or replace function public.erp_invoice_upsert(p_invoice jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_invoice_id uuid;
  v_status text;
  v_invoice_date date := coalesce(nullif(p_invoice->>'invoice_date', '')::date, current_date);
  v_customer_name text := nullif(p_invoice->>'customer_name', '');
  v_customer_gstin text := nullif(p_invoice->>'customer_gstin', '');
  v_place_of_supply text := nullif(p_invoice->>'place_of_supply', '');
  v_currency text := coalesce(nullif(p_invoice->>'currency', ''), 'INR');
  v_billing_address_line1 text := nullif(p_invoice->>'billing_address_line1', '');
  v_billing_address_line2 text := nullif(p_invoice->>'billing_address_line2', '');
  v_billing_city text := nullif(p_invoice->>'billing_city', '');
  v_billing_state text := nullif(p_invoice->>'billing_state', '');
  v_billing_pincode text := nullif(p_invoice->>'billing_pincode', '');
  v_billing_country text := nullif(p_invoice->>'billing_country', '');
  v_shipping_address_line1 text := nullif(p_invoice->>'shipping_address_line1', '');
  v_shipping_address_line2 text := nullif(p_invoice->>'shipping_address_line2', '');
  v_shipping_city text := nullif(p_invoice->>'shipping_city', '');
  v_shipping_state text := nullif(p_invoice->>'shipping_state', '');
  v_shipping_pincode text := nullif(p_invoice->>'shipping_pincode', '');
  v_shipping_country text := nullif(p_invoice->>'shipping_country', '');
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_customer_name is null then
    raise exception 'Customer name is required';
  end if;

  if v_place_of_supply is null then
    raise exception 'Place of supply is required';
  end if;

  if (p_invoice ? 'id') and nullif(p_invoice->>'id', '') is not null then
    v_invoice_id := (p_invoice->>'id')::uuid;

    select status
      into v_status
      from public.erp_invoices
      where id = v_invoice_id
        and company_id = v_company_id
      for update;

    if not found then
      raise exception 'Invoice not found';
    end if;

    if v_status <> 'draft' then
      raise exception 'Only draft invoices can be edited';
    end if;

    update public.erp_invoices
       set invoice_date = v_invoice_date,
           customer_name = trim(v_customer_name),
           customer_gstin = nullif(trim(coalesce(v_customer_gstin, '')), ''),
           place_of_supply = trim(v_place_of_supply),
           billing_address_line1 = nullif(trim(coalesce(v_billing_address_line1, '')), ''),
           billing_address_line2 = nullif(trim(coalesce(v_billing_address_line2, '')), ''),
           billing_city = nullif(trim(coalesce(v_billing_city, '')), ''),
           billing_state = nullif(trim(coalesce(v_billing_state, '')), ''),
           billing_pincode = nullif(trim(coalesce(v_billing_pincode, '')), ''),
           billing_country = nullif(trim(coalesce(v_billing_country, '')), ''),
           shipping_address_line1 = nullif(trim(coalesce(v_shipping_address_line1, '')), ''),
           shipping_address_line2 = nullif(trim(coalesce(v_shipping_address_line2, '')), ''),
           shipping_city = nullif(trim(coalesce(v_shipping_city, '')), ''),
           shipping_state = nullif(trim(coalesce(v_shipping_state, '')), ''),
           shipping_pincode = nullif(trim(coalesce(v_shipping_pincode, '')), ''),
           shipping_country = nullif(trim(coalesce(v_shipping_country, '')), ''),
           currency = upper(trim(v_currency)),
           updated_at = now()
     where id = v_invoice_id
       and company_id = v_company_id
    returning id into v_invoice_id;
  else
    insert into public.erp_invoices (
      company_id,
      invoice_date,
      customer_name,
      customer_gstin,
      place_of_supply,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_state,
      billing_pincode,
      billing_country,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_state,
      shipping_pincode,
      shipping_country,
      currency
    ) values (
      v_company_id,
      v_invoice_date,
      trim(v_customer_name),
      nullif(trim(coalesce(v_customer_gstin, '')), ''),
      trim(v_place_of_supply),
      nullif(trim(coalesce(v_billing_address_line1, '')), ''),
      nullif(trim(coalesce(v_billing_address_line2, '')), ''),
      nullif(trim(coalesce(v_billing_city, '')), ''),
      nullif(trim(coalesce(v_billing_state, '')), ''),
      nullif(trim(coalesce(v_billing_pincode, '')), ''),
      nullif(trim(coalesce(v_billing_country, '')), ''),
      nullif(trim(coalesce(v_shipping_address_line1, '')), ''),
      nullif(trim(coalesce(v_shipping_address_line2, '')), ''),
      nullif(trim(coalesce(v_shipping_city, '')), ''),
      nullif(trim(coalesce(v_shipping_state, '')), ''),
      nullif(trim(coalesce(v_shipping_pincode, '')), ''),
      nullif(trim(coalesce(v_shipping_country, '')), ''),
      upper(trim(v_currency))
    ) returning id into v_invoice_id;
  end if;

  return v_invoice_id;
end;
$$;

revoke all on function public.erp_invoice_upsert(jsonb) from public;
grant execute on function public.erp_invoice_upsert(jsonb) to authenticated;

create or replace function public.erp_invoice_line_upsert(p_line jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_invoice_id uuid := nullif(p_line->>'invoice_id', '')::uuid;
  v_line_no int := coalesce(nullif(p_line->>'line_no', '')::int, 1);
  v_item_type text := coalesce(nullif(p_line->>'item_type', ''), 'manual');
  v_variant_id uuid := nullif(p_line->>'variant_id', '')::uuid;
  v_sku text := nullif(p_line->>'sku', '');
  v_title text := nullif(p_line->>'title', '');
  v_hsn text := nullif(p_line->>'hsn', '');
  v_qty numeric := coalesce(nullif(p_line->>'qty', '')::numeric, 0);
  v_unit_rate numeric := coalesce(nullif(p_line->>'unit_rate', '')::numeric, 0);
  v_tax_rate numeric := coalesce(nullif(p_line->>'tax_rate', '')::numeric, 0);
  v_status text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_invoice_id is null then
    raise exception 'invoice_id is required';
  end if;

  if v_item_type not in ('manual', 'variant') then
    raise exception 'Invalid item_type';
  end if;

  select status
    into v_status
    from public.erp_invoices
    where id = v_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft invoices can be edited';
  end if;

  if (p_line ? 'id') and nullif(p_line->>'id', '') is not null then
    v_line_id := (p_line->>'id')::uuid;

    update public.erp_invoice_lines
       set line_no = v_line_no,
           item_type = v_item_type,
           variant_id = v_variant_id,
           sku = nullif(trim(coalesce(v_sku, '')), ''),
           title = nullif(trim(coalesce(v_title, '')), ''),
           hsn = nullif(trim(coalesce(v_hsn, '')), ''),
           qty = v_qty,
           unit_rate = v_unit_rate,
           tax_rate = v_tax_rate,
           updated_at = now()
     where id = v_line_id
       and invoice_id = v_invoice_id
    returning id into v_line_id;

    if v_line_id is null then
      raise exception 'Invoice line not found';
    end if;
  else
    select id
      into v_line_id
      from public.erp_invoice_lines
      where invoice_id = v_invoice_id
        and line_no = v_line_no;

    if v_line_id is null then
      insert into public.erp_invoice_lines (
        invoice_id,
        line_no,
        item_type,
        variant_id,
        sku,
        title,
        hsn,
        qty,
        unit_rate,
        tax_rate
      ) values (
        v_invoice_id,
        v_line_no,
        v_item_type,
        v_variant_id,
        nullif(trim(coalesce(v_sku, '')), ''),
        nullif(trim(coalesce(v_title, '')), ''),
        nullif(trim(coalesce(v_hsn, '')), ''),
        v_qty,
        v_unit_rate,
        v_tax_rate
      ) returning id into v_line_id;
    else
      update public.erp_invoice_lines
         set item_type = v_item_type,
             variant_id = v_variant_id,
             sku = nullif(trim(coalesce(v_sku, '')), ''),
             title = nullif(trim(coalesce(v_title, '')), ''),
             hsn = nullif(trim(coalesce(v_hsn, '')), ''),
             qty = v_qty,
             unit_rate = v_unit_rate,
             tax_rate = v_tax_rate,
             updated_at = now()
       where id = v_line_id;
    end if;
  end if;

  return v_line_id;
end;
$$;

revoke all on function public.erp_invoice_line_upsert(jsonb) from public;
grant execute on function public.erp_invoice_line_upsert(jsonb) to authenticated;

create or replace function public.erp_invoice_recompute_totals(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_place_of_supply text;
  v_company_state text;
  v_subtotal numeric(14,2);
  v_tax_total numeric(14,2);
  v_total numeric(14,2);
  v_igst_total numeric(14,2);
  v_cgst_total numeric(14,2);
  v_sgst_total numeric(14,2);
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select place_of_supply
    into v_place_of_supply
    from public.erp_invoices
    where id = p_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  update public.erp_invoice_lines
     set line_subtotal = round(qty * unit_rate, 2),
         line_tax = round((qty * unit_rate) * (tax_rate / 100), 2),
         line_total = round((qty * unit_rate) + ((qty * unit_rate) * (tax_rate / 100)), 2),
         updated_at = now()
   where invoice_id = p_invoice_id;

  select
    coalesce(sum(line_subtotal), 0),
    coalesce(sum(line_tax), 0),
    coalesce(sum(line_total), 0)
    into v_subtotal, v_tax_total, v_total
    from public.erp_invoice_lines
    where invoice_id = p_invoice_id;

  select nullif(trim(coalesce(cs.state, '')), '')
    into v_company_state
    from public.erp_company_settings cs
    where cs.company_id = v_company_id;

  v_company_state := coalesce(v_company_state, v_place_of_supply);

  if lower(trim(coalesce(v_company_state, ''))) <> lower(trim(coalesce(v_place_of_supply, ''))) then
    v_igst_total := v_tax_total;
    v_cgst_total := 0;
    v_sgst_total := 0;
  else
    v_cgst_total := round(v_tax_total / 2, 2);
    v_sgst_total := round(v_tax_total - v_cgst_total, 2);
    v_igst_total := 0;
  end if;

  update public.erp_invoices
     set subtotal = v_subtotal,
         tax_total = v_tax_total,
         igst_total = v_igst_total,
         cgst_total = v_cgst_total,
         sgst_total = v_sgst_total,
         total = v_total,
         updated_at = now()
   where id = p_invoice_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok', true,
    'subtotal', v_subtotal,
    'tax_total', v_tax_total,
    'igst_total', v_igst_total,
    'cgst_total', v_cgst_total,
    'sgst_total', v_sgst_total,
    'total', v_total
  );
end;
$$;

revoke all on function public.erp_invoice_recompute_totals(uuid) from public;
grant execute on function public.erp_invoice_recompute_totals(uuid) to authenticated;

create or replace function public.erp_invoice_issue(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_no text;
  v_status text;
  v_invoice_date date;
  v_customer_name text;
  v_place_of_supply text;
  v_fiscal_year text;
  v_doc_seq int;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select doc_no, status, invoice_date, customer_name, place_of_supply
    into v_doc_no, v_status, v_invoice_date, v_customer_name, v_place_of_supply
    from public.erp_invoices
    where id = p_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft invoices can be issued';
  end if;

  if v_invoice_date is null then
    raise exception 'Invoice date is required';
  end if;

  if v_customer_name is null or trim(v_customer_name) = '' then
    raise exception 'Customer name is required';
  end if;

  if v_place_of_supply is null or trim(v_place_of_supply) = '' then
    raise exception 'Place of supply is required';
  end if;

  if v_doc_no is null then
    v_doc_no := public.erp_doc_allocate_number(p_invoice_id, 'INV');
  end if;

  if not public.erp_doc_no_is_valid(v_doc_no, 'INV') then
    raise exception 'Invalid invoice number';
  end if;

  v_fiscal_year := split_part(v_doc_no, '/', 1);
  v_doc_seq := nullif(split_part(v_doc_no, '/', 3), '')::int;

  update public.erp_invoices
     set doc_no = v_doc_no,
         doc_no_seq = v_doc_seq,
         fiscal_year = v_fiscal_year,
         status = 'issued',
         issued_at = now(),
         issued_by = auth.uid(),
         updated_at = now()
   where id = p_invoice_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok', true,
    'doc_no', v_doc_no,
    'status', 'issued'
  );
end;
$$;

revoke all on function public.erp_invoice_issue(uuid) from public;
grant execute on function public.erp_invoice_issue(uuid) to authenticated;

create or replace function public.erp_invoice_cancel(p_invoice_id uuid, p_reason text)
returns jsonb
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
    from public.erp_invoices
    where id = p_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_status not in ('draft', 'issued') then
    raise exception 'Invoice cannot be cancelled';
  end if;

  update public.erp_invoices
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = p_invoice_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.erp_invoice_cancel(uuid, text) from public;
grant execute on function public.erp_invoice_cancel(uuid, text) to authenticated;
