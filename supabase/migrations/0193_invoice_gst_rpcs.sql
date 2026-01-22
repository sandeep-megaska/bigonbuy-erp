-- Invoice GST enhancements

alter table public.erp_companies
  add column if not exists gst_state_code text,
  add column if not exists gst_state_name text;

create or replace function public.erp_company_gst_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_row record;
begin
  perform public.erp_require_company_user();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select c.gst_state_code, c.gst_state_name
    into v_row
    from public.erp_companies c
    where c.id = v_company_id;

  return jsonb_build_object(
    'gst_state_code', v_row.gst_state_code,
    'gst_state_name', v_row.gst_state_name
  );
end;
$$;

revoke all on function public.erp_company_gst_state() from public;
grant execute on function public.erp_company_gst_state() to authenticated;

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
  v_place_of_supply_state_code text := nullif(p_invoice->>'place_of_supply_state_code', '');
  v_place_of_supply_state_name text := nullif(p_invoice->>'place_of_supply_state_name', '');
  v_currency text := coalesce(nullif(p_invoice->>'currency', ''), 'INR');
  v_billing_address_line1 text := nullif(p_invoice->>'billing_address_line1', '');
  v_billing_address_line2 text := nullif(p_invoice->>'billing_address_line2', '');
  v_billing_city text := nullif(p_invoice->>'billing_city', '');
  v_billing_state text := nullif(p_invoice->>'billing_state', '');
  v_billing_state_code text := nullif(p_invoice->>'billing_state_code', '');
  v_billing_state_name text := nullif(p_invoice->>'billing_state_name', '');
  v_billing_pincode text := nullif(p_invoice->>'billing_pincode', '');
  v_billing_country text := nullif(p_invoice->>'billing_country', '');
  v_shipping_address_line1 text := nullif(p_invoice->>'shipping_address_line1', '');
  v_shipping_address_line2 text := nullif(p_invoice->>'shipping_address_line2', '');
  v_shipping_city text := nullif(p_invoice->>'shipping_city', '');
  v_shipping_state text := nullif(p_invoice->>'shipping_state', '');
  v_shipping_state_code text := nullif(p_invoice->>'shipping_state_code', '');
  v_shipping_state_name text := nullif(p_invoice->>'shipping_state_name', '');
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
           place_of_supply_state_code = v_place_of_supply_state_code,
           place_of_supply_state_name = v_place_of_supply_state_name,
           billing_address_line1 = nullif(trim(coalesce(v_billing_address_line1, '')), ''),
           billing_address_line2 = nullif(trim(coalesce(v_billing_address_line2, '')), ''),
           billing_city = nullif(trim(coalesce(v_billing_city, '')), ''),
           billing_state = nullif(trim(coalesce(v_billing_state, '')), ''),
           billing_state_code = v_billing_state_code,
           billing_state_name = v_billing_state_name,
           billing_pincode = nullif(trim(coalesce(v_billing_pincode, '')), ''),
           billing_country = nullif(trim(coalesce(v_billing_country, '')), ''),
           shipping_address_line1 = nullif(trim(coalesce(v_shipping_address_line1, '')), ''),
           shipping_address_line2 = nullif(trim(coalesce(v_shipping_address_line2, '')), ''),
           shipping_city = nullif(trim(coalesce(v_shipping_city, '')), ''),
           shipping_state = nullif(trim(coalesce(v_shipping_state, '')), ''),
           shipping_state_code = v_shipping_state_code,
           shipping_state_name = v_shipping_state_name,
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
      place_of_supply_state_code,
      place_of_supply_state_name,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_state,
      billing_state_code,
      billing_state_name,
      billing_pincode,
      billing_country,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_state,
      shipping_state_code,
      shipping_state_name,
      shipping_pincode,
      shipping_country,
      currency
    ) values (
      v_company_id,
      v_invoice_date,
      trim(v_customer_name),
      nullif(trim(coalesce(v_customer_gstin, '')), ''),
      trim(v_place_of_supply),
      v_place_of_supply_state_code,
      v_place_of_supply_state_name,
      nullif(trim(coalesce(v_billing_address_line1, '')), ''),
      nullif(trim(coalesce(v_billing_address_line2, '')), ''),
      nullif(trim(coalesce(v_billing_city, '')), ''),
      nullif(trim(coalesce(v_billing_state, '')), ''),
      v_billing_state_code,
      v_billing_state_name,
      nullif(trim(coalesce(v_billing_pincode, '')), ''),
      nullif(trim(coalesce(v_billing_country, '')), ''),
      nullif(trim(coalesce(v_shipping_address_line1, '')), ''),
      nullif(trim(coalesce(v_shipping_address_line2, '')), ''),
      nullif(trim(coalesce(v_shipping_city, '')), ''),
      nullif(trim(coalesce(v_shipping_state, '')), ''),
      v_shipping_state_code,
      v_shipping_state_name,
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
  v_discount_percent numeric := coalesce(nullif(p_line->>'discount_percent', '')::numeric, 0);
  v_tax_percent numeric := coalesce(nullif(p_line->>'tax_percent', '')::numeric, 0);
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
           discount_percent = v_discount_percent,
           tax_percent = v_tax_percent,
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
        discount_percent,
        tax_percent
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
        v_discount_percent,
        v_tax_percent
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
             discount_percent = v_discount_percent,
             tax_percent = v_tax_percent,
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
  v_status text;
  v_place_of_supply_code text;
  v_company_state_code text;
  v_is_inter_state boolean;
  v_taxable_amount numeric(12,2) := 0;
  v_cgst_amount numeric(12,2) := 0;
  v_sgst_amount numeric(12,2) := 0;
  v_igst_amount numeric(12,2) := 0;
  v_gst_amount numeric(12,2) := 0;
  v_total_amount numeric(12,2) := 0;
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  rec record;
  v_line_taxable numeric(12,2);
  v_line_gst numeric(12,2);
  v_line_cgst numeric(12,2);
  v_line_sgst numeric(12,2);
  v_line_igst numeric(12,2);
  v_line_total numeric(12,2);
  v_line_discount numeric(12,2);
  v_line_gross numeric(12,2);
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status, place_of_supply_state_code
    into v_status, v_place_of_supply_code
    from public.erp_invoices
    where id = p_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft invoices can be recomputed';
  end if;

  select nullif(trim(coalesce(c.gst_state_code, '')), '')
    into v_company_state_code
    from public.erp_companies c
    where c.id = v_company_id;

  if v_company_state_code is null then
    raise exception 'Company GST state code is required';
  end if;

  if v_place_of_supply_code is null then
    raise exception 'Place of supply state code is required';
  end if;

  v_is_inter_state := v_company_state_code <> v_place_of_supply_code;

  for rec in
    select id, qty, unit_rate, discount_percent, tax_percent
      from public.erp_invoice_lines
      where invoice_id = p_invoice_id
      order by line_no
  loop
    v_line_gross := round(coalesce(rec.qty, 0) * coalesce(rec.unit_rate, 0), 2);
    v_line_discount := round(v_line_gross * (coalesce(rec.discount_percent, 0) / 100), 2);
    v_line_taxable := round(v_line_gross - v_line_discount, 2);
    v_line_gst := round(v_line_taxable * (coalesce(rec.tax_percent, 0) / 100), 2);

    if v_is_inter_state then
      v_line_igst := v_line_gst;
      v_line_cgst := 0;
      v_line_sgst := 0;
    else
      v_line_cgst := round(v_line_gst / 2, 2);
      v_line_sgst := round(v_line_gst - v_line_cgst, 2);
      v_line_igst := 0;
    end if;

    v_line_total := round(v_line_taxable + v_line_gst, 2);

    update public.erp_invoice_lines
       set line_subtotal = v_line_gross,
           line_tax = v_line_gst,
           taxable_amount = v_line_taxable,
           cgst_amount = v_line_cgst,
           sgst_amount = v_line_sgst,
           igst_amount = v_line_igst,
           line_total = v_line_total,
           updated_at = now()
     where id = rec.id;

    v_taxable_amount := v_taxable_amount + v_line_taxable;
    v_cgst_amount := v_cgst_amount + v_line_cgst;
    v_sgst_amount := v_sgst_amount + v_line_sgst;
    v_igst_amount := v_igst_amount + v_line_igst;
    v_gst_amount := v_gst_amount + v_line_gst;
    v_total_amount := v_total_amount + v_line_total;
  end loop;

  v_taxable_amount := round(v_taxable_amount, 2);
  v_cgst_amount := round(v_cgst_amount, 2);
  v_sgst_amount := round(v_sgst_amount, 2);
  v_igst_amount := round(v_igst_amount, 2);
  v_gst_amount := round(v_gst_amount, 2);
  v_total_amount := round(v_total_amount, 2);

  v_subtotal := v_taxable_amount;
  v_tax_total := v_gst_amount;
  v_total := v_total_amount;

  update public.erp_invoices
     set taxable_amount = v_taxable_amount,
         cgst_amount = v_cgst_amount,
         sgst_amount = v_sgst_amount,
         igst_amount = v_igst_amount,
         gst_amount = v_gst_amount,
         total_amount = v_total_amount,
         subtotal = v_subtotal,
         tax_total = v_tax_total,
         total = v_total,
         is_inter_state = v_is_inter_state,
         updated_at = now()
   where id = p_invoice_id
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok', true,
    'taxable_amount', v_taxable_amount,
    'cgst_amount', v_cgst_amount,
    'sgst_amount', v_sgst_amount,
    'igst_amount', v_igst_amount,
    'gst_amount', v_gst_amount,
    'total_amount', v_total_amount,
    'is_inter_state', v_is_inter_state
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
  v_place_of_supply_code text;
  v_fiscal_year text;
  v_doc_seq int;
  v_gst_state_code text;
  v_total_amount numeric(12,2);
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select doc_no, status, invoice_date, customer_name, place_of_supply, place_of_supply_state_code, total_amount
    into v_doc_no, v_status, v_invoice_date, v_customer_name, v_place_of_supply, v_place_of_supply_code, v_total_amount
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

  if v_place_of_supply_code is null then
    raise exception 'Place of supply state code is required';
  end if;

  select nullif(trim(coalesce(c.gst_state_code, '')), '')
    into v_gst_state_code
    from public.erp_companies c
    where c.id = v_company_id;

  if v_gst_state_code is null then
    raise exception 'Company GST state code is required';
  end if;

  if coalesce(v_total_amount, 0) <= 0 then
    raise exception 'Invoice totals must be computed';
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
