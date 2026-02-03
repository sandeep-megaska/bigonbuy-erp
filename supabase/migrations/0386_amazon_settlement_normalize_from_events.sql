create or replace function public.erp_amazon_channel_id_get(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_channel_id uuid;
begin
  select sc.id
  into v_channel_id
  from public.erp_sales_channels sc
  where sc.company_id = p_company_id
    and sc.code = 'amazon'
    and sc.is_active = true
  limit 1;

  if v_channel_id is null then
    raise exception 'Amazon channel not found for company %', p_company_id;
  end if;

  return v_channel_id;
end;
$$;

revoke all on function public.erp_amazon_channel_id_get(uuid) from public;
grant execute on function public.erp_amazon_channel_id_get(uuid) to authenticated;

create table if not exists public.erp_marketplace_settlement_event_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  event_id uuid not null references public.erp_settlement_events (id) on delete restrict,
  batch_id uuid not null references public.erp_marketplace_settlement_batches (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint erp_marketplace_settlement_event_links_unique unique (company_id, event_id)
);

alter table public.erp_marketplace_settlement_event_links enable row level security;
alter table public.erp_marketplace_settlement_event_links force row level security;

do $$
begin
  drop policy if exists erp_marketplace_settlement_event_links_select on public.erp_marketplace_settlement_event_links;
  drop policy if exists erp_marketplace_settlement_event_links_write on public.erp_marketplace_settlement_event_links;

  create policy erp_marketplace_settlement_event_links_select
    on public.erp_marketplace_settlement_event_links
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_marketplace_settlement_event_links_write
    on public.erp_marketplace_settlement_event_links
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );
end;
$$;

alter table public.erp_marketplace_settlement_txns
  add column if not exists row_hash text;

create unique index if not exists erp_marketplace_settlement_batches_company_channel_ref_key
  on public.erp_marketplace_settlement_batches (company_id, channel_id, batch_ref)
  where batch_ref is not null;

create unique index if not exists erp_marketplace_settlement_txns_company_batch_row_hash_key
  on public.erp_marketplace_settlement_txns (company_id, batch_id, row_hash)
  where row_hash is not null;

create or replace function public.erp_marketplace_settlement_batch_upsert_from_rows(
  p_event_id uuid,
  p_batch_ref text,
  p_period_start date,
  p_period_end date,
  p_currency text,
  p_rows jsonb,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_company_id uuid;
  v_channel_id uuid;
  v_batch_id uuid;
  v_batch_ref text;
  v_currency text;
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
begin
  perform public.erp_require_marketplace_writer();

  select *
  into v_event
  from public.erp_settlement_events
  where id = p_event_id
  limit 1;

  if not found then
    raise exception 'Settlement event not found %', p_event_id;
  end if;

  if v_event.platform <> 'amazon' or v_event.event_type <> 'AMAZON_SETTLEMENT' then
    raise exception 'Settlement event % is not an Amazon settlement', p_event_id;
  end if;

  v_company_id := v_event.company_id;
  if v_company_id <> public.erp_current_company_id() then
    raise exception 'Event company mismatch';
  end if;

  v_channel_id := public.erp_amazon_channel_id_get(v_company_id);
  if v_channel_id is null then
    raise exception 'Amazon channel missing for company %', v_company_id;
  end if;

  v_batch_ref := nullif(trim(coalesce(p_batch_ref, v_event.reference_no, p_event_id::text)), '');
  v_currency := nullif(trim(coalesce(p_currency, v_event.currency)), '');

  if v_batch_ref is null then
    raise exception 'Batch reference is required';
  end if;

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
    coalesce(p_period_start, v_event.event_date),
    coalesce(p_period_end, v_event.event_date),
    coalesce(v_currency, 'INR'),
    concat('Normalized from settlement event ', p_event_id),
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

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows payload must be a JSON array';
  end if;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
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
    begin
      v_gross_sales := nullif(trim(v_row ->> 'gross_sales'), '')::numeric;
    exception when others then
      v_gross_sales := null;
    end;
    begin
      v_net_payout := nullif(trim(v_row ->> 'net_payout'), '')::numeric;
    exception when others then
      v_net_payout := null;
    end;
    begin
      v_total_fees := nullif(trim(v_row ->> 'total_fees'), '')::numeric;
    exception when others then
      v_total_fees := null;
    end;
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
    begin
      v_refund_amount := nullif(trim(v_row ->> 'refund_amount'), '')::numeric;
    exception when others then
      v_refund_amount := null;
    end;
    begin
      v_other_charges := nullif(trim(v_row ->> 'other_charges'), '')::numeric;
    exception when others then
      v_other_charges := null;
    end;
    v_settlement_type := nullif(trim(v_row ->> 'settlement_type'), '');

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

  insert into public.erp_marketplace_settlement_event_links (
    company_id,
    event_id,
    batch_id
  )
  values (
    v_company_id,
    p_event_id,
    v_batch_id
  )
  on conflict (company_id, event_id)
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

revoke all on function public.erp_marketplace_settlement_batch_upsert_from_rows(uuid, text, date, date, text, jsonb, uuid) from public;
grant execute on function public.erp_marketplace_settlement_batch_upsert_from_rows(uuid, text, date, date, text, jsonb, uuid) to authenticated;
