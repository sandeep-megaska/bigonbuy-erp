-- GST Purchase Engine (Phase 2B)

alter table public.erp_gst_purchase_invoices
  add column if not exists validation_status text not null default 'ok',
  add column if not exists validation_notes jsonb not null default '{}'::jsonb,
  add column if not exists computed_taxable numeric not null default 0,
  add column if not exists computed_cgst numeric not null default 0,
  add column if not exists computed_sgst numeric not null default 0,
  add column if not exists computed_igst numeric not null default 0,
  add column if not exists computed_cess numeric not null default 0,
  add column if not exists computed_total_tax numeric not null default 0,
  add column if not exists computed_invoice_total numeric not null default 0;

alter table public.erp_gst_purchase_invoices
  drop constraint if exists erp_gst_purchase_invoices_validation_status_check;

alter table public.erp_gst_purchase_invoices
  add constraint erp_gst_purchase_invoices_validation_status_check
  check (validation_status in ('ok', 'warn', 'error'));

create index if not exists erp_gst_purchase_invoices_company_date_validation_idx
  on public.erp_gst_purchase_invoices (company_id, invoice_date, validation_status);

create or replace function public.erp_gst_purchase_invoice_validate(
  p_invoice_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_vendor_state_code text;
  v_vendor_gstin text;
  v_taxable_sum numeric := 0;
  v_cgst_sum numeric := 0;
  v_sgst_sum numeric := 0;
  v_igst_sum numeric := 0;
  v_cess_sum numeric := 0;
  v_total_tax numeric := 0;
  v_invoice_total numeric := 0;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_has_negative boolean := false;
  v_has_bad_hsn boolean := false;
  v_status text := 'ok';
  v_notes jsonb := '{}'::jsonb;
  v_has_cgst boolean;
  v_has_sgst boolean;
  v_has_igst boolean;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select i.vendor_state_code, i.vendor_gstin
    into v_vendor_state_code, v_vendor_gstin
    from public.erp_gst_purchase_invoices i
    where i.company_id = v_company_id
      and i.id = p_invoice_id;

  if not found then
    raise exception 'Invoice not found';
  end if;

  select
    coalesce(sum(l.taxable_value), 0),
    coalesce(sum(l.cgst), 0),
    coalesce(sum(l.sgst), 0),
    coalesce(sum(l.igst), 0),
    coalesce(sum(l.cess), 0)
  into v_taxable_sum, v_cgst_sum, v_sgst_sum, v_igst_sum, v_cess_sum
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = p_invoice_id
    and l.is_void = false;

  v_total_tax := v_cgst_sum + v_sgst_sum + v_igst_sum + v_cess_sum;
  v_invoice_total := v_taxable_sum + v_total_tax;

  select exists(
    select 1
    from public.erp_gst_purchase_invoice_lines l
    where l.company_id = v_company_id
      and l.invoice_id = p_invoice_id
      and l.is_void = false
      and (
        l.taxable_value < 0
        or l.cgst < 0
        or l.sgst < 0
        or l.igst < 0
        or l.cess < 0
      )
  ) into v_has_negative;

  if v_has_negative then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object(
        'code', 'negative_values',
        'message', 'Negative values found on invoice lines.'
      )
    );
  end if;

  if v_vendor_gstin is not null
    and (
      length(trim(v_vendor_gstin)) <> 15
      or v_vendor_gstin !~ '^[0-9]{2}'
    )
  then
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'gstin_format',
        'message', 'Vendor GSTIN format appears invalid.'
      )
    );
  end if;

  v_has_igst := v_igst_sum > 0;
  v_has_cgst := v_cgst_sum > 0;
  v_has_sgst := v_sgst_sum > 0;

  if v_has_igst and (v_has_cgst or v_has_sgst) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object(
        'code', 'tax_split_mixed',
        'message', 'IGST cannot be combined with CGST or SGST.'
      )
    );
  end if;

  if (v_has_cgst and not v_has_sgst) or (v_has_sgst and not v_has_cgst) then
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object(
        'code', 'tax_split_missing',
        'message', 'CGST and SGST must both be present for intra-state invoices.'
      )
    );
  end if;

  if v_vendor_state_code is not null then
    if v_vendor_state_code = 'RJ' and v_has_igst then
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'code', 'interstate_expected_cgst_sgst',
          'message', 'Vendor is in RJ; expected CGST/SGST instead of IGST.'
        )
      );
    end if;

    if v_vendor_state_code <> 'RJ' and (v_has_cgst or v_has_sgst) then
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'code', 'interstate_expected_igst',
          'message', 'Vendor is outside RJ; expected IGST instead of CGST/SGST.'
        )
      );
    end if;
  end if;

  select exists(
    select 1
    from public.erp_gst_purchase_invoice_lines l
    where l.company_id = v_company_id
      and l.invoice_id = p_invoice_id
      and l.is_void = false
      and (
        l.hsn !~ '^[0-9]+$'
        or char_length(l.hsn) not in (4, 6, 8)
      )
  ) into v_has_bad_hsn;

  if v_has_bad_hsn then
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'hsn_format',
        'message', 'Some HSN codes are not 4/6/8 digits.'
      )
    );
  end if;

  if jsonb_array_length(v_errors) > 0 then
    v_status := 'error';
  elsif jsonb_array_length(v_warnings) > 0 then
    v_status := 'warn';
  else
    v_status := 'ok';
  end if;

  v_notes := jsonb_build_object(
    'errors', v_errors,
    'warnings', v_warnings
  );

  update public.erp_gst_purchase_invoices i
     set validation_status = v_status,
         validation_notes = v_notes,
         computed_taxable = v_taxable_sum,
         computed_cgst = v_cgst_sum,
         computed_sgst = v_sgst_sum,
         computed_igst = v_igst_sum,
         computed_cess = v_cess_sum,
         computed_total_tax = v_total_tax,
         computed_invoice_total = v_invoice_total,
         updated_at = now(),
         updated_by = v_actor
   where i.company_id = v_company_id
     and i.id = p_invoice_id;

  return jsonb_build_object(
    'status', v_status,
    'notes', v_notes,
    'computed_taxable', v_taxable_sum,
    'computed_cgst', v_cgst_sum,
    'computed_sgst', v_sgst_sum,
    'computed_igst', v_igst_sum,
    'computed_cess', v_cess_sum,
    'computed_total_tax', v_total_tax,
    'computed_invoice_total', v_invoice_total
  );
end;
$$;

create or replace function public.erp_gst_purchase_validate_range(
  p_from date,
  p_to date,
  p_vendor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_total integer := 0;
  v_ok integer := 0;
  v_warn integer := 0;
  v_error integer := 0;
  v_invoice_id uuid;
  v_result jsonb;
  v_status text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  for v_invoice_id in
    select i.id
      from public.erp_gst_purchase_invoices i
      where i.company_id = v_company_id
        and i.is_void = false
        and i.invoice_date between p_from and p_to
        and (p_vendor_id is null or i.vendor_id = p_vendor_id)
  loop
    v_total := v_total + 1;
    v_result := public.erp_gst_purchase_invoice_validate(v_invoice_id);
    v_status := coalesce(v_result->>'status', 'ok');

    if v_status = 'error' then
      v_error := v_error + 1;
    elsif v_status = 'warn' then
      v_warn := v_warn + 1;
    else
      v_ok := v_ok + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'ok', v_ok,
    'warn', v_warn,
    'error', v_error
  );
end;
$$;

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
  v_invoices_ok integer := 0;
  v_invoices_warn integer := 0;
  v_invoices_error integer := 0;
  v_error_invoices jsonb := '[]'::jsonb;
  v_validate jsonb;
  v_status text;
  v_reason text;
  v_vendor_label text;
  v_note jsonb;
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
    invoice_key text primary key,
    invoice_id uuid not null,
    invoice_no text not null,
    vendor_id uuid not null
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
        insert into temp_gst_purchase_invoice_seen (invoice_key, invoice_id, invoice_no, vendor_id)
        values (v_invoice_key, v_invoice_id, v_invoice_no, v_vendor_id);
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

  for v_invoice_id, v_invoice_no, v_vendor_id in
    select invoice_id, invoice_no, vendor_id
      from temp_gst_purchase_invoice_seen
  loop
    v_validate := public.erp_gst_purchase_invoice_validate(v_invoice_id);
    v_status := coalesce(v_validate->>'status', 'ok');
    v_note := v_validate->'notes';
    v_reason := null;

    if v_note ? 'errors' then
      v_reason := nullif(trim(coalesce(v_note->'errors'->0->>'message', '')), '');
    end if;

    if v_reason is null and v_note ? 'warnings' then
      v_reason := nullif(trim(coalesce(v_note->'warnings'->0->>'message', '')), '');
    end if;

    select v.legal_name into v_vendor_label
      from public.erp_vendors v
      where v.id = v_vendor_id;

    if v_status = 'error' then
      perform public.erp_gst_purchase_invoice_void(v_invoice_id, 'Import validation failed');
      v_invoices_error := v_invoices_error + 1;

      if jsonb_array_length(v_error_invoices) < 50 then
        v_error_invoices := v_error_invoices || jsonb_build_array(
          jsonb_build_object(
            'invoice_no', v_invoice_no,
            'vendor_name', v_vendor_label,
            'reason', coalesce(v_reason, 'Validation error')
          )
        );
      end if;
    elsif v_status = 'warn' then
      v_invoices_warn := v_invoices_warn + 1;
    else
      v_invoices_ok := v_invoices_ok + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total_rows,
    'invoices_upserted', v_invoices_upserted,
    'lines_upserted', v_lines_upserted,
    'error_count', v_error_count,
    'error_rows', v_error_rows,
    'invoices_ok', v_invoices_ok,
    'invoices_warn', v_invoices_warn,
    'invoices_error', v_invoices_error,
    'error_invoices', v_error_invoices
  );
end;
$$;

create or replace function public.erp_gst_purchase_invoices_list(
  p_from date,
  p_to date,
  p_vendor_id uuid default null,
  p_validation_status text default null
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
  is_void boolean,
  validation_status text
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
    i.is_void,
    i.validation_status
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  left join public.erp_gst_purchase_invoice_lines l
    on l.invoice_id = i.id
    and l.company_id = i.company_id
    and l.is_void = false
  where i.company_id = v_company_id
    and i.invoice_date between p_from and p_to
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    and (p_validation_status is null or i.validation_status = p_validation_status)
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
    'validation_status', i.validation_status,
    'validation_notes', i.validation_notes,
    'computed_taxable', i.computed_taxable,
    'computed_total_tax', i.computed_total_tax,
    'computed_invoice_total', i.computed_invoice_total,
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
  invoice_total numeric,
  validation_status text,
  validation_notes_summary text
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
    coalesce(sum(l.taxable_value + l.cgst + l.sgst + l.igst + l.cess), 0) as invoice_total,
    i.validation_status,
    nullif(
      trim(
        concat_ws(
          '; ',
          (
            select string_agg(note->>'message', '; ')
            from jsonb_array_elements(coalesce(i.validation_notes->'errors', '[]'::jsonb)) as note
          ),
          (
            select string_agg(note->>'message', '; ')
            from jsonb_array_elements(coalesce(i.validation_notes->'warnings', '[]'::jsonb)) as note
          )
        )
      ),
      ''
    ) as validation_notes_summary
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

revoke all on function public.erp_gst_purchase_invoice_validate(uuid) from public;
revoke all on function public.erp_gst_purchase_invoice_validate(uuid) from authenticated;
grant execute on function public.erp_gst_purchase_invoice_validate(uuid) to authenticated;

revoke all on function public.erp_gst_purchase_validate_range(date, date, uuid) from public;
revoke all on function public.erp_gst_purchase_validate_range(date, date, uuid) from authenticated;
grant execute on function public.erp_gst_purchase_validate_range(date, date, uuid) to authenticated;

revoke all on function public.erp_gst_purchase_import_csv(jsonb, text) from public;
revoke all on function public.erp_gst_purchase_import_csv(jsonb, text) from authenticated;
grant execute on function public.erp_gst_purchase_import_csv(jsonb, text) to authenticated;

revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) from public;
revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) from authenticated;
grant execute on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) to authenticated;

revoke all on function public.erp_gst_purchase_invoice_detail(uuid) from public;
revoke all on function public.erp_gst_purchase_invoice_detail(uuid) from authenticated;
grant execute on function public.erp_gst_purchase_invoice_detail(uuid) to authenticated;

revoke all on function public.erp_gst_purchase_register_export(date, date) from public;
revoke all on function public.erp_gst_purchase_register_export(date, date) from authenticated;
grant execute on function public.erp_gst_purchase_register_export(date, date) to authenticated;
