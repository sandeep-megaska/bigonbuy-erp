-- GST Purchase Revalidation + Vendor GSTIN helpers + Void RPC polish

create or replace function public.erp_vendor_state_code_from_gstin(
  p_gstin text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gstin text := nullif(trim(coalesce(p_gstin, '')), '');
  v_prefix text;
  v_state_code text;
begin
  if v_gstin is null or length(v_gstin) < 2 then
    return null;
  end if;

  v_prefix := left(v_gstin, 2);

  if v_prefix !~ '^[0-9]{2}$' then
    return null;
  end if;

  v_state_code := case v_prefix
    when '01' then 'JK'
    when '02' then 'HP'
    when '03' then 'PB'
    when '04' then 'CH'
    when '05' then 'UT'
    when '06' then 'HR'
    when '07' then 'DL'
    when '08' then 'RJ'
    when '09' then 'UP'
    when '10' then 'BR'
    when '11' then 'SK'
    when '12' then 'AR'
    when '13' then 'NL'
    when '14' then 'MN'
    when '15' then 'MZ'
    when '16' then 'TR'
    when '17' then 'ML'
    when '18' then 'AS'
    when '19' then 'WB'
    when '20' then 'JH'
    when '21' then 'OD'
    when '22' then 'CG'
    when '23' then 'MP'
    when '24' then 'GJ'
    when '25' then 'DD'
    when '26' then 'DN'
    when '27' then 'MH'
    when '28' then 'AP'
    when '29' then 'KA'
    when '30' then 'GA'
    when '31' then 'LD'
    when '32' then 'KL'
    when '33' then 'TN'
    when '34' then 'PY'
    when '35' then 'AN'
    when '36' then 'TS'
    when '37' then 'AP'
    when '38' then 'LA'
    else null
  end;

  return v_state_code;
end;
$$;

alter table public.erp_vendors
  add column if not exists state_code text;

create or replace function public.erp_gst_purchase_invoice_void(
  p_invoice_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_invoice_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select i.id
    into v_invoice_id
    from public.erp_gst_purchase_invoices i
    where i.company_id = v_company_id
      and i.id = p_invoice_id;

  if v_invoice_id is null then
    raise exception 'Invoice not found';
  end if;

  update public.erp_gst_purchase_invoices i
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where i.company_id = v_company_id
     and i.id = v_invoice_id;

  update public.erp_gst_purchase_invoice_lines l
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where l.company_id = v_company_id
     and l.invoice_id = v_invoice_id;

  return true;
end;
$$;

create or replace function public.erp_gst_purchase_revalidate_range(
  p_from date,
  p_to date
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_updated integer := 0;
  v_ok integer := 0;
  v_warn integer := 0;
  v_error integer := 0;
  v_invoice record;
  v_vendor_state_code text;
  v_place_of_supply_state_code text;
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
  v_status text := 'ok';
  v_notes jsonb := '{}'::jsonb;
  v_has_negative boolean := false;
  v_has_bad_hsn boolean := false;
  v_has_cgst boolean := false;
  v_has_sgst boolean := false;
  v_has_igst boolean := false;
  v_expected_interstate boolean;
  v_has_taxable_total boolean := false;
  v_has_cgst_total boolean := false;
  v_has_sgst_total boolean := false;
  v_has_igst_total boolean := false;
  v_has_cess_total boolean := false;
  v_has_total_tax boolean := false;
  v_has_invoice_total boolean := false;
  v_declared_taxable numeric;
  v_declared_cgst numeric;
  v_declared_sgst numeric;
  v_declared_igst numeric;
  v_declared_cess numeric;
  v_declared_total_tax numeric;
  v_declared_invoice_total numeric;
  v_totals_mismatch boolean := false;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'taxable_total'
  ) into v_has_taxable_total;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'cgst_total'
  ) into v_has_cgst_total;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'sgst_total'
  ) into v_has_sgst_total;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'igst_total'
  ) into v_has_igst_total;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'cess_total'
  ) into v_has_cess_total;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'total_tax'
  ) into v_has_total_tax;

  select exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_gst_purchase_invoices'
      and column_name = 'invoice_total'
  ) into v_has_invoice_total;

  for v_invoice in
    select i.id,
           i.vendor_gstin,
           i.vendor_state_code,
           i.place_of_supply_state_code
      from public.erp_gst_purchase_invoices i
      where i.company_id = v_company_id
        and i.is_void = false
        and i.invoice_date between p_from and p_to
  loop
    v_errors := '[]'::jsonb;
    v_warnings := '[]'::jsonb;
    v_status := 'ok';
    v_totals_mismatch := false;

    v_vendor_gstin := nullif(trim(coalesce(v_invoice.vendor_gstin, '')), '');
    v_vendor_state_code := nullif(trim(coalesce(v_invoice.vendor_state_code, '')), '');
    v_place_of_supply_state_code := nullif(trim(coalesce(v_invoice.place_of_supply_state_code, '')), '');

    if v_vendor_state_code is null then
      v_vendor_state_code := public.erp_vendor_state_code_from_gstin(v_vendor_gstin);
    elsif v_vendor_state_code ~ '^[0-9]{2}$' then
      v_vendor_state_code := public.erp_vendor_state_code_from_gstin(v_vendor_state_code);
    else
      v_vendor_state_code := upper(v_vendor_state_code);
    end if;

    if v_place_of_supply_state_code is not null then
      if v_place_of_supply_state_code ~ '^[0-9]{2}$' then
        v_place_of_supply_state_code := public.erp_vendor_state_code_from_gstin(v_place_of_supply_state_code);
      else
        v_place_of_supply_state_code := upper(v_place_of_supply_state_code);
      end if;
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
      and l.invoice_id = v_invoice.id
      and l.is_void = false;

    v_total_tax := v_cgst_sum + v_sgst_sum + v_igst_sum + v_cess_sum;
    v_invoice_total := v_taxable_sum + v_total_tax;

    select exists(
      select 1
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_invoice.id
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
      and public.erp_vendor_state_code_from_gstin(v_vendor_gstin) is null
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

    if v_vendor_state_code is not null and v_place_of_supply_state_code is not null then
      v_expected_interstate := v_vendor_state_code <> v_place_of_supply_state_code;

      if v_expected_interstate and (v_has_cgst or v_has_sgst) then
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'expected_igst',
            'message', 'Inter-state supply expected IGST instead of CGST/SGST.'
          )
        );
      end if;

      if (not v_expected_interstate) and v_has_igst then
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'expected_cgst_sgst',
            'message', 'Intra-state supply expected CGST/SGST instead of IGST.'
          )
        );
      end if;
    end if;

    select exists(
      select 1
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_invoice.id
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

    if v_has_taxable_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'taxable_total'
      ) into v_declared_taxable using v_invoice.id, v_company_id;

      if v_declared_taxable is not null and abs(v_declared_taxable - v_taxable_sum) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_cgst_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'cgst_total'
      ) into v_declared_cgst using v_invoice.id, v_company_id;

      if v_declared_cgst is not null and abs(v_declared_cgst - v_cgst_sum) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_sgst_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'sgst_total'
      ) into v_declared_sgst using v_invoice.id, v_company_id;

      if v_declared_sgst is not null and abs(v_declared_sgst - v_sgst_sum) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_igst_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'igst_total'
      ) into v_declared_igst using v_invoice.id, v_company_id;

      if v_declared_igst is not null and abs(v_declared_igst - v_igst_sum) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_cess_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'cess_total'
      ) into v_declared_cess using v_invoice.id, v_company_id;

      if v_declared_cess is not null and abs(v_declared_cess - v_cess_sum) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_total_tax then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'total_tax'
      ) into v_declared_total_tax using v_invoice.id, v_company_id;

      if v_declared_total_tax is not null and abs(v_declared_total_tax - v_total_tax) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_has_invoice_total then
      execute format(
        'select i.%I from public.erp_gst_purchase_invoices i where i.id = $1 and i.company_id = $2',
        'invoice_total'
      ) into v_declared_invoice_total using v_invoice.id, v_company_id;

      if v_declared_invoice_total is not null and abs(v_declared_invoice_total - v_invoice_total) > 0.01 then
        v_totals_mismatch := true;
      end if;
    end if;

    if v_totals_mismatch then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'totals_mismatch',
          'message', 'Declared totals do not match computed totals.'
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
       and i.id = v_invoice.id;

    v_updated := v_updated + 1;

    if v_status = 'error' then
      v_error := v_error + 1;
    elsif v_status = 'warn' then
      v_warn := v_warn + 1;
    else
      v_ok := v_ok + 1;
    end if;
  end loop;

  return json_build_object(
    'updated_invoices', v_updated,
    'ok', v_ok,
    'warn', v_warn,
    'error', v_error
  );
end;
$$;

revoke all on function public.erp_vendor_state_code_from_gstin(text) from public;
revoke all on function public.erp_vendor_state_code_from_gstin(text) from authenticated;
grant execute on function public.erp_vendor_state_code_from_gstin(text) to authenticated;

revoke all on function public.erp_gst_purchase_invoice_void(uuid, text) from public;
revoke all on function public.erp_gst_purchase_invoice_void(uuid, text) from authenticated;
grant execute on function public.erp_gst_purchase_invoice_void(uuid, text) to authenticated;

revoke all on function public.erp_gst_purchase_revalidate_range(date, date) from public;
revoke all on function public.erp_gst_purchase_revalidate_range(date, date) from authenticated;
grant execute on function public.erp_gst_purchase_revalidate_range(date, date) to authenticated;
