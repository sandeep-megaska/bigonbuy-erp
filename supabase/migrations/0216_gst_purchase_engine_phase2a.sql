-- GST Purchase Engine (Phase 2A)

create table if not exists public.erp_gst_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  vendor_gstin text null,
  vendor_state_code text null,
  invoice_no text not null,
  invoice_date date not null,
  place_of_supply_state_code text null,
  is_reverse_charge boolean not null default false,
  is_import boolean not null default false,
  currency text not null default 'INR',
  note text null,
  source text not null default 'csv_upload',
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

create unique index if not exists erp_gst_purchase_invoices_unique_active
  on public.erp_gst_purchase_invoices (company_id, vendor_id, invoice_no, invoice_date)
  where is_void = false;

create index if not exists erp_gst_purchase_invoices_company_invoice_date_idx
  on public.erp_gst_purchase_invoices (company_id, invoice_date);

create index if not exists erp_gst_purchase_invoices_company_vendor_idx
  on public.erp_gst_purchase_invoices (company_id, vendor_id);

create table if not exists public.erp_gst_purchase_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  invoice_id uuid not null references public.erp_gst_purchase_invoices (id) on delete restrict,
  line_no integer not null,
  description text null,
  hsn text not null,
  qty numeric null,
  uom text null,
  taxable_value numeric not null,
  cgst numeric not null default 0,
  sgst numeric not null default 0,
  igst numeric not null default 0,
  cess numeric not null default 0,
  total_tax numeric generated always as (coalesce(cgst, 0) + coalesce(sgst, 0) + coalesce(igst, 0) + coalesce(cess, 0)) stored,
  line_total numeric generated always as (taxable_value + coalesce(cgst, 0) + coalesce(sgst, 0) + coalesce(igst, 0) + coalesce(cess, 0)) stored,
  itc_eligible boolean not null default true,
  itc_reason text null,
  raw_payload jsonb null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_gst_purchase_invoice_lines_unique_active
  on public.erp_gst_purchase_invoice_lines (company_id, invoice_id, line_no)
  where is_void = false;

create index if not exists erp_gst_purchase_invoice_lines_company_hsn_idx
  on public.erp_gst_purchase_invoice_lines (company_id, hsn);

create index if not exists erp_gst_purchase_invoice_lines_company_invoice_idx
  on public.erp_gst_purchase_invoice_lines (company_id, invoice_id);

create table if not exists public.erp_gst_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  source text not null default 'csv_upload',
  filename text null,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

alter table public.erp_gst_purchase_invoices enable row level security;
alter table public.erp_gst_purchase_invoices force row level security;
alter table public.erp_gst_purchase_invoice_lines enable row level security;
alter table public.erp_gst_purchase_invoice_lines force row level security;
alter table public.erp_gst_import_batches enable row level security;
alter table public.erp_gst_import_batches force row level security;

do $$
begin
  drop policy if exists erp_gst_purchase_invoices_select on public.erp_gst_purchase_invoices;
  create policy erp_gst_purchase_invoices_select
    on public.erp_gst_purchase_invoices
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

  drop policy if exists erp_gst_purchase_invoice_lines_select on public.erp_gst_purchase_invoice_lines;
  create policy erp_gst_purchase_invoice_lines_select
    on public.erp_gst_purchase_invoice_lines
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

  drop policy if exists erp_gst_import_batches_select on public.erp_gst_import_batches;
  create policy erp_gst_import_batches_select
    on public.erp_gst_import_batches
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

create or replace function public.erp_gst_purchase_import_csv(
  p_rows jsonb,
  p_filename text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_total_rows integer := 0;
  v_invoices_upserted integer := 0;
  v_lines_upserted integer := 0;
  v_error_count integer := 0;
  v_error_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_idx integer;
  v_vendor_id uuid;
  v_vendor_gstin text;
  v_vendor_name text;
  v_invoice_no text;
  v_invoice_date date;
  v_place_of_supply_state_code text;
  v_is_reverse_charge boolean;
  v_is_import boolean;
  v_description text;
  v_hsn text;
  v_qty numeric;
  v_uom text;
  v_taxable_value numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_cess numeric;
  v_itc_eligible boolean;
  v_itc_reason text;
  v_line_no integer;
  v_invoice_id uuid;
  v_invoice_key text;
  v_batch_id uuid;
  v_row_count integer := coalesce(jsonb_array_length(p_rows), 0);
  v_bool_text text;
  v_line_seen boolean;
  v_max_line integer;
  v_error_reason text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.erp_gst_import_batches (company_id, source, filename, row_count, created_at, created_by)
  values (v_company_id, 'csv_upload', p_filename, v_row_count, now(), v_actor)
  returning id into v_batch_id;

  create temporary table if not exists temp_gst_purchase_line_seq (
    invoice_key text primary key,
    next_line_no integer not null
  ) on commit drop;

  create temporary table if not exists temp_gst_purchase_invoice_seen (
    invoice_key text primary key
  ) on commit drop;

  for v_row, v_idx in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  loop
    v_total_rows := v_total_rows + 1;
    v_error_reason := null;

    begin
      v_vendor_id := null;
      v_vendor_gstin := nullif(trim(coalesce(v_row->>'vendor_gstin', v_row->>'gstin', '')), '');
      v_vendor_name := nullif(trim(coalesce(v_row->>'vendor_name', v_row->>'supplier_name', '')), '');

      if nullif(trim(coalesce(v_row->>'vendor_id', '')), '') is not null then
        begin
          v_vendor_id := nullif(trim(coalesce(v_row->>'vendor_id', '')), '')::uuid;
        exception when others then
          v_error_reason := 'Invalid vendor_id';
        end;
      end if;

      v_invoice_no := nullif(trim(coalesce(v_row->>'invoice_no', '')), '');
      v_invoice_date := nullif(trim(coalesce(v_row->>'invoice_date', '')), '')::date;
      v_place_of_supply_state_code := nullif(trim(coalesce(v_row->>'place_of_supply_state_code', '')), '');
      v_description := nullif(trim(coalesce(v_row->>'description', '')), '');
      v_hsn := nullif(trim(coalesce(v_row->>'hsn', '')), '');
      v_uom := nullif(trim(coalesce(v_row->>'uom', '')), '');
      v_itc_reason := nullif(trim(coalesce(v_row->>'itc_reason', '')), '');

      v_bool_text := lower(nullif(trim(coalesce(v_row->>'is_reverse_charge', '')), ''));
      v_is_reverse_charge := v_bool_text in ('true', 't', 'yes', 'y', '1');
      v_bool_text := lower(nullif(trim(coalesce(v_row->>'is_import', '')), ''));
      v_is_import := v_bool_text in ('true', 't', 'yes', 'y', '1');

      v_bool_text := lower(nullif(trim(coalesce(v_row->>'itc_eligible', '')), ''));
      if v_bool_text is null then
        v_itc_eligible := true;
      else
        v_itc_eligible := v_bool_text in ('true', 't', 'yes', 'y', '1');
      end if;

      v_qty := nullif(trim(coalesce(v_row->>'qty', '')), '')::numeric;
      v_taxable_value := nullif(trim(coalesce(v_row->>'taxable_value', '')), '')::numeric;
      v_cgst := coalesce(nullif(trim(coalesce(v_row->>'cgst', '')), '')::numeric, 0);
      v_sgst := coalesce(nullif(trim(coalesce(v_row->>'sgst', '')), '')::numeric, 0);
      v_igst := coalesce(nullif(trim(coalesce(v_row->>'igst', '')), '')::numeric, 0);
      v_cess := coalesce(nullif(trim(coalesce(v_row->>'cess', '')), '')::numeric, 0);

      if v_invoice_no is null or v_invoice_date is null or v_hsn is null or v_taxable_value is null then
        v_error_reason := 'Missing required fields (invoice_no, invoice_date, hsn, taxable_value)';
      end if;

      if v_vendor_id is null then
        if v_vendor_gstin is null or v_vendor_name is null then
          v_error_reason := coalesce(v_error_reason || '; ', '') || 'Missing vendor_id or vendor_gstin/vendor_name';
        else
          select v.id, v.gstin
            into v_vendor_id, v_vendor_gstin
            from public.erp_vendors v
            where v.company_id = v_company_id
              and v.gstin = v_vendor_gstin
            limit 1;

          if v_vendor_id is null then
            v_error_reason := coalesce(v_error_reason || '; ', '') || 'Vendor not found for gstin';
          end if;
        end if;
      else
        select v.id, v.gstin
          into v_vendor_id, v_vendor_gstin
          from public.erp_vendors v
          where v.company_id = v_company_id
            and v.id = v_vendor_id;

        if v_vendor_id is null then
          v_error_reason := coalesce(v_error_reason || '; ', '') || 'Vendor not found';
        end if;
      end if;

      if v_error_reason is not null then
        raise exception '%', v_error_reason;
      end if;

      v_invoice_key := v_vendor_id::text || '|' || v_invoice_no || '|' || v_invoice_date::text;

      insert into public.erp_gst_purchase_invoices (
        company_id,
        vendor_id,
        vendor_gstin,
        vendor_state_code,
        invoice_no,
        invoice_date,
        place_of_supply_state_code,
        is_reverse_charge,
        is_import,
        currency,
        source,
        source_ref,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_company_id,
        v_vendor_id,
        v_vendor_gstin,
        case
          when v_vendor_gstin ~ '^[0-9]{2}' then left(v_vendor_gstin, 2)
          else null
        end,
        v_invoice_no,
        v_invoice_date,
        v_place_of_supply_state_code,
        coalesce(v_is_reverse_charge, false),
        coalesce(v_is_import, false),
        'INR',
        'csv_upload',
        v_batch_id::text,
        now(),
        v_actor,
        now(),
        v_actor
      )
      on conflict (company_id, vendor_id, invoice_no, invoice_date) where is_void = false
      do update set
        vendor_gstin = excluded.vendor_gstin,
        vendor_state_code = excluded.vendor_state_code,
        place_of_supply_state_code = excluded.place_of_supply_state_code,
        is_reverse_charge = excluded.is_reverse_charge,
        is_import = excluded.is_import,
        source = excluded.source,
        source_ref = excluded.source_ref,
        updated_at = now(),
        updated_by = v_actor
      returning id into v_invoice_id;

      select exists(
        select 1 from temp_gst_purchase_invoice_seen s where s.invoice_key = v_invoice_key
      ) into v_line_seen;

      if not v_line_seen then
        insert into temp_gst_purchase_invoice_seen (invoice_key) values (v_invoice_key);
        v_invoices_upserted := v_invoices_upserted + 1;
      end if;

      v_line_no := null;
      if nullif(trim(coalesce(v_row->>'line_no', '')), '') is not null then
        v_line_no := nullif(trim(coalesce(v_row->>'line_no', '')), '')::integer;
      end if;

      if v_line_no is null then
        select next_line_no into v_line_no
        from temp_gst_purchase_line_seq
        where invoice_key = v_invoice_key;

        if v_line_no is null then
          v_line_no := 1;
          insert into temp_gst_purchase_line_seq (invoice_key, next_line_no)
          values (v_invoice_key, 2);
        else
          update temp_gst_purchase_line_seq
            set next_line_no = next_line_no + 1
            where invoice_key = v_invoice_key;
        end if;
      else
        v_max_line := v_line_no + 1;
        insert into temp_gst_purchase_line_seq (invoice_key, next_line_no)
        values (v_invoice_key, v_max_line)
        on conflict (invoice_key)
        do update set next_line_no = greatest(temp_gst_purchase_line_seq.next_line_no, excluded.next_line_no);
      end if;

      insert into public.erp_gst_purchase_invoice_lines (
        company_id,
        invoice_id,
        line_no,
        description,
        hsn,
        qty,
        uom,
        taxable_value,
        cgst,
        sgst,
        igst,
        cess,
        itc_eligible,
        itc_reason,
        raw_payload,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_company_id,
        v_invoice_id,
        v_line_no,
        v_description,
        v_hsn,
        v_qty,
        v_uom,
        v_taxable_value,
        coalesce(v_cgst, 0),
        coalesce(v_sgst, 0),
        coalesce(v_igst, 0),
        coalesce(v_cess, 0),
        coalesce(v_itc_eligible, true),
        v_itc_reason,
        v_row,
        now(),
        v_actor,
        now(),
        v_actor
      )
      on conflict (company_id, invoice_id, line_no) where is_void = false
      do update set
        description = excluded.description,
        hsn = excluded.hsn,
        qty = excluded.qty,
        uom = excluded.uom,
        taxable_value = excluded.taxable_value,
        cgst = excluded.cgst,
        sgst = excluded.sgst,
        igst = excluded.igst,
        cess = excluded.cess,
        itc_eligible = excluded.itc_eligible,
        itc_reason = excluded.itc_reason,
        raw_payload = excluded.raw_payload,
        updated_at = now(),
        updated_by = v_actor;

      v_lines_upserted := v_lines_upserted + 1;

    exception when others then
      v_error_count := v_error_count + 1;
      if v_error_count <= 50 then
        v_error_rows := v_error_rows || jsonb_build_array(
          jsonb_build_object(
            'row', v_idx,
            'reason', coalesce(v_error_reason, sqlerrm)
          )
        );
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total_rows,
    'invoices_upserted', v_invoices_upserted,
    'lines_upserted', v_lines_upserted,
    'error_count', v_error_count,
    'error_rows', v_error_rows
  );
end;
$$;

create or replace function public.erp_gst_purchase_invoice_void(
  p_invoice_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  update public.erp_gst_purchase_invoices i
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where i.company_id = v_company_id
     and i.id = p_invoice_id;

  update public.erp_gst_purchase_invoice_lines l
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where l.company_id = v_company_id
     and l.invoice_id = p_invoice_id;
end;
$$;

create or replace function public.erp_gst_purchase_invoices_list(
  p_from date,
  p_to date,
  p_vendor_id uuid default null
) returns table (
  invoice_id uuid,
  invoice_no text,
  invoice_date date,
  vendor_id uuid,
  vendor_name text,
  vendor_gstin text,
  taxable_total numeric,
  tax_total numeric,
  itc_total numeric,
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
  select
    i.id as invoice_id,
    i.invoice_no,
    i.invoice_date,
    i.vendor_id,
    v.legal_name as vendor_name,
    i.vendor_gstin,
    coalesce(sum(l.taxable_value), 0) as taxable_total,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0) as tax_total,
    coalesce(sum(case when l.itc_eligible then l.cgst + l.sgst + l.igst + l.cess else 0 end), 0) as itc_total,
    i.is_void
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  left join public.erp_gst_purchase_invoice_lines l
    on l.invoice_id = i.id
    and l.company_id = i.company_id
    and l.is_void = false
  where i.company_id = v_company_id
    and i.invoice_date between p_from and p_to
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  group by i.id, v.legal_name;
end;
$$;

create or replace function public.erp_gst_purchase_invoice_detail(
  p_invoice_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_header jsonb;
  v_lines jsonb;
begin
  perform public.erp_require_finance_reader();

  select jsonb_build_object(
    'id', i.id,
    'invoice_no', i.invoice_no,
    'invoice_date', i.invoice_date,
    'vendor_id', i.vendor_id,
    'vendor_name', v.legal_name,
    'vendor_gstin', i.vendor_gstin,
    'vendor_state_code', i.vendor_state_code,
    'place_of_supply_state_code', i.place_of_supply_state_code,
    'is_reverse_charge', i.is_reverse_charge,
    'is_import', i.is_import,
    'currency', i.currency,
    'note', i.note,
    'source', i.source,
    'source_ref', i.source_ref,
    'is_void', i.is_void,
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into v_header
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  where i.company_id = v_company_id
    and i.id = p_invoice_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'line_no', l.line_no,
        'description', l.description,
        'hsn', l.hsn,
        'qty', l.qty,
        'uom', l.uom,
        'taxable_value', l.taxable_value,
        'cgst', l.cgst,
        'sgst', l.sgst,
        'igst', l.igst,
        'cess', l.cess,
        'total_tax', l.total_tax,
        'line_total', l.line_total,
        'itc_eligible', l.itc_eligible,
        'itc_reason', l.itc_reason,
        'is_void', l.is_void
      )
      order by l.line_no
    ),
    '[]'::jsonb
  )
  into v_lines
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = p_invoice_id
    and l.is_void = false;

  return jsonb_build_object(
    'header', v_header,
    'lines', v_lines
  );
end;
$$;

create or replace function public.erp_gst_purchase_register_export(
  p_from date,
  p_to date
) returns table (
  invoice_date date,
  invoice_no text,
  vendor_name text,
  vendor_gstin text,
  place_of_supply_state_code text,
  is_reverse_charge boolean,
  is_import boolean,
  taxable_total numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric,
  tax_total numeric,
  itc_eligible_tax numeric,
  invoice_total numeric
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
  select
    i.invoice_date,
    i.invoice_no,
    v.legal_name as vendor_name,
    i.vendor_gstin,
    i.place_of_supply_state_code,
    i.is_reverse_charge,
    i.is_import,
    coalesce(sum(l.taxable_value), 0) as taxable_total,
    coalesce(sum(l.cgst), 0) as cgst,
    coalesce(sum(l.sgst), 0) as sgst,
    coalesce(sum(l.igst), 0) as igst,
    coalesce(sum(l.cess), 0) as cess,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0) as tax_total,
    coalesce(sum(case when l.itc_eligible then l.cgst + l.sgst + l.igst + l.cess else 0 end), 0) as itc_eligible_tax,
    coalesce(sum(l.taxable_value + l.cgst + l.sgst + l.igst + l.cess), 0) as invoice_total
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  join public.erp_gst_purchase_invoice_lines l
    on l.invoice_id = i.id
    and l.company_id = i.company_id
    and l.is_void = false
  where i.company_id = v_company_id
    and i.is_void = false
    and i.invoice_date between p_from and p_to
  group by i.id, v.legal_name;
end;
$$;

create or replace function public.erp_gst_purchase_hsn_summary_export(
  p_from date,
  p_to date
) returns table (
  hsn text,
  qty numeric,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric
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
  select
    l.hsn,
    coalesce(sum(l.qty), 0) as qty,
    coalesce(sum(l.taxable_value), 0) as taxable_value,
    coalesce(sum(l.cgst), 0) as cgst,
    coalesce(sum(l.sgst), 0) as sgst,
    coalesce(sum(l.igst), 0) as igst,
    coalesce(sum(l.cess), 0) as cess
  from public.erp_gst_purchase_invoice_lines l
  join public.erp_gst_purchase_invoices i
    on i.id = l.invoice_id
    and i.company_id = l.company_id
  where l.company_id = v_company_id
    and l.is_void = false
    and i.is_void = false
    and i.invoice_date between p_from and p_to
  group by l.hsn
  order by l.hsn;
end;
$$;

create or replace function public.erp_gst_purchase_itc_summary_export(
  p_from date,
  p_to date
) returns table (
  eligible_tax numeric,
  ineligible_tax numeric,
  total_tax numeric,
  eligible_cgst numeric,
  eligible_sgst numeric,
  eligible_igst numeric,
  eligible_cess numeric,
  ineligible_cgst numeric,
  ineligible_sgst numeric,
  ineligible_igst numeric,
  ineligible_cess numeric
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
  select
    coalesce(sum(case when l.itc_eligible then l.cgst + l.sgst + l.igst + l.cess else 0 end), 0) as eligible_tax,
    coalesce(sum(case when not l.itc_eligible then l.cgst + l.sgst + l.igst + l.cess else 0 end), 0) as ineligible_tax,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0) as total_tax,
    coalesce(sum(case when l.itc_eligible then l.cgst else 0 end), 0) as eligible_cgst,
    coalesce(sum(case when l.itc_eligible then l.sgst else 0 end), 0) as eligible_sgst,
    coalesce(sum(case when l.itc_eligible then l.igst else 0 end), 0) as eligible_igst,
    coalesce(sum(case when l.itc_eligible then l.cess else 0 end), 0) as eligible_cess,
    coalesce(sum(case when not l.itc_eligible then l.cgst else 0 end), 0) as ineligible_cgst,
    coalesce(sum(case when not l.itc_eligible then l.sgst else 0 end), 0) as ineligible_sgst,
    coalesce(sum(case when not l.itc_eligible then l.igst else 0 end), 0) as ineligible_igst,
    coalesce(sum(case when not l.itc_eligible then l.cess else 0 end), 0) as ineligible_cess
  from public.erp_gst_purchase_invoice_lines l
  join public.erp_gst_purchase_invoices i
    on i.id = l.invoice_id
    and i.company_id = l.company_id
  where l.company_id = v_company_id
    and l.is_void = false
    and i.is_void = false
    and i.invoice_date between p_from and p_to;
end;
$$;

revoke all on function public.erp_gst_purchase_import_csv(jsonb, text) from public;
revoke all on function public.erp_gst_purchase_import_csv(jsonb, text) from authenticated;
grant execute on function public.erp_gst_purchase_import_csv(jsonb, text) to authenticated;

revoke all on function public.erp_gst_purchase_invoice_void(uuid, text) from public;
revoke all on function public.erp_gst_purchase_invoice_void(uuid, text) from authenticated;
grant execute on function public.erp_gst_purchase_invoice_void(uuid, text) to authenticated;

revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid) from public;
revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid) from authenticated;
grant execute on function public.erp_gst_purchase_invoices_list(date, date, uuid) to authenticated;

revoke all on function public.erp_gst_purchase_invoice_detail(uuid) from public;
revoke all on function public.erp_gst_purchase_invoice_detail(uuid) from authenticated;
grant execute on function public.erp_gst_purchase_invoice_detail(uuid) to authenticated;

revoke all on function public.erp_gst_purchase_register_export(date, date) from public;
revoke all on function public.erp_gst_purchase_register_export(date, date) from authenticated;
grant execute on function public.erp_gst_purchase_register_export(date, date) to authenticated;

revoke all on function public.erp_gst_purchase_hsn_summary_export(date, date) from public;
revoke all on function public.erp_gst_purchase_hsn_summary_export(date, date) from authenticated;
grant execute on function public.erp_gst_purchase_hsn_summary_export(date, date) to authenticated;

revoke all on function public.erp_gst_purchase_itc_summary_export(date, date) from public;
revoke all on function public.erp_gst_purchase_itc_summary_export(date, date) from authenticated;
grant execute on function public.erp_gst_purchase_itc_summary_export(date, date) to authenticated;
