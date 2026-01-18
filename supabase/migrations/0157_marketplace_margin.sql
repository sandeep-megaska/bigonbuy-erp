-- Marketplace margin analyzer (settlement batches + txns + cost overrides)

create or replace function public.erp_require_marketplace_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_marketplace_writer() from public;
grant execute on function public.erp_require_marketplace_writer() to authenticated;

create table if not exists public.erp_marketplace_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_id uuid not null references public.erp_sales_channels (id) on delete restrict,
  status text not null default 'draft',
  batch_ref text null,
  period_start date null,
  period_end date null,
  currency text null default 'INR',
  notes text null,
  uploaded_filename text null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid(),
  processed_at timestamptz null,
  processed_by uuid null,
  created_at timestamptz not null default now(),
  constraint erp_marketplace_settlement_batches_status_check
    check (status in ('draft', 'processed'))
);

create index if not exists erp_marketplace_settlement_batches_company_id_idx
  on public.erp_marketplace_settlement_batches (company_id);

create index if not exists erp_marketplace_settlement_batches_channel_idx
  on public.erp_marketplace_settlement_batches (company_id, channel_id, period_start);

create table if not exists public.erp_marketplace_settlement_txns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  batch_id uuid not null references public.erp_marketplace_settlement_batches (id) on delete cascade,
  txn_date date null,
  order_id text null,
  sub_order_id text null,
  sku text null,
  qty int null,
  gross_sales numeric(12, 2) null,
  net_payout numeric(12, 2) null,
  total_fees numeric(12, 2) null,
  shipping_fee numeric(12, 2) null,
  commission_fee numeric(12, 2) null,
  fixed_fee numeric(12, 2) null,
  closing_fee numeric(12, 2) null,
  refund_amount numeric(12, 2) null,
  other_charges numeric(12, 2) null,
  settlement_type text null,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists erp_marketplace_settlement_txns_company_batch_idx
  on public.erp_marketplace_settlement_txns (company_id, batch_id);

create index if not exists erp_marketplace_settlement_txns_company_sku_idx
  on public.erp_marketplace_settlement_txns (company_id, sku);

create index if not exists erp_marketplace_settlement_txns_company_order_idx
  on public.erp_marketplace_settlement_txns (company_id, order_id);

create table if not exists public.erp_sku_cost_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  sku text not null,
  unit_cost numeric(12, 2) not null,
  effective_from date not null default current_date,
  effective_to date null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint erp_sku_cost_overrides_effective_check
    check (effective_to is null or effective_to >= effective_from),
  constraint erp_sku_cost_overrides_unique
    unique (company_id, sku, effective_from)
);

create index if not exists erp_sku_cost_overrides_company_sku_idx
  on public.erp_sku_cost_overrides (company_id, sku, effective_from);

create table if not exists public.erp_marketplace_column_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_id uuid not null references public.erp_sales_channels (id) on delete cascade,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_marketplace_column_mappings_unique
    unique (company_id, channel_id)
);

alter table public.erp_marketplace_settlement_batches enable row level security;
alter table public.erp_marketplace_settlement_batches force row level security;
alter table public.erp_marketplace_settlement_txns enable row level security;
alter table public.erp_marketplace_settlement_txns force row level security;
alter table public.erp_sku_cost_overrides enable row level security;
alter table public.erp_sku_cost_overrides force row level security;
alter table public.erp_marketplace_column_mappings enable row level security;
alter table public.erp_marketplace_column_mappings force row level security;

do $$
begin
  drop policy if exists erp_marketplace_settlement_batches_select on public.erp_marketplace_settlement_batches;
  drop policy if exists erp_marketplace_settlement_batches_write on public.erp_marketplace_settlement_batches;
  drop policy if exists erp_marketplace_settlement_txns_select on public.erp_marketplace_settlement_txns;
  drop policy if exists erp_marketplace_settlement_txns_write on public.erp_marketplace_settlement_txns;
  drop policy if exists erp_sku_cost_overrides_select on public.erp_sku_cost_overrides;
  drop policy if exists erp_sku_cost_overrides_write on public.erp_sku_cost_overrides;
  drop policy if exists erp_marketplace_column_mappings_select on public.erp_marketplace_column_mappings;
  drop policy if exists erp_marketplace_column_mappings_write on public.erp_marketplace_column_mappings;

  create policy erp_marketplace_settlement_batches_select
    on public.erp_marketplace_settlement_batches
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

  create policy erp_marketplace_settlement_batches_write
    on public.erp_marketplace_settlement_batches
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

  create policy erp_marketplace_settlement_txns_select
    on public.erp_marketplace_settlement_txns
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

  create policy erp_marketplace_settlement_txns_write
    on public.erp_marketplace_settlement_txns
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

  create policy erp_sku_cost_overrides_select
    on public.erp_sku_cost_overrides
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

  create policy erp_sku_cost_overrides_write
    on public.erp_sku_cost_overrides
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

  create policy erp_marketplace_column_mappings_select
    on public.erp_marketplace_column_mappings
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

  create policy erp_marketplace_column_mappings_write
    on public.erp_marketplace_column_mappings
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

create or replace function public.erp_marketplace_mapping_save(
  p_channel_id uuid,
  p_mapping jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_marketplace_writer();

  if p_channel_id is null then
    raise exception 'Channel is required';
  end if;

  insert into public.erp_marketplace_column_mappings (
    company_id,
    channel_id,
    mapping,
    created_at,
    created_by,
    updated_at
  )
  values (
    public.erp_current_company_id(),
    p_channel_id,
    coalesce(p_mapping, '{}'::jsonb),
    now(),
    auth.uid(),
    now()
  )
  on conflict (company_id, channel_id)
  do update set mapping = excluded.mapping, updated_at = now();
end;
$$;

revoke all on function public.erp_marketplace_mapping_save(uuid, jsonb) from public;
grant execute on function public.erp_marketplace_mapping_save(uuid, jsonb) to authenticated;

create or replace function public.erp_marketplace_mapping_get(
  p_channel_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.mapping
      from public.erp_marketplace_column_mappings m
      where m.company_id = public.erp_current_company_id()
        and m.channel_id = p_channel_id
      limit 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.erp_marketplace_mapping_get(uuid) from public;
grant execute on function public.erp_marketplace_mapping_get(uuid) to authenticated;

create or replace function public.erp_marketplace_settlement_process_csv(
  p_channel_code text,
  p_batch_ref text,
  p_period_start date,
  p_period_end date,
  p_currency text,
  p_mapping jsonb,
  p_rows jsonb,
  p_validate_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_id uuid;
  v_batch_id uuid;
  v_errors jsonb := '[]'::jsonb;
  v_inserted_rows int := 0;
  v_total_net_payout_sum numeric := 0;
  v_total_fees_sum numeric := 0;
  v_total_refunds_sum numeric := 0;
  v_total_gross_sum numeric := 0;
  v_mapping jsonb := coalesce(p_mapping, '{}'::jsonb);
  v_missing_fields text[] := ARRAY[]::text[];
  v_header_order_id text := nullif(trim(v_mapping ->> 'order_id'), '');
  v_header_sub_order_id text := nullif(trim(v_mapping ->> 'sub_order_id'), '');
  v_header_sku text := nullif(trim(v_mapping ->> 'sku'), '');
  v_header_qty text := nullif(trim(v_mapping ->> 'qty'), '');
  v_header_gross_sales text := nullif(trim(v_mapping ->> 'gross_sales'), '');
  v_header_net_payout text := nullif(trim(v_mapping ->> 'net_payout'), '');
  v_header_total_fees text := nullif(trim(v_mapping ->> 'total_fees'), '');
  v_header_shipping_fee text := nullif(trim(v_mapping ->> 'shipping_fee'), '');
  v_header_commission_fee text := nullif(trim(v_mapping ->> 'commission_fee'), '');
  v_header_fixed_fee text := nullif(trim(v_mapping ->> 'fixed_fee'), '');
  v_header_closing_fee text := nullif(trim(v_mapping ->> 'closing_fee'), '');
  v_header_refund_amount text := nullif(trim(v_mapping ->> 'refund_amount'), '');
  v_header_other_charges text := nullif(trim(v_mapping ->> 'other_charges'), '');
  v_header_txn_date text := nullif(trim(v_mapping ->> 'txn_date'), '');
  v_header_settlement_type text := nullif(trim(v_mapping ->> 'settlement_type'), '');
  v_row jsonb;
  v_row_index int;
  v_row_errors text[];
  v_raw_value text;
  v_order_id text;
  v_sub_order_id text;
  v_sku text;
  v_qty int;
  v_qty_numeric numeric;
  v_txn_date date;
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
  v_fee_components numeric;
begin
  perform public.erp_require_marketplace_writer();

  if v_company_id is null then
    raise exception 'No active company found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows payload must be a JSON array';
  end if;

  select sc.id
  into v_channel_id
  from public.erp_sales_channels sc
  where sc.company_id = v_company_id
    and sc.code = p_channel_code
    and sc.is_active = true
  limit 1;

  if v_channel_id is null then
    raise exception 'Unknown channel code %', p_channel_code;
  end if;

  if v_header_order_id is null then
    v_missing_fields := array_append(v_missing_fields, 'order_id');
  end if;
  if v_header_sku is null then
    v_missing_fields := array_append(v_missing_fields, 'sku');
  end if;
  if v_header_qty is null then
    v_missing_fields := array_append(v_missing_fields, 'qty');
  end if;
  if v_header_txn_date is null then
    v_missing_fields := array_append(v_missing_fields, 'txn_date');
  end if;

  if array_length(v_missing_fields, 1) > 0 then
    raise exception 'Mapping missing required fields: %', array_to_string(v_missing_fields, ', ');
  end if;

  if v_header_net_payout is null and v_header_gross_sales is null then
    raise exception 'Mapping must include net_payout or gross_sales';
  end if;

  if not p_validate_only then
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
      nullif(trim(p_batch_ref), ''),
      p_period_start,
      p_period_end,
      coalesce(nullif(trim(p_currency), ''), 'INR'),
      null,
      null,
      now(),
      auth.uid(),
      now(),
      auth.uid()
    )
    returning id into v_batch_id;
  end if;

  for v_row, v_row_index in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    v_row_errors := ARRAY[]::text[];

    v_order_id := nullif(trim(v_row ->> v_header_order_id), '');
    v_sub_order_id := nullif(trim(v_row ->> v_header_sub_order_id), '');
    v_sku := nullif(trim(v_row ->> v_header_sku), '');
    if v_sku is not null then
      v_sku := upper(v_sku);
    end if;

    v_raw_value := nullif(trim(v_row ->> v_header_qty), '');
    v_qty := null;
    if v_raw_value is not null then
      begin
        v_qty_numeric := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
        if v_qty_numeric <> trunc(v_qty_numeric) then
          v_row_errors := array_append(v_row_errors, 'Qty must be an integer');
        else
          v_qty := v_qty_numeric::int;
          if v_qty < 0 then
            v_row_errors := array_append(v_row_errors, 'Qty must be >= 0');
          end if;
        end if;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid qty value');
      end;
    end if;

    v_raw_value := nullif(trim(v_row ->> v_header_txn_date), '');
    v_txn_date := null;
    if v_raw_value is not null then
      begin
        v_txn_date := v_raw_value::date;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid txn_date value');
      end;
    end if;

    v_gross_sales := null;
    v_raw_value := nullif(trim(v_row ->> v_header_gross_sales), '');
    if v_raw_value is not null then
      begin
        v_gross_sales := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid gross_sales value');
      end;
    end if;

    v_net_payout := null;
    v_raw_value := nullif(trim(v_row ->> v_header_net_payout), '');
    if v_raw_value is not null then
      begin
        v_net_payout := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid net_payout value');
      end;
    end if;

    v_total_fees := null;
    v_raw_value := nullif(trim(v_row ->> v_header_total_fees), '');
    if v_raw_value is not null then
      begin
        v_total_fees := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid total_fees value');
      end;
    end if;

    v_shipping_fee := null;
    v_raw_value := nullif(trim(v_row ->> v_header_shipping_fee), '');
    if v_raw_value is not null then
      begin
        v_shipping_fee := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid shipping_fee value');
      end;
    end if;

    v_commission_fee := null;
    v_raw_value := nullif(trim(v_row ->> v_header_commission_fee), '');
    if v_raw_value is not null then
      begin
        v_commission_fee := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid commission_fee value');
      end;
    end if;

    v_fixed_fee := null;
    v_raw_value := nullif(trim(v_row ->> v_header_fixed_fee), '');
    if v_raw_value is not null then
      begin
        v_fixed_fee := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid fixed_fee value');
      end;
    end if;

    v_closing_fee := null;
    v_raw_value := nullif(trim(v_row ->> v_header_closing_fee), '');
    if v_raw_value is not null then
      begin
        v_closing_fee := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid closing_fee value');
      end;
    end if;

    v_refund_amount := null;
    v_raw_value := nullif(trim(v_row ->> v_header_refund_amount), '');
    if v_raw_value is not null then
      begin
        v_refund_amount := abs(regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric);
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid refund_amount value');
      end;
    end if;

    v_other_charges := null;
    v_raw_value := nullif(trim(v_row ->> v_header_other_charges), '');
    if v_raw_value is not null then
      begin
        v_other_charges := regexp_replace(v_raw_value, '[^0-9\\.-]', '', 'g')::numeric;
      exception when others then
        v_row_errors := array_append(v_row_errors, 'Invalid other_charges value');
      end;
    end if;

    v_settlement_type := nullif(trim(v_row ->> v_header_settlement_type), '');

    if v_total_fees is null then
      v_fee_components := coalesce(v_shipping_fee, 0)
        + coalesce(v_commission_fee, 0)
        + coalesce(v_fixed_fee, 0)
        + coalesce(v_closing_fee, 0);
      if v_fee_components <> 0 then
        v_total_fees := v_fee_components;
      end if;
    end if;

    if v_net_payout is null and v_gross_sales is not null then
      v_net_payout := v_gross_sales
        - coalesce(v_total_fees, 0)
        - coalesce(v_refund_amount, 0)
        - coalesce(v_other_charges, 0);
    end if;

    if v_sku is null then
      v_row_errors := array_append(v_row_errors, 'Missing SKU');
    end if;

    if v_qty is null then
      v_row_errors := array_append(v_row_errors, 'Missing qty');
    end if;

    if v_txn_date is null then
      v_row_errors := array_append(v_row_errors, 'Missing txn_date');
    end if;

    if v_net_payout is null and v_gross_sales is null then
      v_row_errors := array_append(v_row_errors, 'Missing net_payout or gross_sales');
    end if;

    if array_length(v_row_errors, 1) > 0 then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('row_index', v_row_index, 'message', array_to_string(v_row_errors, '; '))
      );
      continue;
    end if;

    v_total_net_payout_sum := v_total_net_payout_sum + coalesce(v_net_payout, 0);
    v_total_fees_sum := v_total_fees_sum + coalesce(v_total_fees, 0);
    v_total_refunds_sum := v_total_refunds_sum + coalesce(v_refund_amount, 0);
    v_total_gross_sum := v_total_gross_sum + coalesce(v_gross_sales, 0);

    if not p_validate_only then
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
        raw
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
        v_row
      );

      v_inserted_rows := v_inserted_rows + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',
    true,
    'batch_id',
    v_batch_id,
    'inserted_rows',
    v_inserted_rows,
    'errors',
    v_errors,
    'totals',
    jsonb_build_object(
      'net_payout',
      v_total_net_payout_sum,
      'fees',
      v_total_fees_sum,
      'refunds',
      v_total_refunds_sum,
      'gross_sales',
      v_total_gross_sum
    )
  );
end;
$$;

revoke all on function public.erp_marketplace_settlement_process_csv(text, text, date, date, text, jsonb, jsonb, boolean) from public;
grant execute on function public.erp_marketplace_settlement_process_csv(text, text, date, date, text, jsonb, jsonb, boolean) to authenticated;

create or replace function public.erp_marketplace_margin_summary(
  p_channel_code text,
  p_from date,
  p_to date,
  p_sku_query text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  sku text,
  qty int,
  gross_sales numeric,
  net_payout numeric,
  total_fees numeric,
  refunds numeric,
  est_unit_cost numeric,
  est_cogs numeric,
  contribution numeric,
  margin_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = public.erp_current_company_id()
      and code = p_channel_code
    limit 1
  ),
  wac_by_sku as (
    select
      v.sku,
      case
        when sum(abs(gl.received_qty)) > 0
          then round((sum(abs(gl.received_qty) * coalesce(gl.landed_cost_per_unit, gl.unit_cost)) / sum(abs(gl.received_qty)))::numeric, 2)
        else null
      end as wac
    from public.erp_variants v
    join public.erp_grn_lines gl
      on gl.variant_id = v.id
    join public.erp_grns g
      on g.id = gl.grn_id
     and g.status = 'posted'
    where v.company_id = public.erp_current_company_id()
      and gl.company_id = public.erp_current_company_id()
      and g.company_id = public.erp_current_company_id()
      and coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
    group by v.sku
  ),
  base as (
    select
      t.sku,
      coalesce(t.qty, 0) as qty,
      t.gross_sales,
      coalesce(
        t.net_payout,
        t.gross_sales
          - coalesce(t.total_fees, 0)
          - coalesce(t.refund_amount, 0)
          - coalesce(t.other_charges, 0)
      ) as net_payout,
      coalesce(
        t.total_fees,
        coalesce(t.shipping_fee, 0)
          + coalesce(t.commission_fee, 0)
          + coalesce(t.fixed_fee, 0)
          + coalesce(t.closing_fee, 0)
      ) as total_fees,
      coalesce(t.refund_amount, 0) as refunds,
      t.txn_date,
      coalesce(w.wac, o.unit_cost) as unit_cost
    from public.erp_marketplace_settlement_txns t
    join public.erp_marketplace_settlement_batches b
      on b.id = t.batch_id
    join channel ch
      on ch.id = b.channel_id
    left join wac_by_sku w
      on w.sku = t.sku
    left join lateral (
      select o.unit_cost
      from public.erp_sku_cost_overrides o
      where o.company_id = public.erp_current_company_id()
        and o.sku = t.sku
        and o.effective_from <= coalesce(t.txn_date, p_to, current_date)
        and (o.effective_to is null or o.effective_to >= coalesce(t.txn_date, p_to, current_date))
      order by o.effective_from desc
      limit 1
    ) o on true
    where t.company_id = public.erp_current_company_id()
      and (p_from is null or t.txn_date >= p_from)
      and (p_to is null or t.txn_date <= p_to)
      and (
        p_sku_query is null
        or t.sku ilike '%' || p_sku_query || '%'
      )
  ),
  aggregated as (
    select
      sku,
      sum(qty)::int as qty,
      sum(gross_sales) as gross_sales,
      sum(net_payout) as net_payout,
      sum(total_fees) as total_fees,
      sum(refunds) as refunds,
      sum(case when unit_cost is null then 1 else 0 end) as missing_costs,
      sum(qty * unit_cost) as total_cogs
    from base
    group by sku
  )
  select
    a.sku,
    a.qty,
    a.gross_sales,
    a.net_payout,
    a.total_fees,
    a.refunds,
    case when a.missing_costs = 0 and a.qty > 0
      then round((a.total_cogs / nullif(a.qty, 0))::numeric, 2)
      else null
    end as est_unit_cost,
    case when a.missing_costs = 0
      then round(a.total_cogs::numeric, 2)
      else null
    end as est_cogs,
    case when a.missing_costs = 0
      then round((a.net_payout - a.total_cogs)::numeric, 2)
      else null
    end as contribution,
    case when a.missing_costs = 0
      then round(((a.net_payout - a.total_cogs) / nullif(a.net_payout, 0))::numeric, 4)
      else null
    end as margin_pct
  from aggregated a
  order by contribution desc nulls last
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.erp_marketplace_margin_summary(text, date, date, text, int, int) from public;
grant execute on function public.erp_marketplace_margin_summary(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_marketplace_order_drilldown(
  p_channel_code text,
  p_from date,
  p_to date,
  p_order_query text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  order_id text,
  txn_count int,
  qty int,
  net_payout numeric,
  est_cogs numeric,
  contribution numeric,
  margin_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = public.erp_current_company_id()
      and code = p_channel_code
    limit 1
  ),
  wac_by_sku as (
    select
      v.sku,
      case
        when sum(abs(gl.received_qty)) > 0
          then round((sum(abs(gl.received_qty) * coalesce(gl.landed_cost_per_unit, gl.unit_cost)) / sum(abs(gl.received_qty)))::numeric, 2)
        else null
      end as wac
    from public.erp_variants v
    join public.erp_grn_lines gl
      on gl.variant_id = v.id
    join public.erp_grns g
      on g.id = gl.grn_id
     and g.status = 'posted'
    where v.company_id = public.erp_current_company_id()
      and gl.company_id = public.erp_current_company_id()
      and g.company_id = public.erp_current_company_id()
      and coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
    group by v.sku
  ),
  base as (
    select
      t.order_id,
      coalesce(t.qty, 0) as qty,
      coalesce(
        t.net_payout,
        t.gross_sales
          - coalesce(t.total_fees, 0)
          - coalesce(t.refund_amount, 0)
          - coalesce(t.other_charges, 0)
      ) as net_payout,
      coalesce(w.wac, o.unit_cost) as unit_cost
    from public.erp_marketplace_settlement_txns t
    join public.erp_marketplace_settlement_batches b
      on b.id = t.batch_id
    join channel ch
      on ch.id = b.channel_id
    left join wac_by_sku w
      on w.sku = t.sku
    left join lateral (
      select o.unit_cost
      from public.erp_sku_cost_overrides o
      where o.company_id = public.erp_current_company_id()
        and o.sku = t.sku
        and o.effective_from <= coalesce(t.txn_date, p_to, current_date)
        and (o.effective_to is null or o.effective_to >= coalesce(t.txn_date, p_to, current_date))
      order by o.effective_from desc
      limit 1
    ) o on true
    where t.company_id = public.erp_current_company_id()
      and (p_from is null or t.txn_date >= p_from)
      and (p_to is null or t.txn_date <= p_to)
      and (
        p_order_query is null
        or t.order_id ilike '%' || p_order_query || '%'
      )
  ),
  aggregated as (
    select
      order_id,
      count(*)::int as txn_count,
      sum(qty)::int as qty,
      sum(net_payout) as net_payout,
      sum(case when unit_cost is null then 1 else 0 end) as missing_costs,
      sum(qty * unit_cost) as total_cogs
    from base
    group by order_id
  )
  select
    a.order_id,
    a.txn_count,
    a.qty,
    a.net_payout,
    case when a.missing_costs = 0
      then round(a.total_cogs::numeric, 2)
      else null
    end as est_cogs,
    case when a.missing_costs = 0
      then round((a.net_payout - a.total_cogs)::numeric, 2)
      else null
    end as contribution,
    case when a.missing_costs = 0
      then round(((a.net_payout - a.total_cogs) / nullif(a.net_payout, 0))::numeric, 4)
      else null
    end as margin_pct
  from aggregated a
  order by contribution desc nulls last
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.erp_marketplace_order_drilldown(text, date, date, text, int, int) from public;
grant execute on function public.erp_marketplace_order_drilldown(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_marketplace_order_lines(
  p_order_id text,
  p_channel_code text
)
returns table (
  txn_date date,
  sku text,
  qty int,
  gross_sales numeric,
  net_payout numeric,
  fees numeric,
  refunds numeric,
  est_unit_cost numeric,
  est_cogs numeric,
  contribution numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = public.erp_current_company_id()
      and code = p_channel_code
    limit 1
  ),
  wac_by_sku as (
    select
      v.sku,
      case
        when sum(abs(gl.received_qty)) > 0
          then round((sum(abs(gl.received_qty) * coalesce(gl.landed_cost_per_unit, gl.unit_cost)) / sum(abs(gl.received_qty)))::numeric, 2)
        else null
      end as wac
    from public.erp_variants v
    join public.erp_grn_lines gl
      on gl.variant_id = v.id
    join public.erp_grns g
      on g.id = gl.grn_id
     and g.status = 'posted'
    where v.company_id = public.erp_current_company_id()
      and gl.company_id = public.erp_current_company_id()
      and g.company_id = public.erp_current_company_id()
      and coalesce(gl.landed_cost_per_unit, gl.unit_cost) is not null
    group by v.sku
  )
  select
    t.txn_date,
    t.sku,
    coalesce(t.qty, 0) as qty,
    t.gross_sales,
    coalesce(
      t.net_payout,
      t.gross_sales
        - coalesce(t.total_fees, 0)
        - coalesce(t.refund_amount, 0)
        - coalesce(t.other_charges, 0)
    ) as net_payout,
    coalesce(
      t.total_fees,
      coalesce(t.shipping_fee, 0)
        + coalesce(t.commission_fee, 0)
        + coalesce(t.fixed_fee, 0)
        + coalesce(t.closing_fee, 0)
    ) as fees,
    coalesce(t.refund_amount, 0) as refunds,
    coalesce(w.wac, o.unit_cost) as est_unit_cost,
    case when coalesce(w.wac, o.unit_cost) is null
      then null
      else round((coalesce(t.qty, 0) * coalesce(w.wac, o.unit_cost))::numeric, 2)
    end as est_cogs,
    case when coalesce(w.wac, o.unit_cost) is null
      then null
      else round((coalesce(
        t.net_payout,
        t.gross_sales
          - coalesce(t.total_fees, 0)
          - coalesce(t.refund_amount, 0)
          - coalesce(t.other_charges, 0)
      ) - (coalesce(t.qty, 0) * coalesce(w.wac, o.unit_cost)))::numeric, 2)
    end as contribution
  from public.erp_marketplace_settlement_txns t
  join public.erp_marketplace_settlement_batches b
    on b.id = t.batch_id
  join channel ch
    on ch.id = b.channel_id
  left join wac_by_sku w
    on w.sku = t.sku
  left join lateral (
    select o.unit_cost
    from public.erp_sku_cost_overrides o
    where o.company_id = public.erp_current_company_id()
      and o.sku = t.sku
      and o.effective_from <= coalesce(t.txn_date, current_date)
      and (o.effective_to is null or o.effective_to >= coalesce(t.txn_date, current_date))
    order by o.effective_from desc
    limit 1
  ) o on true
  where t.company_id = public.erp_current_company_id()
    and t.order_id = p_order_id
  order by t.txn_date desc nulls last;
$$;

revoke all on function public.erp_marketplace_order_lines(text, text) from public;
grant execute on function public.erp_marketplace_order_lines(text, text) to authenticated;
