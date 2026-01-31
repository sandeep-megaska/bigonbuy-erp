create table if not exists public.erp_sales_refund_finance_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  order_id uuid not null,
  refund_source_id text not null,
  finance_journal_id uuid not null references public.erp_fin_journals (id),
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null,
  idempotency_key uuid null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null
);

create unique index if not exists erp_sales_refund_finance_posts_company_order_refund_unique
  on public.erp_sales_refund_finance_posts (company_id, order_id, refund_source_id)
  where is_void = false;

create unique index if not exists erp_sales_refund_finance_posts_company_idempotency_key
  on public.erp_sales_refund_finance_posts (company_id, idempotency_key)
  where idempotency_key is not null
    and is_void = false;

create index if not exists erp_sales_refund_finance_posts_company_order_idx
  on public.erp_sales_refund_finance_posts (company_id, order_id);

alter table public.erp_sales_refund_finance_posts enable row level security;
alter table public.erp_sales_refund_finance_posts force row level security;

do $$
begin
  drop policy if exists erp_sales_refund_finance_posts_select on public.erp_sales_refund_finance_posts;
  drop policy if exists erp_sales_refund_finance_posts_write on public.erp_sales_refund_finance_posts;

  create policy erp_sales_refund_finance_posts_select
    on public.erp_sales_refund_finance_posts
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_sales_refund_finance_posts_write
    on public.erp_sales_refund_finance_posts
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
            and cu.role_key in ('owner', 'admin', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create or replace function public.erp_shopify_sales_finance_refund_preview(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_order record;
  v_config record;
  v_clearing record;
  v_sales record;
  v_gst record;
  v_errors text[] := '{}'::text[];
  v_refunds jsonb := '[]'::jsonb;
  v_existing_posts jsonb := '[]'::jsonb;
  v_can_post boolean := false;
  v_gst_net_total numeric(14,2) := 0;
  v_gst_tax_total numeric(14,2) := 0;
  v_gst_refund_count int := 0;
  v_has_gst_refunds boolean := false;
  v_refund_count int := 0;
  v_total_raw_gross numeric(14,2) := 0;
  v_refund record;
  v_refund_source_id text;
  v_refund_net numeric(14,2) := 0;
  v_refund_gst numeric(14,2) := 0;
  v_refund_gross numeric(14,2) := 0;
  v_refund_share numeric(14,6) := 0;
  v_refund_errors text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_post record;
  v_effective_refunded_at timestamptz;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_order_id
      and o.company_id = v_company_id;

  if v_order.id is null then
    return jsonb_build_object(
      'source', jsonb_build_object('id', p_order_id, 'channel', 'shopify'),
      'refunds', '[]'::jsonb,
      'errors', jsonb_build_array('Order not found'),
      'can_post', false
    );
  end if;

  select
    sales_revenue_account_id,
    gst_output_account_id,
    receivable_account_id
    into v_config
  from public.erp_sales_finance_posting_config c
  where c.company_id = v_company_id
    and c.is_active;

  if v_config.sales_revenue_account_id is null
    or v_config.gst_output_account_id is null
    or v_config.receivable_account_id is null then
    v_errors := array_append(v_errors, 'Sales posting config missing');
  else
    select id, code, name into v_sales from public.erp_gl_accounts a where a.id = v_config.sales_revenue_account_id;
    select id, code, name into v_gst from public.erp_gl_accounts a where a.id = v_config.gst_output_account_id;
    select id, code, name into v_clearing from public.erp_gl_accounts a where a.id = v_config.receivable_account_id;
  end if;

  if v_sales.id is null or v_gst.id is null or v_clearing.id is null then
    v_errors := array_append(v_errors, 'Sales posting config missing');
  end if;

  if v_clearing.id is null or v_clearing.code <> '1102' then
    v_errors := array_append(v_errors, 'Razorpay clearing account (1102) missing');
  end if;

  select
    coalesce(sum(abs(r.taxable_value + r.shipping_taxable_value)) filter (
      where r.taxable_value < 0 or r.shipping_taxable_value < 0
    ), 0) as net_refund,
    coalesce(sum(abs(r.total_tax)) filter (where r.total_tax < 0), 0) as gst_refund,
    count(*) filter (
      where r.taxable_value < 0
        or r.shipping_taxable_value < 0
        or r.total_tax < 0
        or r.quantity < 0
    ) as refund_count
    into v_gst_net_total, v_gst_tax_total, v_gst_refund_count
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false;

  if coalesce(v_gst_refund_count, 0) > 0 then
    v_has_gst_refunds := true;
  end if;

  select
    coalesce(sum(gross), 0),
    count(*)
    into v_total_raw_gross, v_refund_count
  from (
    with refunds as (
      select
        r.value as refund,
        nullif(r.value->>'id', '') as refund_id,
        coalesce(nullif(r.value->>'processed_at', '')::timestamptz, nullif(r.value->>'created_at', '')::timestamptz)
          as refunded_at,
        coalesce((
          select sum(abs(nullif(item->>'subtotal', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as net_line,
        coalesce((
          select sum(abs(nullif(item->>'total_tax', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as gst_line,
        coalesce((
          select sum(abs(nullif(adj->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as net_adjust,
        coalesce((
          select sum(abs(nullif(adj->>'tax_amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as gst_adjust,
        coalesce((
          select sum(abs(nullif(tx->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), 0) as gross_transactions,
        coalesce((
          select bool_or(lower(coalesce(tx->>'status', '')) in ('success', 'completed', 'processed'))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), false) as has_successful_transaction
      from jsonb_array_elements(coalesce(v_order.raw_order->'refunds', '[]'::jsonb)) r(value)
    ),
    refund_totals as (
      select
        refund,
        refund_id,
        refunded_at,
        has_successful_transaction,
        round(net_line + net_adjust, 2) as net_raw,
        round(gst_line + gst_adjust, 2) as gst_raw,
        round(net_line + net_adjust + gst_line + gst_adjust, 2) as gross_raw,
        round(gross_transactions, 2) as gross_transactions
      from refunds
    )
    select
      refund,
      refund_id,
      refunded_at,
      has_successful_transaction,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else net_raw end as net,
      case when gross_raw <= 0 and gross_transactions > 0 then 0 else gst_raw end as gst,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else gross_raw end as gross
    from refund_totals
  ) refunds;

  if coalesce(v_refund_count, 0) = 0 then
    v_errors := array_append(v_errors, 'No refunds found');
  end if;

  for v_refund in
    with refunds as (
      select
        r.value as refund,
        nullif(r.value->>'id', '') as refund_id,
        coalesce(nullif(r.value->>'processed_at', '')::timestamptz, nullif(r.value->>'created_at', '')::timestamptz)
          as refunded_at,
        coalesce((
          select sum(abs(nullif(item->>'subtotal', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as net_line,
        coalesce((
          select sum(abs(nullif(item->>'total_tax', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as gst_line,
        coalesce((
          select sum(abs(nullif(adj->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as net_adjust,
        coalesce((
          select sum(abs(nullif(adj->>'tax_amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as gst_adjust,
        coalesce((
          select sum(abs(nullif(tx->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), 0) as gross_transactions,
        coalesce((
          select bool_or(lower(coalesce(tx->>'status', '')) in ('success', 'completed', 'processed'))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), false) as has_successful_transaction
      from jsonb_array_elements(coalesce(v_order.raw_order->'refunds', '[]'::jsonb)) r(value)
    ),
    refund_totals as (
      select
        refund,
        refund_id,
        refunded_at,
        has_successful_transaction,
        round(net_line + net_adjust, 2) as net_raw,
        round(gst_line + gst_adjust, 2) as gst_raw,
        round(net_line + net_adjust + gst_line + gst_adjust, 2) as gross_raw,
        round(gross_transactions, 2) as gross_transactions
      from refunds
    )
    select
      refund,
      refund_id,
      refunded_at,
      has_successful_transaction,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else net_raw end as net,
      case when gross_raw <= 0 and gross_transactions > 0 then 0 else gst_raw end as gst,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else gross_raw end as gross
    from refund_totals
  loop
    v_refund_errors := '{}'::text[];
    v_lines := '[]'::jsonb;

    v_refund_source_id := coalesce(
      v_refund.refund_id,
      encode(
        digest(
          format('%s|%s|%s', v_order.id, coalesce(v_refund.refunded_at::text, ''), round(coalesce(v_refund.gross, 0), 2)),
          'sha256'
        ),
        'hex'
      )
    );

    if v_has_gst_refunds then
      if coalesce(v_total_raw_gross, 0) > 0 then
        v_refund_share := v_refund.gross / v_total_raw_gross;
      elsif coalesce(v_refund_count, 0) > 0 then
        v_refund_share := 1::numeric / v_refund_count;
      else
        v_refund_share := 0;
      end if;

      v_refund_net := round(v_gst_net_total * v_refund_share, 2);
      v_refund_gst := round(v_gst_tax_total * v_refund_share, 2);
      v_refund_gross := round(v_refund_net + v_refund_gst, 2);
    else
      v_refund_net := round(coalesce(v_refund.net, 0), 2);
      v_refund_gst := round(coalesce(v_refund.gst, 0), 2);
      v_refund_gross := round(coalesce(v_refund.gross, 0), 2);
    end if;

    if v_refund_gross <= 0 then
      v_refund_errors := array_append(v_refund_errors, 'Invalid refund totals');
    end if;

    if lower(coalesce(v_order.financial_status, '')) <> 'paid'
      and not coalesce(v_refund.has_successful_transaction, false) then
      v_refund_errors := array_append(v_refund_errors, 'Order is not paid');
    end if;

    if array_length(v_errors, 1) is not null then
      v_refund_errors := array_cat(v_refund_errors, v_errors);
    end if;

    select p.finance_journal_id, j.doc_no
      into v_post
      from public.erp_sales_refund_finance_posts p
      join public.erp_fin_journals j
        on j.id = p.finance_journal_id
       and j.company_id = p.company_id
      where p.company_id = v_company_id
        and p.order_id = v_order.id
        and p.refund_source_id = v_refund_source_id
        and p.is_void = false;

    if v_post.finance_journal_id is not null then
      v_refund_errors := array_append(v_refund_errors, 'Refund already posted');
    end if;

    if array_length(v_refund_errors, 1) is null then
      v_lines := jsonb_build_array(
        jsonb_build_object(
          'memo', 'Sales revenue reversal',
          'side', 'debit',
          'amount', v_refund_net,
          'account_id', v_sales.id,
          'account_code', v_sales.code,
          'account_name', v_sales.name
        ),
        jsonb_build_object(
          'memo', 'Razorpay clearing reversal',
          'side', 'credit',
          'amount', v_refund_gross,
          'account_id', v_clearing.id,
          'account_code', v_clearing.code,
          'account_name', v_clearing.name
        )
      );

      if v_refund_gst > 0 then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object(
            'memo', 'GST output reversal',
            'side', 'debit',
            'amount', v_refund_gst,
            'account_id', v_gst.id,
            'account_code', v_gst.code,
            'account_name', v_gst.name
          )
        );
      end if;

      v_can_post := true;
    end if;

    v_refunds := v_refunds || jsonb_build_array(
      jsonb_build_object(
        'refund_source_id', v_refund_source_id,
        'refunded_at', v_refund.refunded_at,
        'net', v_refund_net,
        'gst', v_refund_gst,
        'gross', v_refund_gross,
        'errors', to_jsonb(v_refund_errors),
        'can_post', array_length(v_refund_errors, 1) is null,
        'journal_preview', v_lines,
        'posted', jsonb_build_object(
          'journal_id', v_post.finance_journal_id,
          'doc_no', v_post.doc_no
        )
      )
    );
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'refund_source_id', p.refund_source_id,
      'journal_id', p.finance_journal_id,
      'doc_no', j.doc_no
    )
  ), '[]'::jsonb)
    into v_existing_posts
  from public.erp_sales_refund_finance_posts p
  join public.erp_fin_journals j
    on j.id = p.finance_journal_id
   and j.company_id = p.company_id
  where p.company_id = v_company_id
    and p.order_id = v_order.id
    and p.is_void = false;

  if array_length(v_errors, 1) is not null then
    v_can_post := false;
  end if;

  return jsonb_build_object(
    'source', jsonb_build_object(
      'id', v_order.id,
      'order_no', v_order.shopify_order_number,
      'order_id', v_order.shopify_order_id,
      'date', v_order.order_created_at::date,
      'channel', 'shopify',
      'currency', v_order.currency
    ),
    'refunds', v_refunds,
    'errors', to_jsonb(v_errors),
    'can_post', v_can_post,
    'existing_posts', v_existing_posts
  );
end;
$$;

revoke all on function public.erp_shopify_sales_finance_refund_preview(uuid) from public;
grant execute on function public.erp_shopify_sales_finance_refund_preview(uuid) to authenticated;

create or replace function public.erp_shopify_sales_finance_refund_post(
  p_order_id uuid,
  p_refund_source_id text,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_order record;
  v_existing_doc_id uuid;
  v_config record;
  v_clearing record;
  v_sales record;
  v_gst record;
  v_refund record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_line_no int := 1;
  v_sales_post uuid;
  v_gst_net_total numeric(14,2) := 0;
  v_gst_tax_total numeric(14,2) := 0;
  v_gst_refund_count int := 0;
  v_has_gst_refunds boolean := false;
  v_refund_count int := 0;
  v_total_raw_gross numeric(14,2) := 0;
  v_refund_share numeric(14,6) := 0;
  v_refund_net numeric(14,2) := 0;
  v_refund_gst numeric(14,2) := 0;
  v_refund_gross numeric(14,2) := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if p_refund_source_id is null or trim(p_refund_source_id) = '' then
    raise exception 'refund_source_id is required';
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_order_id
      and o.company_id = v_company_id
    for update;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  select p.finance_doc_id
    into v_sales_post
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and (p.source_id = v_order.id or p.order_id = v_order.id)
      and p.status = 'posted'
    limit 1;

  if v_sales_post is null then
    raise exception 'Original sales journal not posted';
  end if;

  if p_idempotency_key is not null then
    select p.finance_journal_id
      into v_existing_doc_id
      from public.erp_sales_refund_finance_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key
        and p.is_void = false;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_journal_id
    into v_existing_doc_id
    from public.erp_sales_refund_finance_posts p
    where p.company_id = v_company_id
      and p.order_id = v_order.id
      and p.refund_source_id = p_refund_source_id
      and p.is_void = false
    for update;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    sales_revenue_account_id,
    gst_output_account_id,
    receivable_account_id
    into v_config
  from public.erp_sales_finance_posting_config c
  where c.company_id = v_company_id
    and c.is_active;

  if v_config.sales_revenue_account_id is null
    or v_config.gst_output_account_id is null
    or v_config.receivable_account_id is null then
    raise exception 'Sales posting config missing';
  end if;

  select id, code, name into v_sales from public.erp_gl_accounts a where a.id = v_config.sales_revenue_account_id;
  select id, code, name into v_gst from public.erp_gl_accounts a where a.id = v_config.gst_output_account_id;
  select id, code, name into v_clearing from public.erp_gl_accounts a where a.id = v_config.receivable_account_id;

  if v_sales.id is null or v_gst.id is null or v_clearing.id is null then
    raise exception 'Sales posting config missing';
  end if;

  if v_clearing.code <> '1102' then
    raise exception 'Razorpay clearing account (1102) missing';
  end if;

  select
    coalesce(sum(abs(r.taxable_value + r.shipping_taxable_value)) filter (
      where r.taxable_value < 0 or r.shipping_taxable_value < 0
    ), 0) as net_refund,
    coalesce(sum(abs(r.total_tax)) filter (where r.total_tax < 0), 0) as gst_refund,
    count(*) filter (
      where r.taxable_value < 0
        or r.shipping_taxable_value < 0
        or r.total_tax < 0
        or r.quantity < 0
    ) as refund_count
    into v_gst_net_total, v_gst_tax_total, v_gst_refund_count
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false;

  if coalesce(v_gst_refund_count, 0) > 0 then
    v_has_gst_refunds := true;
  end if;

  select
    coalesce(sum(gross), 0),
    count(*)
    into v_total_raw_gross, v_refund_count
  from (
    with refunds as (
      select
        r.value as refund,
        nullif(r.value->>'id', '') as refund_id,
        coalesce(nullif(r.value->>'processed_at', '')::timestamptz, nullif(r.value->>'created_at', '')::timestamptz)
          as refunded_at,
        coalesce((
          select sum(abs(nullif(item->>'subtotal', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as net_line,
        coalesce((
          select sum(abs(nullif(item->>'total_tax', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'refund_line_items', '[]'::jsonb)) as item
        ), 0) as gst_line,
        coalesce((
          select sum(abs(nullif(adj->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as net_adjust,
        coalesce((
          select sum(abs(nullif(adj->>'tax_amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'order_adjustments', '[]'::jsonb)) as adj
        ), 0) as gst_adjust,
        coalesce((
          select sum(abs(nullif(tx->>'amount', '')::numeric))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), 0) as gross_transactions,
        coalesce((
          select bool_or(lower(coalesce(tx->>'status', '')) in ('success', 'completed', 'processed'))
          from jsonb_array_elements(coalesce(r.value->'transactions', '[]'::jsonb)) as tx
          where lower(coalesce(tx->>'kind', '')) = 'refund'
        ), false) as has_successful_transaction
      from jsonb_array_elements(coalesce(v_order.raw_order->'refunds', '[]'::jsonb)) r(value)
    ),
    refund_totals as (
      select
        refund,
        refund_id,
        refunded_at,
        has_successful_transaction,
        round(net_line + net_adjust, 2) as net_raw,
        round(gst_line + gst_adjust, 2) as gst_raw,
        round(net_line + net_adjust + gst_line + gst_adjust, 2) as gross_raw,
        round(gross_transactions, 2) as gross_transactions
      from refunds
    )
    select
      refund,
      refund_id,
      refunded_at,
      has_successful_transaction,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else net_raw end as net,
      case when gross_raw <= 0 and gross_transactions > 0 then 0 else gst_raw end as gst,
      case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else gross_raw end as gross,
      coalesce(
        refund_id,
        encode(
          digest(
            format(
              '%s|%s|%s',
              v_order.id,
              coalesce(refunded_at::text, ''),
              round(
                case when gross_raw <= 0 and gross_transactions > 0 then gross_transactions else gross_raw end,
                2
              )
            ),
            'sha256'
          ),
          'hex'
        )
      ) as refund_source_id
    from refund_totals
  ) refunds
  where refund_source_id = p_refund_source_id
  limit 1;

  if v_refund.refund is null then
    raise exception 'Refund source not found';
  end if;

  if lower(coalesce(v_order.financial_status, '')) <> 'paid'
    and not coalesce(v_refund.has_successful_transaction, false) then
    raise exception 'Order is not paid';
  end if;

  if v_has_gst_refunds then
    if coalesce(v_total_raw_gross, 0) > 0 then
      v_refund_share := v_refund.gross / v_total_raw_gross;
    elsif coalesce(v_refund_count, 0) > 0 then
      v_refund_share := 1::numeric / v_refund_count;
    else
      v_refund_share := 0;
    end if;

    v_refund_net := round(v_gst_net_total * v_refund_share, 2);
    v_refund_gst := round(v_gst_tax_total * v_refund_share, 2);
    v_refund_gross := round(v_refund_net + v_refund_gst, 2);
  else
    v_refund_net := round(coalesce(v_refund.net, 0), 2);
    v_refund_gst := round(coalesce(v_refund.gst, 0), 2);
    v_refund_gross := round(coalesce(v_refund.gross, 0), 2);
  end if;

  if v_refund_gross <= 0 then
    raise exception 'Invalid refund totals';
  end if;

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
    coalesce(v_refund.refunded_at::date, v_order.order_created_at::date),
    'posted',
    format(
      'Shopify refund reversal for order %s (refund %s)',
      coalesce(v_order.shopify_order_number, v_order.shopify_order_id::text),
      p_refund_source_id
    ),
    'shopify_refund',
    v_order.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

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
    'Sales revenue reversal',
    v_refund_net,
    0
  );

  v_line_no := v_line_no + 1;

  if v_refund_gst > 0 then
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
      v_gst.code,
      v_gst.name,
      'GST output reversal',
      v_refund_gst,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

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
    'Razorpay clearing reversal',
    0,
    v_refund_gross
  );

  select
    coalesce(sum(l.debit), 0),
    coalesce(sum(l.credit), 0)
    into v_total_debit, v_total_credit
  from public.erp_fin_journal_lines l
  where l.company_id = v_company_id
    and l.journal_id = v_journal_id;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must be balanced';
  end if;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_sales_refund_finance_posts (
    company_id,
    order_id,
    refund_source_id,
    finance_journal_id,
    status,
    posted_at,
    posted_by_user_id,
    idempotency_key,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    v_order.id,
    p_refund_source_id,
    v_journal_id,
    'posted',
    now(),
    v_actor,
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor
  );

  return v_journal_id;
end;
$$;

revoke all on function public.erp_shopify_sales_finance_refund_post(uuid, text, uuid) from public;
grant execute on function public.erp_shopify_sales_finance_refund_post(uuid, text, uuid) to authenticated;

create or replace function public.erp_sales_finance_refund_preview(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_refund_preview(p_order_id);
end;
$$;

revoke all on function public.erp_sales_finance_refund_preview(uuid) from public;
grant execute on function public.erp_sales_finance_refund_preview(uuid) to authenticated;

create or replace function public.erp_sales_finance_refund_post(
  p_order_id uuid,
  p_refund_source_id text,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_refund_post(p_order_id, p_refund_source_id, p_idempotency_key);
end;
$$;

revoke all on function public.erp_sales_finance_refund_post(uuid, text, uuid) from public;
grant execute on function public.erp_sales_finance_refund_post(uuid, text, uuid) to authenticated;
