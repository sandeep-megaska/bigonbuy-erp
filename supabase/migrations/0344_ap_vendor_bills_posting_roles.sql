-- 0344_ap_vendor_bills_posting_roles.sql
-- Update AP vendor bill + advances posting to use COA control roles

create or replace function public.erp_ap_vendor_bill_recalc(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill record;
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
begin
  perform public.erp_require_finance_writer();

  select i.*
    into v_bill
    from public.erp_gst_purchase_invoices i
    where i.company_id = v_company_id
      and i.id = p_bill_id
    for update;

  if v_bill.id is null then
    raise exception 'Vendor bill not found';
  end if;

  select
    coalesce(sum(l.taxable_value), 0),
    coalesce(sum(l.cgst), 0),
    coalesce(sum(l.sgst), 0),
    coalesce(sum(l.igst), 0),
    coalesce(sum(l.cess), 0)
  into v_subtotal, v_cgst, v_sgst, v_igst, v_cess
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = v_bill.id
    and l.is_void = false;

  v_gst_total := coalesce(v_cgst, 0) + coalesce(v_sgst, 0) + coalesce(v_igst, 0) + coalesce(v_cess, 0);
  v_total := round(v_subtotal + v_gst_total, 2);
  v_tds_rate := coalesce(v_bill.tds_rate, 0);
  v_tds_amount := round(v_subtotal * v_tds_rate / 100, 2);
  v_net_payable := round(v_total - v_tds_amount, 2);

  update public.erp_gst_purchase_invoices
     set subtotal = v_subtotal,
         gst_total = v_gst_total,
         total = v_total,
         tds_amount = v_tds_amount,
         net_payable = v_net_payable,
         updated_at = now(),
         updated_by = v_actor
   where id = v_bill.id
     and company_id = v_company_id;

  return jsonb_build_object(
    'subtotal', v_subtotal,
    'cgst', v_cgst,
    'sgst', v_sgst,
    'igst', v_igst,
    'cess', v_cess,
    'gst_total', v_gst_total,
    'total', v_total,
    'tds_rate', v_tds_rate,
    'tds_amount', v_tds_amount,
    'net_payable', v_net_payable
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_recalc(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_recalc(uuid) to authenticated;

create or replace function public.erp_ap_vendor_bill_line_upsert(p_line jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_invoice_id uuid := nullif(p_line->>'bill_id', '')::uuid;
  v_line_no int := coalesce(nullif(p_line->>'line_no', '')::int, 1);
  v_variant_id uuid := nullif(p_line->>'variant_id', '')::uuid;
  v_description text := nullif(p_line->>'description', '');
  v_hsn text := nullif(p_line->>'hsn', '');
  v_qty numeric := coalesce(nullif(p_line->>'qty', '')::numeric, 0);
  v_unit_rate numeric := coalesce(nullif(p_line->>'unit_rate', '')::numeric, 0);
  v_line_amount numeric := coalesce(nullif(p_line->>'line_amount', '')::numeric, v_qty * v_unit_rate);
  v_taxable_value numeric := coalesce(nullif(p_line->>'taxable_value', '')::numeric, v_line_amount);
  v_gst_rate numeric := nullif(p_line->>'gst_rate', '')::numeric;
  v_cgst numeric := coalesce(nullif(p_line->>'cgst', '')::numeric, 0);
  v_sgst numeric := coalesce(nullif(p_line->>'sgst', '')::numeric, 0);
  v_igst numeric := coalesce(nullif(p_line->>'igst', '')::numeric, 0);
  v_cess numeric := coalesce(nullif(p_line->>'cess', '')::numeric, 0);
  v_itc_eligible boolean := coalesce(nullif(p_line->>'itc_eligible', '')::boolean, true);
  v_itc_reason text := nullif(p_line->>'itc_reason', '');
  v_status text;
  v_actor uuid := auth.uid();
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_invoice_id is null then
    raise exception 'bill_id is required';
  end if;

  select status
    into v_status
    from public.erp_gst_purchase_invoices
    where id = v_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Vendor bill not found';
  end if;

  if v_status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be edited';
  end if;

  if (p_line ? 'id') and nullif(p_line->>'id', '') is not null then
    v_line_id := (p_line->>'id')::uuid;

    update public.erp_gst_purchase_invoice_lines
       set line_no = v_line_no,
           variant_id = v_variant_id,
           description = v_description,
           hsn = coalesce(v_hsn, hsn),
           qty = v_qty,
           unit_rate = v_unit_rate,
           line_amount = v_line_amount,
           taxable_value = v_taxable_value,
           gst_rate = v_gst_rate,
           cgst = v_cgst,
           sgst = v_sgst,
           igst = v_igst,
           cess = v_cess,
           itc_eligible = v_itc_eligible,
           itc_reason = v_itc_reason,
           updated_at = now(),
           updated_by = v_actor
     where id = v_line_id
       and invoice_id = v_invoice_id
    returning id into v_line_id;

    if v_line_id is null then
      raise exception 'Vendor bill line not found';
    end if;
  else
    select id
      into v_line_id
      from public.erp_gst_purchase_invoice_lines
      where invoice_id = v_invoice_id
        and line_no = v_line_no
        and company_id = v_company_id
        and is_void = false;

    if v_line_id is null then
      insert into public.erp_gst_purchase_invoice_lines (
        company_id,
        invoice_id,
        line_no,
        variant_id,
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
        unit_rate,
        gst_rate,
        line_amount,
        created_by,
        updated_by
      ) values (
        v_company_id,
        v_invoice_id,
        v_line_no,
        v_variant_id,
        v_description,
        coalesce(v_hsn, 'NA'),
        v_qty,
        null,
        v_taxable_value,
        v_cgst,
        v_sgst,
        v_igst,
        v_cess,
        v_itc_eligible,
        v_itc_reason,
        v_unit_rate,
        v_gst_rate,
        v_line_amount,
        v_actor,
        v_actor
      ) returning id into v_line_id;
    else
      update public.erp_gst_purchase_invoice_lines
         set variant_id = v_variant_id,
             description = v_description,
             hsn = coalesce(v_hsn, hsn),
             qty = v_qty,
             unit_rate = v_unit_rate,
             line_amount = v_line_amount,
             taxable_value = v_taxable_value,
             gst_rate = v_gst_rate,
             cgst = v_cgst,
             sgst = v_sgst,
             igst = v_igst,
             cess = v_cess,
             itc_eligible = v_itc_eligible,
             itc_reason = v_itc_reason,
             updated_at = now(),
             updated_by = v_actor
       where id = v_line_id
      returning id into v_line_id;
    end if;
  end if;

  perform public.erp_ap_vendor_bill_recalc(v_invoice_id);

  return v_line_id;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_line_upsert(jsonb) from public;
grant execute on function public.erp_ap_vendor_bill_line_upsert(jsonb) to authenticated;

create or replace function public.erp_ap_vendor_bill_line_void(
  p_line_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_invoice_id uuid;
  v_status text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.erp_require_finance_writer();

  select invoice_id
    into v_invoice_id
    from public.erp_gst_purchase_invoice_lines
    where id = p_line_id
      and company_id = v_company_id
      and is_void = false;

  if v_invoice_id is null then
    raise exception 'Vendor bill line not found';
  end if;

  select status
    into v_status
    from public.erp_gst_purchase_invoices
    where id = v_invoice_id
      and company_id = v_company_id
    for update;

  if v_status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be edited';
  end if;

  update public.erp_gst_purchase_invoice_lines
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_line_id
     and company_id = v_company_id;

  perform public.erp_ap_vendor_bill_recalc(v_invoice_id);

  return true;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_line_void(uuid, text) from public;
grant execute on function public.erp_ap_vendor_bill_line_void(uuid, text) to authenticated;

create or replace function public.erp_ap_vendor_bill_post_preview(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_bill record;
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
  v_tds_section text := null;
  v_tds_rate numeric := 0;
  v_tds_amount numeric := 0;
  v_net_payable numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_received_source text := null;
  v_has_links boolean := false;
  v_invalid_qty boolean := false;
  v_missing_variant boolean := false;
  v_vendor_mismatch boolean := false;
  v_bill_qty record;
  v_received_qty numeric;
  v_grn_ids uuid[] := '{}';
  v_po_vendor_id uuid;
  v_igst_total numeric := 0;
  v_role_id uuid;
begin
  perform public.erp_require_finance_reader();

  select i.*, v.legal_name as vendor_name
    into v_bill
    from public.erp_gst_purchase_invoices i
    join public.erp_vendors v on v.id = i.vendor_id
    where i.company_id = v_company_id
      and i.id = p_bill_id;

  if v_bill.id is null then
    return jsonb_build_object('errors', jsonb_build_array('Vendor bill not found'), 'can_post', false);
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
    and l.invoice_id = v_bill.id
    and l.is_void = false;

  v_gst_total := v_cgst + v_sgst + v_igst + v_cess;
  v_total := round(v_subtotal + v_gst_total, 2);

  if v_bill.tds_rate is not null then
    v_tds_rate := v_bill.tds_rate;
    v_tds_section := v_bill.tds_section;
  else
    select t.tds_section, t.tds_rate
      into v_tds_section, v_tds_rate
      from public.erp_vendor_tds_profiles t
      where t.company_id = v_company_id
        and t.vendor_id = v_bill.vendor_id
        and t.is_void = false
        and t.effective_from <= coalesce(v_bill.invoice_date, current_date)
        and (t.effective_to is null or t.effective_to >= coalesce(v_bill.invoice_date, current_date))
      order by t.effective_from desc
      limit 1;
  end if;

  v_tds_rate := coalesce(v_tds_rate, 0);
  v_tds_amount := round(v_subtotal * v_tds_rate / 100, 2);
  v_net_payable := round(v_total - v_tds_amount, 2);

  begin
    v_role_id := public.erp_fin_account_by_role('inventory_asset');
    select id, code, name into v_inventory from public.erp_gl_accounts a where a.id = v_role_id;
  exception
    when others then
      v_errors := v_errors || jsonb_build_array(sqlerrm);
  end;

  if v_cgst > 0 then
    begin
      v_role_id := public.erp_fin_account_by_role('input_gst_cgst');
      select id, code, name into v_cgst_account from public.erp_gl_accounts a where a.id = v_role_id;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(sqlerrm);
    end;
  end if;

  if v_sgst > 0 then
    begin
      v_role_id := public.erp_fin_account_by_role('input_gst_sgst');
      select id, code, name into v_sgst_account from public.erp_gl_accounts a where a.id = v_role_id;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(sqlerrm);
    end;
  end if;

  if v_igst > 0 or v_cess > 0 then
    begin
      v_role_id := public.erp_fin_account_by_role('input_gst_igst');
      select id, code, name into v_igst_account from public.erp_gl_accounts a where a.id = v_role_id;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(sqlerrm);
    end;
  end if;

  begin
    v_role_id := public.erp_fin_account_by_role('vendor_payable');
    select id, code, name into v_vendor_payable from public.erp_gl_accounts a where a.id = v_role_id;
  exception
    when others then
      v_errors := v_errors || jsonb_build_array(sqlerrm);
  end;

  if v_tds_amount > 0 then
    begin
      v_role_id := public.erp_fin_account_by_role('tds_payable');
      select id, code, name into v_tds_payable from public.erp_gl_accounts a where a.id = v_role_id;
    exception
      when others then
        v_errors := v_errors || jsonb_build_array(sqlerrm);
    end;
  end if;

  if v_bill.po_id is not null then
    v_has_links := true;
    select vendor_id
      into v_po_vendor_id
      from public.erp_purchase_orders
      where id = v_bill.po_id
        and company_id = v_company_id;
    if v_po_vendor_id is null then
      v_errors := v_errors || jsonb_build_array('Linked PO not found');
    elsif v_po_vendor_id <> v_bill.vendor_id then
      v_vendor_mismatch := true;
    end if;
  end if;

  select array_agg(grn_id)
    into v_grn_ids
    from public.erp_ap_vendor_bill_grn_links
    where company_id = v_company_id
      and bill_id = v_bill.id
      and is_void = false;

  if v_bill.grn_id is not null then
    v_grn_ids := array_append(coalesce(v_grn_ids, '{}'), v_bill.grn_id);
  end if;

  if array_length(v_grn_ids, 1) is not null then
    v_has_links := true;
    v_received_source := 'grn';
    if exists (
      select 1
      from public.erp_grns g
      join public.erp_purchase_orders po
        on po.id = g.purchase_order_id
       and po.company_id = g.company_id
      where g.company_id = v_company_id
        and g.id = any (v_grn_ids)
        and po.vendor_id <> v_bill.vendor_id
    ) then
      v_vendor_mismatch := true;
    end if;
  elsif v_bill.po_id is not null then
    v_received_source := 'po';
  end if;

  if v_bill.po_id is not null and array_length(v_grn_ids, 1) is not null then
    if exists (
      select 1
      from public.erp_grns g
      where g.company_id = v_company_id
        and g.id = any (v_grn_ids)
        and g.purchase_order_id <> v_bill.po_id
    ) then
      v_errors := v_errors || jsonb_build_array('Linked GRN does not belong to PO');
    end if;
  end if;

  if v_vendor_mismatch then
    v_errors := v_errors || jsonb_build_array('Vendor mismatch with linked PO/GRN');
  end if;

  if v_has_links then
    if exists (
      select 1
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_bill.id
        and l.is_void = false
        and l.variant_id is null
    ) then
      v_missing_variant := true;
    end if;

    for v_bill_qty in
      select l.variant_id, coalesce(sum(l.qty), 0) as bill_qty
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_bill.id
        and l.is_void = false
        and l.variant_id is not null
      group by l.variant_id
    loop
      if v_received_source = 'grn' then
        select coalesce(sum(gl.received_qty), 0)
          into v_received_qty
          from public.erp_grn_lines gl
          where gl.company_id = v_company_id
            and gl.grn_id = any (v_grn_ids)
            and gl.variant_id = v_bill_qty.variant_id;
      else
        select coalesce(sum(pol.received_qty), 0)
          into v_received_qty
          from public.erp_purchase_order_lines pol
          where pol.company_id = v_company_id
            and pol.purchase_order_id = v_bill.po_id
            and pol.variant_id = v_bill_qty.variant_id;
      end if;

      if v_bill_qty.bill_qty > coalesce(v_received_qty, 0) then
        v_invalid_qty := true;
      end if;
    end loop;

    if v_missing_variant then
      v_errors := v_errors || jsonb_build_array('Variant is required for 3-way match');
    end if;

    if v_invalid_qty then
      v_errors := v_errors || jsonb_build_array('Bill quantities exceed received quantities');
    end if;
  end if;

  if v_inventory.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Inventory purchases',
        'amount', v_subtotal,
        'account_id', v_inventory.id,
        'account_code', v_inventory.code,
        'account_name', v_inventory.name,
        'debit', v_subtotal,
        'credit', 0
      )
    );
  end if;

  if v_cgst > 0 and v_cgst_account.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Input GST CGST',
        'amount', v_cgst,
        'account_id', v_cgst_account.id,
        'account_code', v_cgst_account.code,
        'account_name', v_cgst_account.name,
        'debit', v_cgst,
        'credit', 0
      )
    );
  end if;

  if v_sgst > 0 and v_sgst_account.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Input GST SGST',
        'amount', v_sgst,
        'account_id', v_sgst_account.id,
        'account_code', v_sgst_account.code,
        'account_name', v_sgst_account.name,
        'debit', v_sgst,
        'credit', 0
      )
    );
  end if;

  if v_igst > 0 and v_igst_account.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Input GST IGST',
        'amount', v_igst,
        'account_id', v_igst_account.id,
        'account_code', v_igst_account.code,
        'account_name', v_igst_account.name,
        'debit', v_igst,
        'credit', 0
      )
    );
  end if;

  if v_cess > 0 and v_igst_account.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Input GST Cess',
        'amount', v_cess,
        'account_id', v_igst_account.id,
        'account_code', v_igst_account.code,
        'account_name', v_igst_account.name,
        'debit', v_cess,
        'credit', 0
      )
    );
  end if;

  if v_vendor_payable.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Vendor payable',
        'amount', v_net_payable,
        'account_id', v_vendor_payable.id,
        'account_code', v_vendor_payable.code,
        'account_name', v_vendor_payable.name,
        'debit', 0,
        'credit', v_net_payable
      )
    );
  end if;

  if v_tds_amount > 0 and v_tds_payable.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'TDS payable',
        'amount', v_tds_amount,
        'account_id', v_tds_payable.id,
        'account_code', v_tds_payable.code,
        'account_name', v_tds_payable.name,
        'debit', 0,
        'credit', v_tds_amount
      )
    );
  end if;

  v_igst_total := v_igst + v_cess;

  return jsonb_build_object(
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'gst_total', v_gst_total,
      'total', v_total,
      'cgst', v_cgst,
      'sgst', v_sgst,
      'igst', v_igst_total,
      'tds_section', v_tds_section,
      'tds_rate', v_tds_rate,
      'tds_amount', v_tds_amount,
      'net_payable', v_net_payable
    ),
    'journal_lines', v_lines,
    'errors', v_errors,
    'can_post', jsonb_array_length(v_errors) = 0
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post_preview(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_post_preview(uuid) to authenticated;

create or replace function public.erp_ap_vendor_bill_post(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill record;
  v_preview jsonb;
  v_errors jsonb;
  v_totals jsonb;
  v_lines jsonb;
  v_journal_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_tds_section text;
  v_tds_rate numeric;
  v_tds_amount numeric;
  v_net_payable numeric;
  v_subtotal numeric;
  v_gst_total numeric;
  v_total numeric;
  v_posted_doc text;
begin
  perform public.erp_require_finance_writer();

  select i.*, j.doc_no as posted_doc
    into v_bill
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
     and j.company_id = i.company_id
    where i.company_id = v_company_id
      and i.id = p_bill_id
    for update;

  if v_bill.id is null then
    raise exception 'Vendor bill not found';
  end if;

  if v_bill.is_void then
    raise exception 'Vendor bill is void';
  end if;

  if v_bill.status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be posted';
  end if;

  if v_bill.finance_journal_id is not null then
    return jsonb_build_object(
      'journal_id', v_bill.finance_journal_id,
      'doc_no', v_bill.posted_doc
    );
  end if;

  perform public.erp_ap_vendor_bill_recalc(p_bill_id);

  v_preview := public.erp_ap_vendor_bill_post_preview(p_bill_id);
  v_errors := coalesce(v_preview->'errors', '[]'::jsonb);

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'Posting blocked: %', v_errors::text;
  end if;

  v_totals := v_preview->'totals';
  v_lines := v_preview->'journal_lines';

  v_subtotal := coalesce((v_totals->>'subtotal')::numeric, 0);
  v_gst_total := coalesce((v_totals->>'gst_total')::numeric, 0);
  v_total := coalesce((v_totals->>'total')::numeric, 0);
  v_tds_section := nullif(v_totals->>'tds_section', '');
  v_tds_rate := coalesce((v_totals->>'tds_rate')::numeric, 0);
  v_tds_amount := coalesce((v_totals->>'tds_amount')::numeric, 0);
  v_net_payable := coalesce((v_totals->>'net_payable')::numeric, 0);

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
    v_bill.invoice_date,
    'posted',
    format('Vendor bill %s', v_bill.invoice_no),
    'vendor_bill',
    v_bill.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  for v_line in
    select * from jsonb_array_elements(v_lines)
  loop
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
      v_line->>'account_code',
      v_line->>'account_name',
      v_line->>'memo',
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0)
    );

    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_line_no := v_line_no + 1;
  end loop;

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
     set finance_journal_id = v_journal_id,
         status = 'posted',
         subtotal = v_subtotal,
         gst_total = v_gst_total,
         total = v_total,
         tds_section = coalesce(v_tds_section, tds_section),
         tds_rate = v_tds_rate,
         tds_amount = v_tds_amount,
         net_payable = v_net_payable,
         updated_at = now(),
         updated_by = v_actor
   where id = v_bill.id
     and company_id = v_company_id;

  return jsonb_build_object(
    'journal_id', v_journal_id,
    'doc_no', v_doc_no
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_post(uuid) to authenticated;

create or replace function public.erp_ap_vendor_advance_approve_and_post(
  p_advance_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_advance record;
  v_advances_account record;
  v_payment_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_role_id uuid;
begin
  perform public.erp_require_finance_writer();

  select a.*, j.doc_no as posted_doc
    into v_advance
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
     and j.company_id = a.company_id
    where a.company_id = v_company_id
      and a.id = p_advance_id
    for update;

  if v_advance.id is null then
    raise exception 'Vendor advance not found';
  end if;

  if v_advance.is_void or v_advance.status = 'void' then
    raise exception 'Vendor advance is void';
  end if;

  if v_advance.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_advance.finance_journal_id, 'doc_no', v_advance.posted_doc);
  end if;

  v_role_id := public.erp_fin_account_by_role('vendor_advance');
  select id, code, name into v_advances_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  v_role_id := public.erp_fin_account_by_role('bank_main');
  select id, code, name into v_payment_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_advances_account.id is null or v_payment_account.id is null then
    raise exception 'Advance posting accounts missing';
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
    v_advance.advance_date,
    'posted',
    format('Vendor advance %s', v_advance.reference),
    'vendor_advance',
    v_advance.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

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
    1,
    v_advances_account.code,
    v_advances_account.name,
    'Vendor advance',
    v_advance.amount,
    0
  );

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
    2,
    v_payment_account.code,
    v_payment_account.name,
    'Advance payment',
    0,
    v_advance.amount
  );

  v_total_debit := v_advance.amount;
  v_total_credit := v_advance.amount;

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

  update public.erp_ap_vendor_advances
     set finance_journal_id = v_journal_id,
         status = 'approved',
         updated_at = now(),
         updated_by = v_actor
   where id = v_advance.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

revoke all on function public.erp_ap_vendor_advance_approve_and_post(uuid) from public;
grant execute on function public.erp_ap_vendor_advance_approve_and_post(uuid) to authenticated;
