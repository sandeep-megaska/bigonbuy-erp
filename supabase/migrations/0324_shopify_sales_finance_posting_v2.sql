-- Shopify sales finance posting adjustments (Razorpay clearing, idempotency fields)

alter table public.erp_sales_finance_posts
  add column if not exists order_id uuid null,
  add column if not exists finance_journal_id uuid null references public.erp_fin_journals (id);

update public.erp_sales_finance_posts
set order_id = source_id
where order_id is null
  and source_type = 'shopify_order';

update public.erp_sales_finance_posts
set finance_journal_id = finance_doc_id
where finance_journal_id is null;

create unique index if not exists erp_sales_finance_posts_company_order_unique
  on public.erp_sales_finance_posts (company_id, order_id)
  where order_id is not null;

create or replace function public.erp_sales_finance_posting_config_seed_minimal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_sales_id uuid;
  v_gst_id uuid;
  v_receivable_id uuid;
  v_missing text[] := '{}'::text[];
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select id into v_sales_id
  from public.erp_gl_accounts
  where company_id = v_company_id and code = '4001'
  limit 1;

  select id into v_gst_id
  from public.erp_gl_accounts
  where company_id = v_company_id and code = '2201'
  limit 1;

  select id into v_receivable_id
  from public.erp_gl_accounts
  where company_id = v_company_id and code = '1102'
  limit 1;

  if v_sales_id is null then
    v_missing := array_append(v_missing, '4001');
  end if;
  if v_gst_id is null then
    v_missing := array_append(v_missing, '2201');
  end if;
  if v_receivable_id is null then
    v_missing := array_append(v_missing, '1102');
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object(
      'company_id', v_company_id,
      'applied', false,
      'missing_codes', v_missing
    );
  end if;

  v_result := public.erp_sales_finance_posting_config_upsert(
    v_sales_id,
    v_gst_id,
    v_receivable_id
  );

  return jsonb_build_object(
    'company_id', v_company_id,
    'applied', true,
    'config', v_result
  );
end;
$$;

revoke all on function public.erp_sales_finance_posting_config_seed_minimal() from public;
grant execute on function public.erp_sales_finance_posting_config_seed_minimal() to authenticated;

create or replace function public.erp_shopify_sales_finance_posting_preview(
  p_source_id uuid
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
  v_gst_totals record;
  v_net_sales numeric(14,2) := 0;
  v_gst_amount numeric(14,2) := 0;
  v_gross_total numeric(14,2) := 0;
  v_errors text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_can_post boolean := false;
  v_post record;
  v_payment_gateways text[] := '{}'::text[];
  v_is_razorpay boolean := false;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_source_id
      and o.company_id = v_company_id;

  if v_order.id is null then
    return jsonb_build_object(
      'source', jsonb_build_object('id', p_source_id, 'channel', 'shopify'),
      'totals', jsonb_build_object('net_sales', 0, 'gst', 0, 'gross_total', 0),
      'lines', '[]'::jsonb,
      'errors', jsonb_build_array('Source not found'),
      'can_post', false
    );
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    v_errors := array_append(v_errors, 'Order is cancelled');
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

  select array_agg(distinct lower(trim(value)))
    into v_payment_gateways
    from jsonb_array_elements_text(coalesce(v_order.raw_order->'payment_gateway_names', '[]'::jsonb)) as value;

  if array_length(v_payment_gateways, 1) is null then
    select array_agg(distinct lower(trim(r.payment_gateway)))
      into v_payment_gateways
      from public.erp_gst_sales_register r
      where r.company_id = v_company_id
        and r.source_order_id = v_order.id
        and r.is_void = false
        and r.payment_gateway is not null;
  end if;

  if array_length(v_payment_gateways, 1) is not null then
    select exists (
      select 1
      from unnest(v_payment_gateways) as gateway
      where gateway like '%razorpay%'
    ) into v_is_razorpay;
  end if;

  if not v_is_razorpay then
    v_errors := array_append(v_errors, 'Payment gateway is not Razorpay');
  end if;

  select
    coalesce(sum(r.taxable_value + r.shipping_taxable_value), 0) as net_sales,
    coalesce(sum(r.total_tax), 0) as gst_amount,
    count(*) as line_count
    into v_gst_totals
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false;

  if coalesce(v_gst_totals.line_count, 0) > 0 then
    v_net_sales := round(coalesce(v_gst_totals.net_sales, 0), 2);
    v_gst_amount := round(coalesce(v_gst_totals.gst_amount, 0), 2);
  else
    v_net_sales := round(
      coalesce(v_order.subtotal_price, 0) - coalesce(v_order.total_discounts, 0) + coalesce(v_order.total_shipping, 0),
      2
    );
    v_gst_amount := round(coalesce(v_order.total_tax, 0), 2);
  end if;

  v_gross_total := round(v_net_sales + v_gst_amount, 2);

  if v_net_sales <= 0 or v_gross_total <= 0 then
    v_errors := array_append(v_errors, 'Invalid totals');
  end if;

  if array_length(v_errors, 1) is null then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'memo', 'Shopify order clearing',
        'side', 'debit',
        'amount', v_gross_total,
        'account_id', v_clearing.id,
        'account_code', v_clearing.code,
        'account_name', v_clearing.name
      ),
      jsonb_build_object(
        'memo', 'Shopify sales revenue',
        'side', 'credit',
        'amount', v_net_sales,
        'account_id', v_sales.id,
        'account_code', v_sales.code,
        'account_name', v_sales.name
      )
    );

    if v_gst_amount > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'memo', 'GST output',
          'side', 'credit',
          'amount', v_gst_amount,
          'account_id', v_gst.id,
          'account_code', v_gst.code,
          'account_name', v_gst.name
        )
      );
    end if;

    v_can_post := true;
  end if;

  select p.finance_doc_id, j.doc_no
    into v_post
    from public.erp_sales_finance_posts p
    join public.erp_fin_journals j
      on j.id = p.finance_doc_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = v_order.id or p.order_id = v_order.id);

  return jsonb_build_object(
    'source', jsonb_build_object(
      'id', v_order.id,
      'order_no', v_order.shopify_order_number,
      'order_id', v_order.shopify_order_id,
      'date', v_order.order_created_at::date,
      'channel', 'shopify',
      'currency', v_order.currency
    ),
    'totals', jsonb_build_object(
      'net_sales', v_net_sales,
      'gst', v_gst_amount,
      'gross_total', v_gross_total
    ),
    'lines', v_lines,
    'errors', to_jsonb(v_errors),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', v_post.finance_doc_id,
      'doc_no', v_post.doc_no
    )
  );
end;
$$;

revoke all on function public.erp_shopify_sales_finance_posting_preview(uuid) from public;
grant execute on function public.erp_shopify_sales_finance_posting_preview(uuid) to authenticated;

create or replace function public.erp_shopify_sales_finance_post(
  p_source_id uuid,
  p_idempotency_key uuid default null,
  p_notes text default null
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
  v_gst_totals record;
  v_net_sales numeric(14,2) := 0;
  v_gst_amount numeric(14,2) := 0;
  v_gross_total numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_payment_gateways text[] := '{}'::text[];
  v_is_razorpay boolean := false;
  v_line_no int := 1;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_source_id
      and o.company_id = v_company_id
    for update;

  if v_order.id is null then
    raise exception 'Source not found';
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    raise exception 'Order is cancelled';
  end if;

  if p_idempotency_key is not null then
    select p.finance_doc_id
      into v_existing_doc_id
      from public.erp_sales_finance_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_doc_id
    into v_existing_doc_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = p_source_id or p.order_id = p_source_id);

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

  if v_sales.id is null or v_gst.id is null then
    raise exception 'Sales posting config missing';
  end if;

  select id, code, name into v_clearing from public.erp_gl_accounts a where a.id = v_config.receivable_account_id;

  if v_clearing.id is null or v_clearing.code <> '1102' then
    raise exception 'Razorpay clearing account (1102) missing';
  end if;

  select array_agg(distinct lower(trim(value)))
    into v_payment_gateways
    from jsonb_array_elements_text(coalesce(v_order.raw_order->'payment_gateway_names', '[]'::jsonb)) as value;

  if array_length(v_payment_gateways, 1) is null then
    select array_agg(distinct lower(trim(r.payment_gateway)))
      into v_payment_gateways
      from public.erp_gst_sales_register r
      where r.company_id = v_company_id
        and r.source_order_id = v_order.id
        and r.is_void = false
        and r.payment_gateway is not null;
  end if;

  if array_length(v_payment_gateways, 1) is not null then
    select exists (
      select 1
      from unnest(v_payment_gateways) as gateway
      where gateway like '%razorpay%'
    ) into v_is_razorpay;
  end if;

  if not v_is_razorpay then
    raise exception 'Payment gateway is not Razorpay';
  end if;

  select
    coalesce(sum(r.taxable_value + r.shipping_taxable_value), 0) as net_sales,
    coalesce(sum(r.total_tax), 0) as gst_amount,
    count(*) as line_count
    into v_gst_totals
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false;

  if coalesce(v_gst_totals.line_count, 0) > 0 then
    v_net_sales := round(coalesce(v_gst_totals.net_sales, 0), 2);
    v_gst_amount := round(coalesce(v_gst_totals.gst_amount, 0), 2);
  else
    v_net_sales := round(
      coalesce(v_order.subtotal_price, 0) - coalesce(v_order.total_discounts, 0) + coalesce(v_order.total_shipping, 0),
      2
    );
    v_gst_amount := round(coalesce(v_order.total_tax, 0), 2);
  end if;

  v_gross_total := round(v_net_sales + v_gst_amount, 2);

  if v_net_sales <= 0 or v_gross_total <= 0 then
    raise exception 'Invalid totals';
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
    v_order.order_created_at::date,
    'posted',
    coalesce(p_notes, format('Shopify order %s', coalesce(v_order.shopify_order_number, v_order.shopify_order_id::text))),
    'shopify_order',
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
    v_clearing.code,
    v_clearing.name,
    'Razorpay clearing',
    v_gross_total,
    0
  );

  v_line_no := v_line_no + 1;

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
    'Sales revenue',
    0,
    v_net_sales
  );

  if v_gst_amount > 0 then
    v_line_no := v_line_no + 1;
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
      'GST output',
      0,
      v_gst_amount
    );
  end if;

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

  insert into public.erp_sales_finance_posts (
    company_id,
    source_type,
    source_id,
    finance_doc_type,
    finance_doc_id,
    finance_journal_id,
    order_id,
    status,
    posted_at,
    posted_by_user_id,
    meta,
    idempotency_key
  ) values (
    v_company_id,
    'shopify_order',
    v_order.id,
    'JRN',
    v_journal_id,
    v_journal_id,
    v_order.id,
    'posted',
    now(),
    v_actor,
    jsonb_build_object('order_id', v_order.shopify_order_id),
    p_idempotency_key
  );

  return v_journal_id;
end;
$$;

revoke all on function public.erp_shopify_sales_finance_post(uuid, uuid, text) from public;
grant execute on function public.erp_shopify_sales_finance_post(uuid, uuid, text) to authenticated;

create or replace function public.erp_sales_finance_posting_preview(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_posting_preview(p_order_id);
end;
$$;

revoke all on function public.erp_sales_finance_posting_preview(uuid) from public;
grant execute on function public.erp_sales_finance_posting_preview(uuid) to authenticated;

create or replace function public.erp_sales_finance_post(
  p_order_id uuid,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_post(p_order_id, p_idempotency_key, null);
end;
$$;

revoke all on function public.erp_sales_finance_post(uuid, uuid) from public;
grant execute on function public.erp_sales_finance_post(uuid, uuid) to authenticated;
