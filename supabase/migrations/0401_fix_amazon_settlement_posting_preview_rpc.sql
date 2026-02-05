drop function if exists public.erp_amazon_settlement_batch_preview_post_to_finance(uuid);

create function public.erp_amazon_settlement_batch_preview_post_to_finance(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_batch record;

  v_sales numeric := 0;
  v_fees numeric := 0;
  v_refunds numeric := 0;
  v_adjustments numeric := 0;
  v_net_payout numeric := 0;
  v_net_payout_txn numeric := 0;
  v_txn_count int := 0;

  v_total_debit numeric := 0;
  v_total_credit numeric := 0;

  v_lines jsonb := '[]'::jsonb;
  v_warnings text[] := '{}'::text[];

  v_can_post boolean := true;

  v_sales_acc_id uuid;
  v_sales_acc_code text;
  v_sales_acc_name text;

  v_fees_acc_id uuid;
  v_fees_acc_code text;
  v_fees_acc_name text;

  v_refunds_acc_id uuid;
  v_refunds_acc_code text;
  v_refunds_acc_name text;

  v_adjustments_acc_id uuid;
  v_adjustments_acc_code text;
  v_adjustments_acc_name text;

  v_clearing_acc_id uuid;
  v_clearing_acc_code text;
  v_clearing_acc_name text;

  v_journal_id uuid;
  v_journal_no text;
  v_posting_state text;

  v_balance_diff numeric := 0;
  v_from date;
  v_to date;
begin
  perform public.erp_require_finance_reader();

  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  select
    b.id,
    b.batch_ref,
    b.period_start,
    b.period_end,
    b.currency,
    b.net_payout
  into v_batch
  from public.erp_marketplace_settlement_batches b
  where b.company_id = v_company_id
    and b.id = p_batch_id
  limit 1;

  if v_batch.id is null then
    raise exception 'Settlement batch not found for id %', p_batch_id;
  end if;

  select
    count(*)::int,
    coalesce(sum(t.gross_sales), 0),
    coalesce(sum(t.total_fees), 0),
    coalesce(sum(t.refund_amount), 0),
    coalesce(sum(t.other_charges), 0),
    coalesce(sum(t.net_payout), 0)
  into
    v_txn_count,
    v_sales,
    v_fees,
    v_refunds,
    v_adjustments,
    v_net_payout_txn
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  if coalesce(v_txn_count, 0) = 0 then
    v_warnings := array_append(v_warnings, 'No txns normalized');
  end if;

  v_net_payout := coalesce(v_batch.net_payout, v_net_payout_txn, 0);

  select
    r.account_id,
    a.code,
    a.name
  into v_sales_acc_id, v_sales_acc_code, v_sales_acc_name
  from public.erp_fin_coa_role_accounts r
  left join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = r.account_id
  where r.company_id = v_company_id
    and r.role_key = 'amazon_settlement_sales_account'
  order by r.updated_at desc nulls last
  limit 1;

  select
    r.account_id,
    a.code,
    a.name
  into v_fees_acc_id, v_fees_acc_code, v_fees_acc_name
  from public.erp_fin_coa_role_accounts r
  left join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = r.account_id
  where r.company_id = v_company_id
    and r.role_key = 'amazon_settlement_fees_account'
  order by r.updated_at desc nulls last
  limit 1;

  select
    r.account_id,
    a.code,
    a.name
  into v_refunds_acc_id, v_refunds_acc_code, v_refunds_acc_name
  from public.erp_fin_coa_role_accounts r
  left join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = r.account_id
  where r.company_id = v_company_id
    and r.role_key = 'amazon_settlement_refunds_account'
  order by r.updated_at desc nulls last
  limit 1;

  select
    r.account_id,
    a.code,
    a.name
  into v_adjustments_acc_id, v_adjustments_acc_code, v_adjustments_acc_name
  from public.erp_fin_coa_role_accounts r
  left join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = r.account_id
  where r.company_id = v_company_id
    and r.role_key = 'amazon_settlement_adjustments_account'
  order by r.updated_at desc nulls last
  limit 1;

  select
    r.account_id,
    a.code,
    a.name
  into v_clearing_acc_id, v_clearing_acc_code, v_clearing_acc_name
  from public.erp_fin_coa_role_accounts r
  left join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = r.account_id
  where r.company_id = v_company_id
    and r.role_key = 'amazon_settlement_clearing_account'
  order by r.updated_at desc nulls last
  limit 1;

  if v_sales_acc_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_sales_account');
  end if;
  if v_fees_acc_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_fees_account');
  end if;
  if v_refunds_acc_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_refunds_account');
  end if;
  if v_adjustments_acc_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_adjustments_account');
  end if;
  if v_clearing_acc_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_clearing_account');
  end if;

  if round(abs(v_sales), 2) > 0 then
    if v_sales >= 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_sales_account',
        'account_id', v_sales_acc_id,
        'account_code', v_sales_acc_code,
        'account_name', v_sales_acc_name,
        'dr', 0,
        'cr', round(abs(v_sales), 2),
        'label', 'Sales'
      ));
      v_total_credit := v_total_credit + round(abs(v_sales), 2);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_sales_account',
        'account_id', v_sales_acc_id,
        'account_code', v_sales_acc_code,
        'account_name', v_sales_acc_name,
        'dr', round(abs(v_sales), 2),
        'cr', 0,
        'label', 'Sales'
      ));
      v_total_debit := v_total_debit + round(abs(v_sales), 2);
    end if;
  end if;

  if round(abs(v_fees), 2) > 0 then
    if v_fees >= 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_fees_account',
        'account_id', v_fees_acc_id,
        'account_code', v_fees_acc_code,
        'account_name', v_fees_acc_name,
        'dr', round(abs(v_fees), 2),
        'cr', 0,
        'label', 'Fees'
      ));
      v_total_debit := v_total_debit + round(abs(v_fees), 2);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_fees_account',
        'account_id', v_fees_acc_id,
        'account_code', v_fees_acc_code,
        'account_name', v_fees_acc_name,
        'dr', 0,
        'cr', round(abs(v_fees), 2),
        'label', 'Fees'
      ));
      v_total_credit := v_total_credit + round(abs(v_fees), 2);
    end if;
  end if;

  if round(abs(v_refunds), 2) > 0 then
    if v_refunds >= 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_refunds_account',
        'account_id', v_refunds_acc_id,
        'account_code', v_refunds_acc_code,
        'account_name', v_refunds_acc_name,
        'dr', round(abs(v_refunds), 2),
        'cr', 0,
        'label', 'Refunds'
      ));
      v_total_debit := v_total_debit + round(abs(v_refunds), 2);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_refunds_account',
        'account_id', v_refunds_acc_id,
        'account_code', v_refunds_acc_code,
        'account_name', v_refunds_acc_name,
        'dr', 0,
        'cr', round(abs(v_refunds), 2),
        'label', 'Refunds'
      ));
      v_total_credit := v_total_credit + round(abs(v_refunds), 2);
    end if;
  end if;

  if round(abs(v_adjustments), 2) > 0 then
    if v_adjustments > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_adjustments_account',
        'account_id', v_adjustments_acc_id,
        'account_code', v_adjustments_acc_code,
        'account_name', v_adjustments_acc_name,
        'dr', round(abs(v_adjustments), 2),
        'cr', 0,
        'label', 'Adjustments'
      ));
      v_total_debit := v_total_debit + round(abs(v_adjustments), 2);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_adjustments_account',
        'account_id', v_adjustments_acc_id,
        'account_code', v_adjustments_acc_code,
        'account_name', v_adjustments_acc_name,
        'dr', 0,
        'cr', round(abs(v_adjustments), 2),
        'label', 'Adjustments'
      ));
      v_total_credit := v_total_credit + round(abs(v_adjustments), 2);
    end if;
  end if;

  v_balance_diff := round(v_total_debit - v_total_credit, 2);
  if v_balance_diff <> 0 then
    if v_balance_diff > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_clearing_account',
        'account_id', v_clearing_acc_id,
        'account_code', v_clearing_acc_code,
        'account_name', v_clearing_acc_name,
        'dr', 0,
        'cr', abs(v_balance_diff),
        'label', 'Clearing'
      ));
      v_total_credit := v_total_credit + abs(v_balance_diff);
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'role_key', 'amazon_settlement_clearing_account',
        'account_id', v_clearing_acc_id,
        'account_code', v_clearing_acc_code,
        'account_name', v_clearing_acc_name,
        'dr', abs(v_balance_diff),
        'cr', 0,
        'label', 'Clearing'
      ));
      v_total_debit := v_total_debit + abs(v_balance_diff);
    end if;
  end if;

  begin
    select
      p.journal_id,
      j.doc_no,
      p.posting_state
    into v_journal_id, v_journal_no, v_posting_state
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.batch_id = p_batch_id
      and p.platform = 'amazon'
    order by p.created_at desc
    limit 1;
  exception
    when undefined_table then
      v_journal_id := null;
      v_journal_no := null;
      v_posting_state := null;
  end;

  if v_journal_id is null then
    begin
      v_from := coalesce(v_batch.period_start, v_batch.period_end, current_date - 3650);
      v_to := coalesce(v_batch.period_end, v_batch.period_start, current_date + 3650);

      select l.journal_id, l.journal_no, l.posting_state
      into v_journal_id, v_journal_no, v_posting_state
      from public.erp_amazon_settlement_batches_list_with_posting(v_from, v_to, 'all', 1000, 0) l
      where l.batch_id = p_batch_id
      limit 1;
    exception
      when undefined_function then
        null;
      when others then
        null;
    end;
  end if;

  if v_journal_id is not null or coalesce(v_posting_state, '') = 'posted' then
    v_warnings := array_append(v_warnings, 'Already posted');
    v_can_post := false;
  end if;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    v_warnings := array_append(v_warnings, 'Journal is not balanced');
    v_can_post := false;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_ref', v_batch.batch_ref,
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end,
    'currency', coalesce(v_batch.currency, 'INR'),
    'totals', jsonb_build_object(
      'net_payout', round(coalesce(v_net_payout, 0), 2),
      'sales', round(coalesce(v_sales, 0), 2),
      'fees', round(coalesce(v_fees, 0), 2),
      'refunds', round(coalesce(v_refunds, 0), 2),
      'tcs', 0,
      'tds', 0,
      'adjustments', round(coalesce(v_adjustments, 0), 2),
      'total_debit', round(coalesce(v_total_debit, 0), 2),
      'total_credit', round(coalesce(v_total_credit, 0), 2)
    ),
    'lines', v_lines,
    'warnings', coalesce(v_warnings, '{}'::text[]),
    'can_post', v_can_post,
    'posted', case
      when v_journal_id is null then null
      else jsonb_build_object('journal_id', v_journal_id, 'journal_no', v_journal_no)
    end
  );
end;
$$;

comment on function public.erp_amazon_settlement_batch_preview_post_to_finance(uuid)
  is 'Amazon settlement stage-1 preview RPC rebuilt in 0401; includes COA-role resolution and posted-state diagnostics.';
