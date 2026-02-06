-- 0403_fix_amazon_settlement_posting_preview_rpc_v2.sql
-- Recreate preview RPC without nested function declarations

drop function if exists public.erp_amazon_settlement_batch_preview_post_to_finance(uuid);

create function public.erp_amazon_settlement_batch_preview_post_to_finance(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_batch record;

  v_sales numeric := 0;
  v_fees numeric := 0;
  v_refunds numeric := 0;
  v_tcs numeric := 0;
  v_tds numeric := 0;

  v_net numeric := 0;
  v_adjustments numeric := 0;

  v_total_dr numeric := 0;
  v_total_cr numeric := 0;

  v_lines jsonb := '[]'::jsonb;
  v_warnings text[] := '{}'::text[];

  -- mapped accounts (control_role on erp_gl_accounts)
  v_sales_acc_id uuid;     v_sales_acc_code text;     v_sales_acc_name text;
  v_fees_acc_id uuid;      v_fees_acc_code text;      v_fees_acc_name text;
  v_refunds_acc_id uuid;   v_refunds_acc_code text;   v_refunds_acc_name text;
  v_tcs_acc_id uuid;       v_tcs_acc_code text;       v_tcs_acc_name text;
  v_tds_acc_id uuid;       v_tds_acc_code text;       v_tds_acc_name text;
  v_adj_acc_id uuid;       v_adj_acc_code text;       v_adj_acc_name text;
  v_clearing_acc_id uuid;  v_clearing_acc_code text;  v_clearing_acc_name text;

  v_journal_id uuid := null;
  v_journal_no text := null;

  v_txn_count int := 0;

  -- temps for each line
  v_dr numeric;
  v_cr numeric;
begin
  perform public.erp_require_finance_reader();

  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  v_company_id := public.erp_current_company_id();

  select
    b.id as batch_id,
    b.batch_ref,
    b.period_start,
    b.period_end,
    b.currency,
    b.net_payout,
    b.deposit_date
  into v_batch
  from public.erp_marketplace_settlement_batches b
  where b.company_id = v_company_id
    and b.id = p_batch_id;

  if not found then
    raise exception 'Batch not found: %', p_batch_id;
  end if;

  -- Core totals from normalized txns
  select
    count(*)::int,
    round(coalesce(sum(coalesce(t.gross_sales,0)),0),2),
    round(coalesce(sum(coalesce(t.total_fees,0)),0),2),
    round(coalesce(sum(coalesce(t.refund_amount,0)),0),2),
    round(coalesce(sum(coalesce(t.net_payout,0)),0),2)
  into
    v_txn_count,
    v_sales,
    v_fees,
    v_refunds,
    v_net
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  -- Best-effort TCS/TDS detection
  select
    round(coalesce(sum(case
      when lower(coalesce(t.settlement_type,'')) like '%tcs%'
        or lower(coalesce(t.raw->>'amount-type','')) like '%tcs%'
      then coalesce(t.net_payout,0) else 0 end),0),2),
    round(coalesce(sum(case
      when lower(coalesce(t.settlement_type,'')) like '%tds%'
        or lower(coalesce(t.raw->>'amount-type','')) like '%tds%'
      then coalesce(t.net_payout,0) else 0 end),0),2)
  into v_tcs, v_tds
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  -- Canonical net payout from batch
  v_net := coalesce(v_batch.net_payout, v_net, 0);

  -- Adjustments plug to reconcile
  v_adjustments := round(
    v_net - (coalesce(v_sales,0) + coalesce(v_fees,0) + coalesce(v_refunds,0) + coalesce(v_tcs,0) + coalesce(v_tds,0)),
    2
  );

  if v_txn_count = 0 then
    v_warnings := array_append(v_warnings, 'No normalized settlement transactions found for this batch.');
  end if;

  -- Load control-role mappings from erp_gl_accounts
  select a.id, a.code, a.name into v_sales_acc_id, v_sales_acc_code, v_sales_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_sales_account'
  limit 1;

  select a.id, a.code, a.name into v_fees_acc_id, v_fees_acc_code, v_fees_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_fees_account'
  limit 1;

  select a.id, a.code, a.name into v_refunds_acc_id, v_refunds_acc_code, v_refunds_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_refunds_account'
  limit 1;

  select a.id, a.code, a.name into v_tcs_acc_id, v_tcs_acc_code, v_tcs_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_tcs_account'
  limit 1;

  select a.id, a.code, a.name into v_tds_acc_id, v_tds_acc_code, v_tds_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_tds_account'
  limit 1;

  select a.id, a.code, a.name into v_adj_acc_id, v_adj_acc_code, v_adj_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_adjustments_account'
  limit 1;

  select a.id, a.code, a.name into v_clearing_acc_id, v_clearing_acc_code, v_clearing_acc_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and lower(a.control_role) = 'amazon_settlement_clearing_account'
  limit 1;

  if v_sales_acc_id is null then v_warnings := array_append(v_warnings, 'Missing COA control role mapping: amazon_settlement_sales_account'); end if;
  if v_fees_acc_id is null then v_warnings := array_append(v_warnings, 'Missing COA control role mapping: amazon_settlement_fees_account'); end if;
  if v_refunds_acc_id is null then v_warnings := array_append(v_warnings, 'Missing COA control role mapping: amazon_settlement_refunds_account'); end if;
  if v_adj_acc_id is null then v_warnings := array_append(v_warnings, 'Missing COA control role mapping: amazon_settlement_adjustments_account'); end if;
  if v_clearing_acc_id is null then v_warnings := array_append(v_warnings, 'Missing COA control role mapping: amazon_settlement_clearing_account'); end if;

  -- Helper macro: add one line (inline)
  -- Sales (credit if positive)
  if coalesce(v_sales,0) >= 0 then
    v_dr := 0; v_cr := v_sales;
  else
    v_warnings := array_append(v_warnings, 'Sales total is negative; check normalization/signs.');
    v_dr := -v_sales; v_cr := 0;
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'role_key','amazon_settlement_sales_account','account_id',v_sales_acc_id,'account_code',v_sales_acc_code,'account_name',v_sales_acc_name,
    'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','Sales'
  ));
  v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
  v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);

  -- Fees (usually negative => debit)
  if coalesce(v_fees,0) <= 0 then
    v_dr := -v_fees; v_cr := 0;
  else
    v_warnings := array_append(v_warnings, 'Fees total is positive; check normalization/signs.');
    v_dr := 0; v_cr := v_fees;
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'role_key','amazon_settlement_fees_account','account_id',v_fees_acc_id,'account_code',v_fees_acc_code,'account_name',v_fees_acc_name,
    'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','Fees'
  ));
  v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
  v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);

  -- Refunds (usually negative => debit)
  if coalesce(v_refunds,0) <= 0 then
    v_dr := -v_refunds; v_cr := 0;
  else
    v_warnings := array_append(v_warnings, 'Refunds total is positive; check normalization/signs.');
    v_dr := 0; v_cr := v_refunds;
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'role_key','amazon_settlement_refunds_account','account_id',v_refunds_acc_id,'account_code',v_refunds_acc_code,'account_name',v_refunds_acc_name,
    'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','Refunds'
  ));
  v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
  v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);

  -- TCS (optional)
  if coalesce(v_tcs,0) <> 0 then
    if v_tcs <= 0 then v_dr := -v_tcs; v_cr := 0; else v_dr := 0; v_cr := v_tcs; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_tcs_account','account_id',v_tcs_acc_id,'account_code',v_tcs_acc_code,'account_name',v_tcs_acc_name,
      'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','TCS'
    ));
    v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
    v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);
  end if;

  -- TDS (optional)
  if coalesce(v_tds,0) <> 0 then
    if v_tds <= 0 then v_dr := -v_tds; v_cr := 0; else v_dr := 0; v_cr := v_tds; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_tds_account','account_id',v_tds_acc_id,'account_code',v_tds_acc_code,'account_name',v_tds_acc_name,
      'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','TDS'
    ));
    v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
    v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);
  end if;

  -- Adjustments (plug)
  if coalesce(v_adjustments,0) <> 0 then
    if v_adjustments <= 0 then v_dr := -v_adjustments; v_cr := 0; else v_dr := 0; v_cr := v_adjustments; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_adjustments_account','account_id',v_adj_acc_id,'account_code',v_adj_acc_code,'account_name',v_adj_acc_name,
      'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','Adjustments'
    ));
    v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
    v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);
  end if;

  -- Clearing to balance
  if round(v_total_dr - v_total_cr,2) <> 0 then
    if v_total_cr > v_total_dr then
      v_dr := v_total_cr - v_total_dr; v_cr := 0;
    else
      v_dr := 0; v_cr := v_total_dr - v_total_cr;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_clearing_account','account_id',v_clearing_acc_id,'account_code',v_clearing_acc_code,'account_name',v_clearing_acc_name,
      'dr',round(greatest(coalesce(v_dr,0),0),2),'cr',round(greatest(coalesce(v_cr,0),0),2),'label','Clearing'
    ));
    v_total_dr := v_total_dr + greatest(coalesce(v_dr,0),0);
    v_total_cr := v_total_cr + greatest(coalesce(v_cr,0),0);
  end if;

  -- already posted? (best-effort)
  begin
    select p.journal_id into v_journal_id
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id and p.batch_id = p_batch_id
    order by p.created_at desc
    limit 1;
  exception when undefined_table then
    v_journal_id := null;
  end;

  if v_journal_id is not null then
    select j.doc_no into v_journal_no
    from public.erp_fin_journals j
    where j.id = v_journal_id;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch.batch_id,
    'batch_ref', v_batch.batch_ref,
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end,
    'currency', v_batch.currency,
    'totals', jsonb_build_object(
      'net_payout', round(coalesce(v_net,0),2),
      'sales', round(coalesce(v_sales,0),2),
      'fees', round(coalesce(v_fees,0),2),
      'refunds', round(coalesce(v_refunds,0),2),
      'tcs', round(coalesce(v_tcs,0),2),
      'tds', round(coalesce(v_tds,0),2),
      'adjustments', round(coalesce(v_adjustments,0),2),
      'total_debit', round(coalesce(v_total_dr,0),2),
      'total_credit', round(coalesce(v_total_cr,0),2)
    ),
    'lines', v_lines,
    'warnings', coalesce(v_warnings, '{}'::text[]),
    'can_post', (coalesce(array_length(coalesce(v_warnings,'{}'::text[]),1),0) = 0),
    'posted', case when v_journal_id is null then null else jsonb_build_object('journal_id', v_journal_id, 'journal_no', v_journal_no) end
  );
end;
$$;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end$$;
