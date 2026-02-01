-- 0353_post_gst_purchase_invoices.sql
-- Post GST purchase invoices to finance journals

create or replace function public.erp_gst_purchase_invoice_post(
  p_invoice_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_inv record;
  v_journal_id uuid;
  v_doc_no text;
  v_inventory record;
  v_cgst_account record;
  v_sgst_account record;
  v_igst_account record;
  v_vendor_payable record;
  v_tds_payable record;
  v_subtotal numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_cess numeric := 0;
  v_gst_total numeric := 0;
  v_total numeric := 0;
  v_tds_rate numeric := 0;
  v_tds_amount numeric := 0;
  v_net_payable numeric := 0;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_igst_total numeric := 0;
  v_role_id uuid;
begin
  perform public.erp_require_finance_writer();

  select *
    into v_inv
    from public.erp_gst_purchase_invoices
    where company_id = v_company_id
      and id = p_invoice_id
    for update;

  if v_inv.id is null then
    raise exception 'GST purchase invoice not found';
  end if;

  if v_inv.is_void or v_inv.status = 'void' then
    raise exception 'Invoice is void';
  end if;

  if v_inv.finance_journal_id is not null or v_inv.status = 'posted' then
    if v_inv.finance_journal_id is not null then
      select j.doc_no
        into v_doc_no
        from public.erp_fin_journals j
        where j.id = v_inv.finance_journal_id
          and j.company_id = v_company_id;
    end if;

    return jsonb_build_object(
      'invoice_id', v_inv.id,
      'finance_journal_id', v_inv.finance_journal_id,
      'journal_doc_no', v_doc_no
    );
  end if;

  if v_inv.status <> 'draft' then
    raise exception 'Only draft invoices can be posted';
  end if;

  if v_inv.vendor_id is null then
    raise exception 'Vendor is required';
  end if;

  select
    coalesce(sum(l.taxable_value), 0) as subtotal,
    coalesce(sum(l.cgst), 0) as cgst,
    coalesce(sum(l.sgst), 0) as sgst,
    coalesce(sum(l.igst), 0) as igst,
    coalesce(sum(l.cess), 0) as cess
  into v_subtotal, v_cgst, v_sgst, v_igst, v_cess
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = v_inv.id
    and l.is_void = false;

  v_gst_total := v_cgst + v_sgst + v_igst + v_cess;
  v_total := round(v_subtotal + v_gst_total, 2);
  v_tds_rate := coalesce(v_inv.tds_rate, 0);
  v_tds_amount := coalesce(v_inv.tds_amount, 0);

  if v_tds_amount = 0 and v_tds_rate > 0 then
    v_tds_amount := round(v_subtotal * v_tds_rate / 100, 2);
  end if;

  v_net_payable := round(v_total - v_tds_amount, 2);

  v_role_id := public.erp_fin_account_by_role('inventory_asset');
  select id, code, name into v_inventory from public.erp_gl_accounts a where a.id = v_role_id;

  if v_cgst > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_cgst');
    select id, code, name into v_cgst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  if v_sgst > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_sgst');
    select id, code, name into v_sgst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  v_igst_total := v_igst + v_cess;
  if v_igst_total > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_igst');
    select id, code, name into v_igst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_vendor_payable from public.erp_gl_accounts a where a.id = v_role_id;

  if v_tds_amount > 0 then
    v_role_id := public.erp_fin_account_by_role('tds_payable');
    select id, code, name into v_tds_payable from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    v_inv.invoice_date,
    'posted',
    format('GST purchase invoice %s', v_inv.invoice_no),
    'vendor_bill',
    v_inv.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  if v_subtotal <> 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_inventory.code,
      v_inventory.name,
      'Inventory purchase',
      v_subtotal,
      0
    );

    v_total_debit := v_total_debit + v_subtotal;
    v_line_no := v_line_no + 1;
  end if;

  if v_cgst > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_cgst_account.code,
      v_cgst_account.name,
      'Input GST - CGST',
      v_cgst,
      0
    );

    v_total_debit := v_total_debit + v_cgst;
    v_line_no := v_line_no + 1;
  end if;

  if v_sgst > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_sgst_account.code,
      v_sgst_account.name,
      'Input GST - SGST',
      v_sgst,
      0
    );

    v_total_debit := v_total_debit + v_sgst;
    v_line_no := v_line_no + 1;
  end if;

  if v_igst_total > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_igst_account.code,
      v_igst_account.name,
      'Input GST - IGST',
      v_igst_total,
      0
    );

    v_total_debit := v_total_debit + v_igst_total;
    v_line_no := v_line_no + 1;
  end if;

  if v_net_payable <> 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_vendor_payable.code,
      v_vendor_payable.name,
      'Vendor payable',
      0,
      v_net_payable
    );

    v_total_credit := v_total_credit + v_net_payable;
    v_line_no := v_line_no + 1;
  end if;

  if v_tds_amount > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_tds_payable.code,
      v_tds_payable.name,
      'TDS payable',
      0,
      v_tds_amount
    );

    v_total_credit := v_total_credit + v_tds_amount;
    v_line_no := v_line_no + 1;
  end if;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must be balanced';
  end if;

  update public.erp_fin_journals
     set total_debit = v_total_debit,
         total_credit = v_total_credit
   where id = v_journal_id
     and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
     set doc_no = v_doc_no
   where id = v_journal_id
     and company_id = v_company_id;

  update public.erp_gst_purchase_invoices
     set status = 'posted',
         finance_journal_id = v_journal_id,
         subtotal = v_subtotal,
         gst_total = v_gst_total,
         total = v_total,
         tds_rate = v_tds_rate,
         tds_amount = v_tds_amount,
         net_payable = v_net_payable,
         updated_at = now(),
         updated_by = v_actor
   where id = v_inv.id
     and company_id = v_company_id;

  return jsonb_build_object(
    'invoice_id', v_inv.id,
    'finance_journal_id', v_journal_id,
    'journal_doc_no', v_doc_no
  );
end;
$$;

revoke all on function public.erp_gst_purchase_invoice_post(uuid) from public;
grant execute on function public.erp_gst_purchase_invoice_post(uuid) to authenticated;

------------------------------------------------------------
-- GST Purchase Invoices: List (adds status column)
-- IMPORTANT: Return type changed -> must DROP + CREATE
------------------------------------------------------------

drop function if exists public.erp_gst_purchase_invoices_list(
  date, date, uuid, text
);

create function public.erp_gst_purchase_invoices_list(
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
  validation_status text,
  status text
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
    coalesce(sum(l.taxable_value), 0::numeric) as taxable_total,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0::numeric) as tax_total,
    coalesce(
      sum(
        case
          when l.itc_eligible then (l.cgst + l.sgst + l.igst + l.cess)
          else 0::numeric
        end
      ),
      0::numeric
    ) as itc_total,
    i.is_void,
    i.validation_status,
    i.status
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v
    on v.id = i.vendor_id
    and v.company_id = i.company_id
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

revoke all on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) from public;
grant execute on function public.erp_gst_purchase_invoices_list(date, date, uuid, text) to authenticated;


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
    'status', i.status,
    'finance_journal_id', i.finance_journal_id,
    'journal_doc_no', j.doc_no,
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
  left join public.erp_fin_journals j
    on j.id = i.finance_journal_id
    and j.company_id = i.company_id
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
