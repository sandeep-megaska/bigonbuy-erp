-- 0398_amazon_settlement_batch_level_net_payout.sql
begin;

alter table if exists public.erp_marketplace_settlement_batches
  add column if not exists deposit_date date,
  add column if not exists net_payout numeric(14,2);

create or replace function public.erp_marketplace_settlement_batch_upsert_from_amazon_report(
  p_report_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_channel_id uuid;
  v_batch_id uuid;
  v_payload jsonb;
  v_summary jsonb;
  v_rows jsonb;
  v_row jsonb;
  v_inserted_rows int := 0;
  v_attempted_rows int := 0;
  v_row_hash text;
  v_rowcount int;
  v_txn_date date;
  v_order_id text;
  v_sub_order_id text;
  v_sku text;
  v_qty int;
  v_gross_sales numeric;
  v_net_payout numeric;
  v_total_fees numeric;
  v_shipping_fee numeric;
  v_commission_fee numeric;
  v_fixed_fee numeric;
  v_closing_fee numeric;
  v_refund_amount numeric;
  v_other_charges numeric;
  v_settlement_type text;
  v_raw jsonb;
  v_price_amount numeric;
  v_item_related_fee_amount numeric;
  v_shipment_fee_amount numeric;
  v_order_fee_amount numeric;
  v_promotion_amount numeric;
  v_direct_payment_amount numeric;
  v_other_amount numeric;
  v_price_type text;
  v_transaction_type text;
  v_is_refund boolean;
  v_batch_ref text;
  v_currency text;
  v_period_start date;
  v_period_end date;
  v_deposit_date date;
  v_batch_net_payout numeric(14,2);
begin
  perform public.erp_require_marketplace_writer();

  if p_report_id is null or trim(p_report_id) = '' then
    raise exception 'Report ID is required';
  end if;

  v_company_id := public.erp_current_company_id();
  v_channel_id := public.erp_amazon_channel_id_get(v_company_id);
  if v_channel_id is null then
    raise exception 'Amazon channel missing for company %', v_company_id;
  end if;

  select payload
    into v_payload
  from public.erp_marketplace_settlement_report_payloads
  where company_id = v_company_id
    and report_id = p_report_id
  order by created_at desc
  limit 1;

  if v_payload is null then
    raise exception 'Settlement report payload not staged for %', p_report_id;
  end if;

  v_summary := v_payload -> 'summary';
  v_rows := v_payload -> 'rows';

  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Rows payload must be a JSON array';
  end if;

  v_batch_ref := nullif(trim(coalesce(v_summary ->> 'settlement_id', p_report_id)), '');
  v_currency := nullif(trim(coalesce(v_summary ->> 'currency', 'INR')), '');
  begin
    v_period_start := nullif(trim(v_summary ->> 'period_start'), '')::date;
  exception when others then
    v_period_start := null;
  end;
  begin
    v_period_end := nullif(trim(v_summary ->> 'period_end'), '')::date;
  exception when others then
    v_period_end := null;
  end;
  begin
    v_deposit_date := nullif(trim(v_summary ->> 'deposit_date'), '')::date;
  exception when others then
    v_deposit_date := null;
  end;
  begin
    v_batch_net_payout := round(coalesce(nullif(trim(v_summary ->> 'net_payout'), '')::numeric, 0), 2);
  exception when others then
    v_batch_net_payout := null;
  end;

  insert into public.erp_marketplace_settlement_batches (
    company_id,
    channel_id,
    status,
    batch_ref,
    period_start,
    period_end,
    deposit_date,
    currency,
    net_payout,
    notes,
    uploaded_filename,
    uploaded_at,
    uploaded_by,
    processed_at,
    processed_by
  )
  values (
    v_company_id,
    v_channel_id,
    'processed',
    v_batch_ref,
    coalesce(v_period_start, v_deposit_date, current_date),
    coalesce(v_period_end, v_deposit_date, current_date),
    v_deposit_date,
    coalesce(v_currency, 'INR'),
    v_batch_net_payout,
    concat('Normalized from Amazon settlement report ', p_report_id),
    null,
    now(),
    coalesce(p_actor_user_id, auth.uid()),
    now(),
    coalesce(p_actor_user_id, auth.uid())
  )
  on conflict (company_id, channel_id, batch_ref)
  do update set
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    deposit_date = excluded.deposit_date,
    currency = excluded.currency,
    net_payout = excluded.net_payout,
    status = 'processed',
    processed_at = now(),
    processed_by = excluded.processed_by,
    notes = excluded.notes
  returning id into v_batch_id;

  for v_row in
    select value
    from jsonb_array_elements(v_rows)
  loop
    v_attempted_rows := v_attempted_rows + 1;

    begin
      v_txn_date := nullif(trim(v_row ->> 'txn_date'), '')::date;
    exception when others then
      v_txn_date := null;
    end;
    v_order_id := nullif(trim(v_row ->> 'order_id'), '');
    v_sub_order_id := nullif(trim(v_row ->> 'sub_order_id'), '');
    v_sku := nullif(trim(v_row ->> 'sku'), '');
    begin
      v_qty := nullif(trim(v_row ->> 'qty'), '')::int;
    exception when others then
      v_qty := null;
    end;
    v_net_payout := public.safe_numeric(v_row ->> 'net_payout');
    begin
      v_shipping_fee := nullif(trim(v_row ->> 'shipping_fee'), '')::numeric;
    exception when others then
      v_shipping_fee := null;
    end;
    begin
      v_commission_fee := nullif(trim(v_row ->> 'commission_fee'), '')::numeric;
    exception when others then
      v_commission_fee := null;
    end;
    begin
      v_fixed_fee := nullif(trim(v_row ->> 'fixed_fee'), '')::numeric;
    exception when others then
      v_fixed_fee := null;
    end;
    begin
      v_closing_fee := nullif(trim(v_row ->> 'closing_fee'), '')::numeric;
    exception when others then
      v_closing_fee := null;
    end;
    v_settlement_type := nullif(trim(v_row ->> 'settlement_type'), '');

    v_raw := coalesce(v_row -> 'raw', '{}'::jsonb);
    v_price_type := lower(nullif(trim(v_raw ->> 'price-type'), ''));
    v_transaction_type := lower(nullif(trim(v_raw ->> 'transaction-type'), ''));
    v_is_refund := coalesce(v_transaction_type, lower(coalesce(v_settlement_type, ''))) in ('refund', 'fulfillment fee refund');

    v_price_amount := public.safe_numeric(v_raw ->> 'price-amount');
    v_item_related_fee_amount := public.safe_numeric(v_raw ->> 'item-related-fee-amount');
    v_shipment_fee_amount := public.safe_numeric(v_raw ->> 'shipment-fee-amount');
    v_order_fee_amount := public.safe_numeric(v_raw ->> 'order-fee-amount');
    v_promotion_amount := public.safe_numeric(v_raw ->> 'promotion-amount');
    v_direct_payment_amount := public.safe_numeric(v_raw ->> 'direct-payment-amount');
    v_other_amount := public.safe_numeric(v_raw ->> 'other-amount');

    v_gross_sales := null;
    v_total_fees := null;
    v_refund_amount := null;
    v_other_charges := null;

    if v_price_amount is not null then
      if v_is_refund then
        v_refund_amount := v_price_amount;
      elsif v_price_type in ('principal', 'product tax') then
        v_gross_sales := v_price_amount;
      else
        v_other_charges := v_price_amount;
      end if;
    end if;

    if v_item_related_fee_amount is not null then
      v_total_fees := v_item_related_fee_amount;
    end if;

    if v_shipment_fee_amount is not null then
      v_other_charges := coalesce(v_other_charges, 0) + v_shipment_fee_amount;
    end if;
    if v_order_fee_amount is not null then
      v_other_charges := coalesce(v_other_charges, 0) + v_order_fee_amount;
    end if;
    if v_promotion_amount is not null then
      v_other_charges := coalesce(v_other_charges, 0) + v_promotion_amount;
    end if;
    if v_direct_payment_amount is not null then
      v_other_charges := coalesce(v_other_charges, 0) + v_direct_payment_amount;
    end if;
    if v_other_amount is not null then
      v_other_charges := coalesce(v_other_charges, 0) + v_other_amount;
    end if;

    v_row_hash := md5(concat_ws(
      '|',
      coalesce(v_txn_date::text, ''),
      coalesce(v_order_id, ''),
      coalesce(v_sub_order_id, ''),
      coalesce(v_sku, ''),
      coalesce(v_qty::text, ''),
      coalesce(v_gross_sales::text, ''),
      coalesce(v_net_payout::text, ''),
      coalesce(v_total_fees::text, ''),
      coalesce(v_refund_amount::text, ''),
      coalesce(v_other_charges::text, ''),
      coalesce(v_settlement_type, '')
    ));

    insert into public.erp_marketplace_settlement_txns (
      company_id,
      batch_id,
      txn_date,
      order_id,
      sub_order_id,
      sku,
      qty,
      gross_sales,
      net_payout,
      total_fees,
      shipping_fee,
      commission_fee,
      fixed_fee,
      closing_fee,
      refund_amount,
      other_charges,
      settlement_type,
      raw,
      row_hash
    )
    values (
      v_company_id,
      v_batch_id,
      v_txn_date,
      v_order_id,
      v_sub_order_id,
      v_sku,
      v_qty,
      v_gross_sales,
      v_net_payout,
      v_total_fees,
      v_shipping_fee,
      v_commission_fee,
      v_fixed_fee,
      v_closing_fee,
      v_refund_amount,
      v_other_charges,
      v_settlement_type,
      coalesce(v_row, '{}'::jsonb) || jsonb_build_object('row_hash', v_row_hash),
      v_row_hash
    )
    on conflict (company_id, batch_id, row_hash)
    do nothing;

    get diagnostics v_rowcount = row_count;
    if v_rowcount > 0 then
      v_inserted_rows := v_inserted_rows + v_rowcount;
    end if;
  end loop;

  insert into public.erp_marketplace_settlement_report_links (
    company_id,
    report_id,
    batch_id
  )
  values (
    v_company_id,
    p_report_id,
    v_batch_id
  )
  on conflict (company_id, report_id)
  do nothing;

  return jsonb_build_object(
    'batch_id',
    v_batch_id,
    'attempted_rows',
    v_attempted_rows,
    'inserted_rows',
    v_inserted_rows
  );
end;
$$;

create or replace function public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text default 'all',
  p_limit int default 50,
  p_offset int default 0
) returns table (
  batch_id uuid,
  batch_ref text,
  settlement_start_date date,
  settlement_end_date date,
  deposit_date date,
  currency text,
  net_payout numeric,
  posting_state text,
  journal_id uuid,
  journal_no text,
  report_id text,
  txn_count int,
  has_txns boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with ch as (
    select sc.id as channel_id
    from public.erp_sales_channels sc
    where sc.company_id = v_company_id
      and lower(sc.code) = 'amazon'
    limit 1
  ),
  b0 as (
    select
      b.id as b_batch_id,
      b.batch_ref as b_batch_ref,
      b.period_start as b_period_start,
      b.period_end as b_period_end,
      b.deposit_date as b_deposit_date,
      b.currency as b_currency,
      b.net_payout as b_net_payout,
      b.created_at as b_created_at
    from public.erp_marketplace_settlement_batches b
    join ch on ch.channel_id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  tx as (
    select
      t.batch_id as tx_batch_id,
      count(*)::int as tx_txn_count
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select b0.b_batch_id from b0)
    group by t.batch_id
  ),
  post as (
    select
      fp.batch_id as fp_batch_id,
      fp.posting_state as fp_posting_state,
      fp.journal_id as fp_journal_id,
      j.doc_no as fp_journal_no
    from public.erp_marketplace_settlement_finance_posts fp
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = fp.journal_id
    where fp.company_id = v_company_id
      and fp.platform = 'amazon'
      and fp.batch_id in (select b0.b_batch_id from b0)
  ),
  rl_ranked as (
    select
      l.batch_id as rl_batch_id,
      l.report_id as rl_report_id,
      row_number() over (
        partition by l.batch_id
        order by l.created_at desc, l.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links l
    where l.company_id = v_company_id
      and l.batch_id in (select b0.b_batch_id from b0)
  ),
  rl as (
    select rr.rl_batch_id, rr.rl_report_id
    from rl_ranked rr
    where rr.rn = 1
  )
  select
    b0.b_batch_id as batch_id,
    b0.b_batch_ref as batch_ref,
    b0.b_period_start as settlement_start_date,
    b0.b_period_end as settlement_end_date,
    b0.b_deposit_date as deposit_date,
    b0.b_currency as currency,
    b0.b_net_payout as net_payout,
    coalesce(post.fp_posting_state, 'missing') as posting_state,
    post.fp_journal_id as journal_id,
    post.fp_journal_no as journal_no,
    rl.rl_report_id as report_id,
    coalesce(tx.tx_txn_count, 0) as txn_count,
    coalesce(tx.tx_txn_count, 0) > 0 as has_txns
  from b0
  left join tx
    on tx.tx_batch_id = b0.b_batch_id
  left join post
    on post.fp_batch_id = b0.b_batch_id
  left join rl
    on rl.rl_batch_id = b0.b_batch_id
  where
    v_status = 'all'
    or coalesce(post.fp_posting_state, 'missing') = v_status
  order by coalesce(b0.b_period_end, b0.b_period_start) desc, b0.b_created_at desc
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.erp_amazon_settlement_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_count int,
  posted_count int,
  missing_count int,
  excluded_count int,
  total_amount numeric,
  posted_amount numeric,
  missing_amount numeric,
  excluded_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = v_company_id
      and lower(code) = 'amazon'
    limit 1
  ),
  base as (
    select
      b.id,
      b.net_payout
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  posts as (
    select
      p.batch_id,
      p.posting_state
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  )
  select
    count(*)::int as total_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'posted' then 1 else 0 end), 0)::int as posted_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'missing' then 1 else 0 end), 0)::int as missing_count,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then 1 else 0 end), 0)::int as excluded_count,
    coalesce(sum(coalesce(b.net_payout, 0)), 0) as total_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'posted' then coalesce(b.net_payout, 0) else 0 end), 0) as posted_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'missing' then coalesce(b.net_payout, 0) else 0 end), 0) as missing_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then coalesce(b.net_payout, 0) else 0 end), 0) as excluded_amount
  from base b
  left join posts p
    on p.batch_id = b.id;
end;
$$;

commit;
