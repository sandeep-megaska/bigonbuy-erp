-- 0400_amazon_settlement_posting_preview_rpc.sql
-- Creates: public.erp_amazon_settlement_batch_preview_post_to_finance(p_batch_id uuid) RETURNS jsonb

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

  v_batch_id uuid;
  v_batch_ref text;
  v_period_start date;
  v_period_end date;
  v_currency text;
  v_batch_net_payout numeric;

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

  v_sales_acc uuid;
  v_fees_acc uuid;
  v_refunds_acc uuid;
  v_tcs_acc uuid;
  v_tds_acc uuid;
  v_adj_acc uuid;
  v_clearing_acc uuid;

  v_journal_id uuid := null;
  v_journal_no text := null;

  v_txn_count int := 0;

  v_dr numeric;
  v_cr numeric;
begin
  perform public.erp_require_finance_reader();

  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  v_company_id := public.erp_current_company_id();

  select
    b.id,
    b.batch_ref,
    b.period_start,
    b.period_end,
    b.currency,
    b.net_payout
  into
    v_batch_id,
    v_batch_ref,
    v_period_start,
    v_period_end,
    v_currency,
    v_batch_net_payout
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

  -- Canonical net payout: batch.net_payout (your 0399 fixed this)
  v_net := coalesce(v_batch_net_payout, v_net, 0);

  -- Adjustments plug so all buckets reconcile to net payout
  v_adjustments := round(
    v_net
    - (
      coalesce(v_sales,0)
      + coalesce(v_fees,0)
      + coalesce(v_refunds,0)
      + coalesce(v_tcs,0)
      + coalesce(v_tds,0)
    ),
    2
  );

  if v_txn_count = 0 then
    v_warnings := array_append(v_warnings, 'No normalized settlement transactions found for this batch.');
  end if;

  -- Role -> account mappings (Posting settings)
  select account_id into v_sales_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_sales_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_fees_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_fees_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_refunds_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_refunds_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_tcs_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_tcs_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_tds_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_tds_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_adj_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_adjustments_account'
  order by updated_at desc nulls last
  limit 1;

  select account_id into v_clearing_acc
  from public.erp_fin_coa_role_accounts
  where company_id = v_company_id and role_key = 'amazon_settlement_clearing_account'
  order by updated_at desc nulls last
  limit 1;

  if v_sales_acc is null then v_warnings := array_append(v_warnings, 'Missing COA role: amazon_settlement_sales_account'); end if;
  if v_fees_acc is null then v_warnings := array_append(v_warnings, 'Missing COA role: amazon_settlement_fees_account'); end if;
  if v_refunds_acc is null then v_warnings := array_append(v_warnings, 'Missing COA role: amazon_settlement_refunds_account'); end if;
  if v_adj_acc is null then v_warnings := array_append(v_warnings, 'Missing COA role: amazon_settlement_adjustments_account'); end if;
  if v_clearing_acc is null then v_warnings := array_append(v_warnings, 'Missing COA role: amazon_settlement_clearing_account'); end if;

  -- Build lines (dr/cr sign-safe)
  -- SALES: usually credit if positive
  if coalesce(v_sales,0) <> 0 then
    if v_sales >= 0 then v_dr := 0; v_cr := v_sales; else v_dr := -v_sales; v_cr := 0; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_sales_account','account_id',v_sales_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','Sales'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- FEES: often negative -> debit
  if coalesce(v_fees,0) <> 0 then
    if v_fees <= 0 then v_dr := -v_fees; v_cr := 0; else v_dr := 0; v_cr := v_fees; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_fees_account','account_id',v_fees_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','Fees'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- REFUNDS: often negative -> debit
  if coalesce(v_refunds,0) <> 0 then
    if v_refunds <= 0 then v_dr := -v_refunds; v_cr := 0; else v_dr := 0; v_cr := v_refunds; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_refunds_account','account_id',v_refunds_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','Refunds'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- TCS / TDS (optional)
  if coalesce(v_tcs,0) <> 0 and v_tcs_acc is not null then
    if v_tcs <= 0 then v_dr := -v_tcs; v_cr := 0; else v_dr := 0; v_cr := v_tcs; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_tcs_account','account_id',v_tcs_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','TCS'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  if coalesce(v_tds,0) <> 0 and v_tds_acc is not null then
    if v_tds <= 0 then v_dr := -v_tds; v_cr := 0; else v_dr := 0; v_cr := v_tds; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_tds_account','account_id',v_tds_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','TDS'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- ADJUSTMENTS plug
  if coalesce(v_adjustments,0) <> 0 then
    if v_adjustments <= 0 then v_dr := -v_adjustments; v_cr := 0; else v_dr := 0; v_cr := v_adjustments; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_adjustments_account','account_id',v_adj_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','Adjustments'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- CLEARING: final balancing plug
  if round(v_total_dr - v_total_cr,2) <> 0 then
    if v_total_cr > v_total_dr then
      v_dr := v_total_cr - v_total_dr; v_cr := 0;
    else
      v_dr := 0; v_cr := v_total_dr - v_total_cr;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key','amazon_settlement_clearing_account','account_id',v_clearing_acc,'account_code',null,'account_name',null,'dr',round(v_dr,2),'cr',round(v_cr,2),'label','Clearing'
    ));
    v_total_dr := v_total_dr + v_dr; v_total_cr := v_total_cr + v_cr;
  end if;

  -- If you have a post bridge table, keep this optional (won't fail if missing)
  begin
    select p.journal_id into v_journal_id
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id and p.batch_id = p_batch_id
    order by p.created_at desc
    limit 1;

    if v_journal_id is not null then
      select j.doc_no into v_journal_no
      from public.erp_fin_journals j
      where j.id = v_journal_id;
    end if;
  exception when undefined_table then
    v_journal_id := null;
    v_journal_no := null;
  end;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_ref', v_batch_ref,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'currency', v_currency,
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
    'can_post', (coalesce(array_length(v_warnings,1),0) = 0),
    'posted', case
      when v_journal_id is null then null
      else jsonb_build_object('journal_id', v_journal_id, 'journal_no', v_journal_no)
    end
  );
end;
$$;

-- Optional: helps right after deploy (if permitted)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end$$;
