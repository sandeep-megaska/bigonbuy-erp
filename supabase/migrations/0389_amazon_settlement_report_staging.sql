-- 0389_amazon_settlement_report_normalize.sql
-- Normalize Amazon settlement flat-file reports into marketplace settlement ledger.

create table if not exists public.erp_marketplace_settlement_report_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  report_id text not null,
  batch_id uuid not null references public.erp_marketplace_settlement_batches (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint erp_marketplace_settlement_report_links_unique unique (company_id, report_id)
);

create table if not exists public.erp_marketplace_settlement_report_payloads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  report_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_marketplace_settlement_report_payloads_unique unique (company_id, report_id)
);

drop trigger if exists erp_marketplace_settlement_report_payloads_set_updated_at
  on public.erp_marketplace_settlement_report_payloads;
create trigger erp_marketplace_settlement_report_payloads_set_updated_at
before update on public.erp_marketplace_settlement_report_payloads
for each row execute function public.erp_set_updated_at();

alter table public.erp_marketplace_settlement_report_links enable row level security;
alter table public.erp_marketplace_settlement_report_links force row level security;
alter table public.erp_marketplace_settlement_report_payloads enable row level security;
alter table public.erp_marketplace_settlement_report_payloads force row level security;

do $$
begin
  drop policy if exists erp_marketplace_settlement_report_links_select on public.erp_marketplace_settlement_report_links;
  drop policy if exists erp_marketplace_settlement_report_links_write on public.erp_marketplace_settlement_report_links;
  drop policy if exists erp_marketplace_settlement_report_payloads_select on public.erp_marketplace_settlement_report_payloads;
  drop policy if exists erp_marketplace_settlement_report_payloads_write on public.erp_marketplace_settlement_report_payloads;

  create policy erp_marketplace_settlement_report_links_select
    on public.erp_marketplace_settlement_report_links
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

  create policy erp_marketplace_settlement_report_links_write
    on public.erp_marketplace_settlement_report_links
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

  create policy erp_marketplace_settlement_report_payloads_select
    on public.erp_marketplace_settlement_report_payloads
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

  create policy erp_marketplace_settlement_report_payloads_write
    on public.erp_marketplace_settlement_report_payloads
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

revoke all on function public.erp_marketplace_settlement_batch_upsert_from_amazon_report(text, uuid) from public;
grant execute on function public.erp_marketplace_settlement_batch_upsert_from_amazon_report(text, uuid) to authenticated;
