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

  -- role -> account_id mapping (from Posting settings)
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

  -- helpers
  function add_line(p_role text, p_account_id uuid, p_dr numeric, p_cr numeric, p_label text default null)
  returns void
  language plpgsql
  as $f$
  begin
    -- never negative dr/cr
    p_dr := greatest(coalesce(p_dr,0),0);
    p_cr := greatest(coalesce(p_cr,0),0);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'role_key', p_role,
      'account_id', p_account_id,
      'account_code', null,
      'account_name', null,
      'dr', round(p_dr, 2),
      'cr', round(p_cr, 2),
      'label', p_label
    ));

    v_total_dr := v_total_dr + p_dr;
    v_total_cr := v_total_cr + p_cr;
  end;
  $f$;
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

  -- txn_count and core totals from normalized txns
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

  -- Best-effort TCS/TDS detection (based on settlement_type / raw fields)
  select
    round(coalesce(sum(case
      when lower(coalesce(t.settlement_type,'')) like '%tcs%'
        or lower(coalesce(t.raw->>'amount-type','')) like '%tcs%'
        or lower(coalesce(t.raw->>'settlement_type','')) like '%tcs%'
      then coalesce(t.net_payout,0) else 0 end),0),2),
    round(coalesce(sum(case
      when lower(coalesce(t.settlement_type,'')) like '%tds%'
        or lower(coalesce(t.raw->>'amount-type','')) like '%tds%'
        or lower(coalesce(t.raw->>'settlement_type','')) like '%tds%'
      then coalesce(t.net_payout,0) else 0 end),0),2)
  into v_tcs, v_tds
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  -- Canonical net payout: batch.net_payout (already fixed by 0399)
  v_net := coalesce(v_batch.net_payout, v_net, 0);

  -- adjustments = plug so buckets reconcile to net
  v_adjustments := round(v_net - (coalesce(v_sales,0) + coalesce(v_fees,0) + coalesce(v_refunds,0) + coalesce(v_tcs,0) + coalesce(v_tds,0)), 2);

  if v_txn_count = 0 then
    v_warnings := array_append(v_warnings, 'No normalized settlement transactions found for this batch.');
  end if;

  -- Pull COA role accounts (Posting settings page writes these)
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

  -- Stage-1 line construction (sign-safe)
  -- Sales normally CREDIT if positive
  if coalesce(v_sales,0) >= 0 then
    perform add_line('amazon_settlement_sales_account', v_sales_acc, 0, v_sales, 'Sales');
  else
    v_warnings := array_append(v_warnings, 'Sales total is negative; check normalization/signs.');
    perform add_line('amazon_settlement_sales_account', v_sales_acc, -v_sales, 0, 'Sales (negative)');
  end if;

  -- Fees normally DEBIT (fees in data often negative)
  if coalesce(v_fees,0) <= 0 then
    perform add_line('amazon_settlement_fees_account', v_fees_acc, -v_fees, 0, 'Fees');
  else
    v_warnings := array_append(v_warnings, 'Fees total is positive; check normalization/signs.');
    perform add_line('amazon_settlement_fees_account', v_fees_acc, 0, v_fees, 'Fees (positive)');
  end if;

  -- Refunds normally DEBIT (refunds in data often negative)
  if coalesce(v_refunds,0) <= 0 then
    perform add_line('amazon_settlement_refunds_account', v_refunds_acc, -v_refunds, 0, 'Refunds');
  else
    v_warnings := array_append(v_warnings, 'Refunds total is positive; check normalization/signs.');
    perform add_line('amazon_settlement_refunds_account', v_refunds_acc, 0, v_refunds, 'Refunds (positive)');
  end if;

  -- TCS/TDS if present (treated like withholdings; usually negative -> debit)
  if coalesce(v_tcs,0) <> 0 then
    if v_tcs <= 0 then
      perform add_line('amazon_settlement_tcs_account', v_tcs_acc, -v_tcs, 0, 'TCS');
    else
      perform add_line('amazon_settlement_tcs_account', v_tcs_acc, 0, v_tcs, 'TCS (positive)');
    end if;
  end if;

  if coalesce(v_tds,0) <> 0 then
    if v_tds <= 0 then
      perform add_line('amazon_settlement_tds_account', v_tds_acc, -v_tds, 0, 'TDS');
    else
      perform add_line('amazon_settlement_tds_account', v_tds_acc, 0, v_tds, 'TDS (positive)');
    end if;
  end if;

  -- Adjustments bucket (by sign)
  if coalesce(v_adjustments,0) <> 0 then
    if v_adjustments <= 0 then
      perform add_line('amazon_settlement_adjustments_account', v_adj_acc, -v_adjustments, 0, 'Adjustments');
    else
      perform add_line('amazon_settlement_adjustments_account', v_adj_acc, 0, v_adjustments, 'Adjustments');
    end if;
  end if;

  -- Clearing plug to balance
  if round(v_total_dr - v_total_cr,2) <> 0 then
    if v_total_cr > v_total_dr then
      perform add_line('amazon_settlement_clearing_account', v_clearing_acc, v_total_cr - v_total_dr, 0, 'Clearing');
    else
      perform add_line('amazon_settlement_clearing_account', v_clearing_acc, 0, v_total_dr - v_total_cr, 'Clearing');
    end if;
  end if;

  -- Check if already posted (best-effort: look for a bridge row; adjust table/cols if yours differ)
  begin
    select p.journal_id into v_journal_id
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id and p.batch_id = p_batch_id
    order by p.created_at desc
    limit 1;
  exception when undefined_table then
    -- ignore if table not present yet
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
    'can_post', (array_length(coalesce(v_warnings,'{}'::text[]),1) is null or array_length(coalesce(v_warnings,'{}'::text[]),1)=0),
    'posted', case when v_journal_id is null then null else jsonb_build_object('journal_id', v_journal_id, 'journal_no', v_journal_no) end
  );
end;
$$;

-- Optional: force PostgREST schema reload (helps avoid "schema cache" errors right after deploy)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  -- ignore if notify not permitted
  null;
end$$;
    