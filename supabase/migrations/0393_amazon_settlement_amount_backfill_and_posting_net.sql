-- 0393_amazon_settlement_amount_backfill_and_posting_net.sql
begin;

create or replace function public.safe_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_trimmed text;
begin
  v_trimmed := nullif(trim(coalesce(p_value, '')), '');
  if v_trimmed is null then
    return null;
  end if;

  begin
    return v_trimmed::numeric;
  exception when others then
    return null;
  end;
end;
$$;

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

  insert into public.erp_marketplace_settlement_batches (
    company_id,
    channel_id,
    status,
    batch_ref,
    period_start,
    period_end,
    currency,
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
    coalesce(v_currency, 'INR'),
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
    currency = excluded.currency,
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

create or replace function public.erp_amazon_settlement_txns_backfill_amounts(
  p_batch_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_updated integer := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;

  update public.erp_marketplace_settlement_txns t
  set
    gross_sales = coalesce(t.gross_sales, d.gross_sales),
    total_fees = coalesce(t.total_fees, d.total_fees),
    refund_amount = coalesce(t.refund_amount, d.refund_amount),
    other_charges = coalesce(t.other_charges, d.other_charges)
  from (
    select
      x.id,
      case
        when x.price_amount is null then null
        when x.is_refund then null
        when x.price_type in ('principal', 'product tax') then x.price_amount
        else null
      end as gross_sales,
      x.item_related_fee_amount as total_fees,
      case
        when x.price_amount is null then null
        when x.is_refund then x.price_amount
        else null
      end as refund_amount,
      (
        case
          when x.price_amount is null or x.is_refund or x.price_type in ('principal', 'product tax') then 0
          else x.price_amount
        end
        + coalesce(x.shipment_fee_amount, 0)
        + coalesce(x.order_fee_amount, 0)
        + coalesce(x.promotion_amount, 0)
        + coalesce(x.direct_payment_amount, 0)
        + coalesce(x.other_amount, 0)
      ) as other_charges
    from (
      select
        t1.id,
        lower(nullif(trim(coalesce(t1.raw -> 'raw' ->> 'price-type', '')), '')) as price_type,
        lower(nullif(trim(coalesce(t1.raw -> 'raw' ->> 'transaction-type', t1.settlement_type, '')), '')) in ('refund', 'fulfillment fee refund') as is_refund,
        public.safe_numeric(t1.raw -> 'raw' ->> 'price-amount') as price_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'item-related-fee-amount') as item_related_fee_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'shipment-fee-amount') as shipment_fee_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'order-fee-amount') as order_fee_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'promotion-amount') as promotion_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'direct-payment-amount') as direct_payment_amount,
        public.safe_numeric(t1.raw -> 'raw' ->> 'other-amount') as other_amount
      from public.erp_marketplace_settlement_txns t1
      where t1.company_id = v_company_id
        and t1.batch_id = p_batch_id
        and (t1.gross_sales is null or t1.total_fees is null or t1.refund_amount is null or t1.other_charges is null)
    ) x
  ) d
  where t.id = d.id
    and t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.erp_amazon_settlement_txns_backfill_amounts(uuid) from public;
grant execute on function public.erp_amazon_settlement_txns_backfill_amounts(uuid) to authenticated;

create or replace function public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text default 'all',
  p_limit int default 50,
  p_offset int default 0
)
returns table (
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
  normalized_state boolean,
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
  with channel as (
    select ch.id
    from public.erp_sales_channels ch
    where ch.company_id = v_company_id
      and lower(ch.code) = 'amazon'
    limit 1
  ),
  base as (
    select
      b.id        as batch_id,
      b.batch_ref,
      b.period_start,
      b.period_end,
      b.currency,
      b.created_at
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(sum(coalesce(t.gross_sales, 0) + coalesce(t.total_fees, 0) + coalesce(t.refund_amount, 0) + coalesce(t.other_charges, 0)), 0) as net_payout,
      count(*)::int as txn_count
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select b.batch_id from base b)
    group by t.batch_id
  ),
  posts as (
    select
      fp.batch_id,
      fp.posting_state,
      fp.journal_id,
      j.doc_no as journal_no
    from public.erp_marketplace_settlement_finance_posts fp
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = fp.journal_id
    where fp.company_id = v_company_id
      and fp.platform = 'amazon'
  ),
  report_links_ranked as (
    select
      rl.batch_id,
      rl.report_id,
      row_number() over (
        partition by rl.batch_id
        order by
          rp.updated_at desc nulls last,
          rl.created_at desc,
          rl.report_id desc
      ) as rn
    from public.erp_marketplace_settlement_report_links rl
    left join public.erp_marketplace_settlement_report_payloads rp
      on rp.company_id = v_company_id
     and rp.report_id = rl.report_id
    where rl.company_id = v_company_id
      and rl.batch_id in (select b.batch_id from base b)
  ),
  reports as (
    select
      rlr.batch_id,
      rlr.report_id
    from report_links_ranked rlr
    where rlr.rn = 1
  )
  select
    b.batch_id,
    b.batch_ref,
    b.period_start as settlement_start_date,
    b.period_end   as settlement_end_date,
    null::date     as deposit_date,
    b.currency,
    coalesce(t.net_payout, 0) as net_payout,
    coalesce(fp.posting_state, 'missing') as posting_state,
    fp.journal_id,
    fp.journal_no,
    r.report_id,
    coalesce(t.txn_count, 0) as txn_count,
    (coalesce(t.txn_count, 0) > 0) as normalized_state,
    (coalesce(t.txn_count, 0) > 0) as has_txns
  from base b
  left join totals t
    on t.batch_id = b.batch_id
  left join posts fp
    on fp.batch_id = b.batch_id
  left join reports r
    on r.batch_id = b.batch_id
  where
    v_status = 'all'
    or coalesce(fp.posting_state, 'missing') = v_status
  order by
    coalesce(b.period_end, b.period_start) desc,
    b.created_at desc nulls last
  limit p_limit
  offset p_offset;

end;
$$;

create or replace function public.erp_amazon_settlement_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_batches int,
  posted int,
  missing int,
  excluded int,
  total_net_payout numeric
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
      b.id
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(sum(coalesce(t.gross_sales, 0) + coalesce(t.total_fees, 0) + coalesce(t.refund_amount, 0) + coalesce(t.other_charges, 0)), 0) as net_payout
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select id from base)
    group by t.batch_id
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
    count(*)::int as total_batches,
    sum(case when coalesce(p.posting_state, 'missing') = 'posted' then 1 else 0 end)::int as posted,
    sum(case when coalesce(p.posting_state, 'missing') = 'missing' then 1 else 0 end)::int as missing,
    sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then 1 else 0 end)::int as excluded,
    coalesce(sum(t.net_payout), 0) as total_net_payout
  from base b
  left join totals t
    on t.batch_id = b.id
  left join posts p
    on p.batch_id = b.id;
end;
$$;

create or replace function public.erp_amazon_settlement_posting_preview(
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_batch record;
  v_totals record;
  v_net_payout numeric(14,2) := 0;
  v_sales_total numeric(14,2) := 0;
  v_fees_total numeric(14,2) := 0;
  v_refunds_total numeric(14,2) := 0;
  v_tcs_total numeric(14,2) := 0;
  v_tds_total numeric(14,2) := 0;
  v_adjustments_total numeric(14,2) := 0;
  v_warnings text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_can_post boolean := false;
  v_post record;
  v_clearing record;
  v_sales record;
  v_fees record;
  v_refunds record;
  v_tcs record;
  v_tds record;
  v_adjustments record;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
begin
  perform public.erp_require_finance_reader();

  select b.*
    into v_batch
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch
      on ch.id = b.channel_id
   where b.company_id = v_company_id
     and b.id = p_batch_id
     and lower(ch.code) = 'amazon'
   limit 1;

  if v_batch.id is null then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'lines', '[]'::jsonb,
      'warnings', jsonb_build_array('Settlement batch not found'),
      'can_post', false
    );
  end if;

  perform public.erp_amazon_settlement_txns_backfill_amounts(p_batch_id);

  select
    coalesce(sum(coalesce(t.gross_sales, 0)), 0) as sales_total,
    coalesce(
      sum(
        coalesce(
          t.total_fees,
          coalesce(t.shipping_fee, 0) + coalesce(t.commission_fee, 0) + coalesce(t.fixed_fee, 0) + coalesce(t.closing_fee, 0)
        )
      ),
      0
    ) as fees_total,
    coalesce(sum(coalesce(t.refund_amount, 0)), 0) as refunds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tcs_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tds%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%'
            or lower(coalesce(t.settlement_type, '')) like '%tds%'
          then 0
          else coalesce(t.other_charges, 0)
        end
      ),
      0
    ) as adjustments_total,
    coalesce(sum(coalesce(t.gross_sales, 0) + coalesce(t.total_fees, 0) + coalesce(t.refund_amount, 0) + coalesce(t.other_charges, 0)), 0) as net_payout_total,
    count(*) as txn_count
    into v_totals
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  v_sales_total := round(coalesce(v_totals.sales_total, 0), 2);
  v_fees_total := round(coalesce(v_totals.fees_total, 0), 2);
  v_refunds_total := round(coalesce(v_totals.refunds_total, 0), 2);
  v_tcs_total := round(coalesce(v_totals.tcs_total, 0), 2);
  v_tds_total := round(coalesce(v_totals.tds_total, 0), 2);
  v_adjustments_total := round(coalesce(v_totals.adjustments_total, 0), 2);
  v_net_payout := round(coalesce(v_totals.net_payout_total, 0), 2);

  if coalesce(v_totals.txn_count, 0) = 0 then
    v_warnings := array_append(v_warnings, 'No settlement transactions found');
  end if;

    select id, code, name into v_clearing
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_clearing_account';

  select id, code, name into v_sales
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_sales_account';

  select id, code, name into v_fees
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_fees_account';

  select id, code, name into v_refunds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_refunds_account';

  select id, code, name into v_tcs
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tcs_account';

  select id, code, name into v_tds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tds_account';

  select id, code, name into v_adjustments
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_adjustments_account';

  if abs(v_net_payout) < 0.01 then
    v_warnings := array_append(v_warnings, 'Net payout total is zero');
  end if;

  if abs(v_net_payout) >= 0.01 and v_clearing.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_clearing_account');
  end if;

  if v_sales_total > 0 and v_sales.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_sales_account');
  end if;

  if v_fees_total > 0 and v_fees.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_fees_account');
  end if;

  if v_refunds_total > 0 and v_refunds.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_refunds_account');
  end if;

  if v_tcs_total > 0 and v_tcs.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_tcs_account');
  end if;

  if v_tds_total > 0 and v_tds.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_tds_account');
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_adjustments_account');
  end if;

  if abs(v_net_payout) >= 0.01 and v_clearing.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_clearing_account',
        'account_id', v_clearing.id,
        'account_code', v_clearing.code,
        'account_name', v_clearing.name,
        'dr', v_net_payout,
        'cr', 0,
        'label', 'Amazon settlement clearing'
      )
    );
    v_total_debit := v_total_debit + v_net_payout;
  end if;

  if v_sales_total > 0 and v_sales.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_sales_account',
        'account_id', v_sales.id,
        'account_code', v_sales.code,
        'account_name', v_sales.name,
        'dr', 0,
        'cr', v_sales_total,
        'label', 'Amazon settlement sales'
      )
    );
    v_total_credit := v_total_credit + v_sales_total;
  end if;

  if v_fees_total > 0 and v_fees.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_fees_account',
        'account_id', v_fees.id,
        'account_code', v_fees.code,
        'account_name', v_fees.name,
        'dr', v_fees_total,
        'cr', 0,
        'label', 'Amazon settlement fees'
      )
    );
    v_total_debit := v_total_debit + v_fees_total;
  end if;

  if v_refunds_total > 0 and v_refunds.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_refunds_account',
        'account_id', v_refunds.id,
        'account_code', v_refunds.code,
        'account_name', v_refunds.name,
        'dr', v_refunds_total,
        'cr', 0,
        'label', 'Amazon settlement refunds'
      )
    );
    v_total_debit := v_total_debit + v_refunds_total;
  end if;

  if v_tcs_total > 0 and v_tcs.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_tcs_account',
        'account_id', v_tcs.id,
        'account_code', v_tcs.code,
        'account_name', v_tcs.name,
        'dr', v_tcs_total,
        'cr', 0,
        'label', 'Amazon settlement TCS'
      )
    );
    v_total_debit := v_total_debit + v_tcs_total;
  end if;

  if v_tds_total > 0 and v_tds.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_tds_account',
        'account_id', v_tds.id,
        'account_code', v_tds.code,
        'account_name', v_tds.name,
        'dr', v_tds_total,
        'cr', 0,
        'label', 'Amazon settlement TDS'
      )
    );
    v_total_debit := v_total_debit + v_tds_total;
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_adjustments_account',
        'account_id', v_adjustments.id,
        'account_code', v_adjustments.code,
        'account_name', v_adjustments.name,
        'dr', v_adjustments_total,
        'cr', 0,
        'label', 'Amazon settlement adjustments'
      )
    );
    v_total_debit := v_total_debit + v_adjustments_total;
  end if;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    v_warnings := array_append(v_warnings, 'Journal out of balance');
  end if;

  if array_length(v_warnings, 1) is null then
    v_can_post := true;
  end if;

  select p.journal_id, j.doc_no
    into v_post
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.platform = 'amazon'
      and p.batch_id = v_batch.id
      and p.posting_state = 'posted'
    limit 1;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_ref', v_batch.batch_ref,
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end,
    'currency', v_batch.currency,
    'totals', jsonb_build_object(
      'net_payout', v_net_payout,
      'sales', v_sales_total,
      'fees', v_fees_total,
      'refunds', v_refunds_total,
      'tcs', v_tcs_total,
      'tds', v_tds_total,
      'adjustments', v_adjustments_total,
      'total_debit', v_total_debit,
      'total_credit', v_total_credit
    ),
    'lines', v_lines,
    'warnings', to_jsonb(v_warnings),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', v_post.journal_id,
      'journal_no', v_post.doc_no
    )
  );
end;
$$;

create or replace function public.erp_amazon_settlement_post_to_finance(
  p_batch_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_batch record;
  v_existing uuid;
  v_post record;
  v_post_date date;
  v_journal_id uuid;
  v_doc_no text;
  v_line_no int := 1;
  v_sales_total numeric(14,2) := 0;
  v_fees_total numeric(14,2) := 0;
  v_refunds_total numeric(14,2) := 0;
  v_tcs_total numeric(14,2) := 0;
  v_tds_total numeric(14,2) := 0;
  v_adjustments_total numeric(14,2) := 0;
  v_net_payout numeric(14,2) := 0;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_clearing record;
  v_sales record;
  v_fees record;
  v_refunds record;
  v_tcs record;
  v_tds record;
  v_adjustments record;
  v_totals record;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select b.*
    into v_batch
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch
      on ch.id = b.channel_id
   where b.company_id = v_company_id
     and b.id = p_batch_id
     and lower(ch.code) = 'amazon'
   for update;

  if v_batch.id is null then
    raise exception 'Settlement batch not found';
  end if;

  perform public.erp_amazon_settlement_txns_backfill_amounts(p_batch_id);

  select posting_state, journal_id
    into v_post
    from public.erp_marketplace_settlement_finance_posts p
   where p.company_id = v_company_id
     and p.platform = 'amazon'
     and p.batch_id = p_batch_id
   for update;

  if v_post.journal_id is not null and v_post.posting_state = 'posted' then
    return v_post.journal_id;
  end if;

  if v_post.posting_state = 'excluded' then
    raise exception 'Settlement batch is excluded from posting';
  end if;

  select j.id
    into v_existing
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.reference_type = 'amazon_settlement_batch'
      and j.reference_id = p_batch_id
    order by j.created_at desc nulls last
    limit 1;

  if v_existing is not null then
    insert into public.erp_marketplace_settlement_finance_posts (
      company_id,
      platform,
      batch_id,
      posting_state,
      journal_id,
      posted_at,
      posted_by,
      updated_at,
      updated_by
    ) values (
      v_company_id,
      'amazon',
      p_batch_id,
      'posted',
      v_existing,
      now(),
      v_actor,
      now(),
      v_actor
    )
    on conflict (company_id, platform, batch_id)
    do update set
      posting_state = excluded.posting_state,
      journal_id = excluded.journal_id,
      posted_at = excluded.posted_at,
      posted_by = excluded.posted_by,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    return v_existing;
  end if;

  select
    coalesce(sum(coalesce(t.gross_sales, 0)), 0) as sales_total,
    coalesce(
      sum(
        coalesce(
          t.total_fees,
          coalesce(t.shipping_fee, 0) + coalesce(t.commission_fee, 0) + coalesce(t.fixed_fee, 0) + coalesce(t.closing_fee, 0)
        )
      ),
      0
    ) as fees_total,
    coalesce(sum(coalesce(t.refund_amount, 0)), 0) as refunds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tcs_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tds%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%'
            or lower(coalesce(t.settlement_type, '')) like '%tds%'
          then 0
          else coalesce(t.other_charges, 0)
        end
      ),
      0
    ) as adjustments_total,
    coalesce(sum(coalesce(t.gross_sales, 0) + coalesce(t.total_fees, 0) + coalesce(t.refund_amount, 0) + coalesce(t.other_charges, 0)), 0) as net_payout_total,
    count(*) as txn_count
    into v_totals
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  v_sales_total := round(coalesce(v_totals.sales_total, 0), 2);
  v_fees_total := round(coalesce(v_totals.fees_total, 0), 2);
  v_refunds_total := round(coalesce(v_totals.refunds_total, 0), 2);
  v_tcs_total := round(coalesce(v_totals.tcs_total, 0), 2);
  v_tds_total := round(coalesce(v_totals.tds_total, 0), 2);
  v_adjustments_total := round(coalesce(v_totals.adjustments_total, 0), 2);
  v_net_payout := round(coalesce(v_totals.net_payout_total, 0), 2);

  if coalesce(v_totals.txn_count, 0) = 0 then
    raise exception 'No settlement transactions found';
  end if;

    if abs(v_net_payout) < 0.01 then
    raise exception 'Net payout total is zero';
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_clearing_account';

  select id, code, name into v_sales
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_sales_account';

  select id, code, name into v_fees
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_fees_account';

  select id, code, name into v_refunds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_refunds_account';

  select id, code, name into v_tcs
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tcs_account';

  select id, code, name into v_tds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tds_account';

  select id, code, name into v_adjustments
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_adjustments_account';

  if v_clearing.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_clearing_account';
  end if;

  if v_sales_total > 0 and v_sales.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_sales_account';
  end if;

  if v_fees_total > 0 and v_fees.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_fees_account';
  end if;

  if v_refunds_total > 0 and v_refunds.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_refunds_account';
  end if;

  if v_tcs_total > 0 and v_tcs.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_tcs_account';
  end if;

  if v_tds_total > 0 and v_tds.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_tds_account';
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_adjustments_account';
  end if;

  v_total_debit := v_net_payout + v_fees_total + v_refunds_total + v_tcs_total + v_tds_total + v_adjustments_total;
  v_total_credit := v_sales_total;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'Journal out of balance';
  end if;

  v_post_date := coalesce(v_batch.period_end, v_batch.period_start, current_date);
  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    format('Amazon settlement %s', coalesce(v_batch.batch_ref, v_batch.id::text)),
    'amazon_settlement_batch',
    v_batch.id,
    v_total_debit,
    v_total_credit,
    v_actor
  ) returning id into v_journal_id;

  if v_net_payout > 0 then
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
      v_clearing.code,
      v_clearing.name,
      'Amazon settlement clearing',
      v_net_payout,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_sales_total > 0 then
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
      v_sales.code,
      v_sales.name,
      'Amazon settlement sales',
      0,
      v_sales_total
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_fees_total > 0 then
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
      v_fees.code,
      v_fees.name,
      'Amazon settlement fees',
      v_fees_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_refunds_total > 0 then
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
      v_refunds.code,
      v_refunds.name,
      'Amazon settlement refunds',
      v_refunds_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_tcs_total > 0 then
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
      v_tcs.code,
      v_tcs.name,
      'Amazon settlement TCS',
      v_tcs_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_tds_total > 0 then
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
      v_tds.code,
      v_tds.name,
      'Amazon settlement TDS',
      v_tds_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_adjustments_total > 0 then
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
      v_adjustments.code,
      v_adjustments.name,
      'Amazon settlement adjustments',
      v_adjustments_total,
      0
    );
  end if;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_marketplace_settlement_finance_posts (
    company_id,
    platform,
    batch_id,
    posting_state,
    journal_id,
    posted_at,
    posted_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    'amazon',
    p_batch_id,
    'posted',
    v_journal_id,
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, platform, batch_id)
  do update set
    posting_state = excluded.posting_state,
    journal_id = excluded.journal_id,
    posted_at = excluded.posted_at,
    posted_by = excluded.posted_by,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return v_journal_id;
exception
  when unique_violation then
    select p.journal_id
      into v_existing
      from public.erp_marketplace_settlement_finance_posts p
      where p.company_id = v_company_id
        and p.platform = 'amazon'
        and p.batch_id = p_batch_id
        and p.posting_state = 'posted'
      limit 1;

    if v_existing is not null then
      return v_existing;
    end if;

    raise;
end;
$$;

commit;
