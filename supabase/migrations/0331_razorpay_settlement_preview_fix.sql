-- 0331_razorpay_settlement_preview_fix.sql
create or replace function public.erp_razorpay_settlement_posting_preview(
  p_razorpay_settlement_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_settlement record;
  v_config_clearing_id uuid;
  v_config_bank_id uuid;
  v_config_fees_id uuid;
  v_config_gst_id uuid;
  v_clearing_id uuid;
  v_clearing_code text;
  v_clearing_name text;
  v_bank_id uuid;
  v_bank_code text;
  v_bank_name text;
  v_fees_id uuid;
  v_fees_code text;
  v_fees_name text;
  v_gst_id uuid;
  v_gst_code text;
  v_gst_name text;
  v_bank_amount numeric(14,2) := 0;
  v_fee_amount numeric(14,2) := 0;
  v_tax_amount numeric(14,2) := 0;
  v_clearing_total numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_errors text[] := '{}'::text[];
  v_warnings text[] := '{}'::text[];
  v_can_post boolean := false;
  v_post_journal_id uuid;
  v_post_doc_no text;
  v_has_recon boolean := false;
  v_has_config boolean := false;
  v_has_config_issue boolean := false;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_settlement
    from public.erp_razorpay_settlements s
    where s.company_id = v_company_id
      and s.razorpay_settlement_id = p_razorpay_settlement_id
      and s.is_void = false
    limit 1;

  if not found then
    return jsonb_build_object(
      'settlement', jsonb_build_object('razorpay_settlement_id', p_razorpay_settlement_id),
      'lines', '[]'::jsonb,
      'errors', jsonb_build_array('Settlement not found'),
      'warnings', '[]'::jsonb,
      'can_post', false
    );
  end if;

  select
    c.razorpay_clearing_account_id,
    c.bank_account_id,
    c.gateway_fees_account_id,
    c.gst_input_on_fees_account_id
    into v_config_clearing_id,
         v_config_bank_id,
         v_config_fees_id,
         v_config_gst_id
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id
    and c.is_void = false
    and c.is_active
  order by c.updated_at desc
  limit 1;

  if found then
    v_has_config := true;
  end if;

  if not v_has_config or v_config_clearing_id is null or v_config_bank_id is null then
    v_errors := array['Posting config missing'];
    v_has_config_issue := true;
  else
    select a.id, a.code, a.name
      into v_clearing_id, v_clearing_code, v_clearing_name
      from public.erp_gl_accounts a
      where a.id = v_config_clearing_id;

    select a.id, a.code, a.name
      into v_bank_id, v_bank_code, v_bank_name
      from public.erp_gl_accounts a
      where a.id = v_config_bank_id;

    if v_config_fees_id is not null then
      select a.id, a.code, a.name
        into v_fees_id, v_fees_code, v_fees_name
        from public.erp_gl_accounts a
        where a.id = v_config_fees_id;
    end if;

    if v_config_gst_id is not null then
      select a.id, a.code, a.name
        into v_gst_id, v_gst_code, v_gst_name
        from public.erp_gl_accounts a
        where a.id = v_config_gst_id;
    end if;

    if v_clearing_id is null then
      v_errors := array_append(v_errors, 'Clearing account missing');
    end if;

    if v_bank_id is null then
      v_errors := array_append(v_errors, 'Bank account missing');
    end if;

    if v_clearing_id is not null and v_clearing_code <> '1102' then
      v_errors := array_append(v_errors, 'Razorpay clearing account (1102) missing');
    end if;
  end if;

  v_bank_amount := round(coalesce(v_settlement.amount, 0), 2);
  v_has_recon := v_settlement.raw ? 'recon_summary';

  if v_has_recon then
    v_fee_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'fee_total')::numeric, 0), 2);
    v_tax_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'tax_total')::numeric, 0), 2);
  else
    v_warnings := array_append(v_warnings, 'Recon not available; fees not booked');
  end if;

  if not v_has_config_issue and v_bank_amount <= 0 then
    v_errors := array_append(v_errors, 'Settlement amount missing');
  end if;

  if not v_has_config_issue and v_fee_amount > 0 and v_fees_id is null then
    v_errors := array_append(v_errors, 'Gateway fees account missing');
  end if;

  if not v_has_config_issue and v_tax_amount > 0 and v_gst_id is null then
    v_errors := array_append(v_errors, 'GST input on fees account missing');
  end if;

  v_clearing_total := round(v_bank_amount + v_fee_amount + v_tax_amount, 2);

  if array_length(v_errors, 1) is null then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'memo', 'Razorpay settlement bank payout',
        'side', 'debit',
        'amount', v_bank_amount,
        'account_id', v_bank_id,
        'account_code', v_bank_code,
        'account_name', v_bank_name
      ),
      jsonb_build_object(
        'memo', 'Razorpay clearing',
        'side', 'credit',
        'amount', v_clearing_total,
        'account_id', v_clearing_id,
        'account_code', v_clearing_code,
        'account_name', v_clearing_name
      )
    );

    if v_fee_amount > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'memo', 'Payment gateway fees',
          'side', 'debit',
          'amount', v_fee_amount,
          'account_id', v_fees_id,
          'account_code', v_fees_code,
          'account_name', v_fees_name
        )
      );
    end if;

    if v_tax_amount > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'memo', 'GST input on fees',
          'side', 'debit',
          'amount', v_tax_amount,
          'account_id', v_gst_id,
          'account_code', v_gst_code,
          'account_name', v_gst_name
        )
      );
    end if;

    v_can_post := true;
  end if;

  select p.finance_journal_id, j.doc_no
    into v_post_journal_id, v_post_doc_no
    from public.erp_razorpay_settlement_posts p
    join public.erp_fin_journals j
      on j.id = p.finance_journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.razorpay_settlement_id = v_settlement.razorpay_settlement_id
      and p.is_void = false
    limit 1;

  return jsonb_build_object(
    'settlement', jsonb_build_object(
      'razorpay_settlement_id', v_settlement.razorpay_settlement_id,
      'settled_at', v_settlement.settled_at,
      'amount', v_bank_amount,
      'status', v_settlement.status,
      'utr', v_settlement.settlement_utr
    ),
    'config', jsonb_build_object(
      'clearing_account', jsonb_build_object('id', v_clearing_id, 'code', v_clearing_code, 'name', v_clearing_name),
      'bank_account', jsonb_build_object('id', v_bank_id, 'code', v_bank_code, 'name', v_bank_name),
      'gateway_fees_account', jsonb_build_object('id', v_fees_id, 'code', v_fees_code, 'name', v_fees_name),
      'gst_input_on_fees_account', jsonb_build_object('id', v_gst_id, 'code', v_gst_code, 'name', v_gst_name)
    ),
    'totals', jsonb_build_object(
      'clearing_credit_total', v_clearing_total,
      'bank_debit_total', v_bank_amount,
      'fees_debit_total', v_fee_amount,
      'gst_on_fees_debit_total', v_tax_amount
    ),
    'journal_lines', v_lines,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', v_post_journal_id,
      'doc_no', v_post_doc_no
    )
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_posting_preview(text) from public;
grant execute on function public.erp_razorpay_settlement_posting_preview(text) to authenticated;
