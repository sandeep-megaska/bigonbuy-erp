alter table public.erp_sales_finance_posts
  add column if not exists cogs_posted_at timestamptz null,
  add column if not exists cogs_posted_by_user_id uuid null,
  add column if not exists cogs_journal_id uuid null,
  add column if not exists cogs_status text not null default 'not_posted';

create or replace function public.erp_shopify_sales_finance_cogs_preview(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_order record;
  v_post record;
  v_cogs_account record;
  v_inventory_account record;
  v_errors text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_journal_lines jsonb := '[]'::jsonb;
  v_total_cogs numeric(14,2) := 0;
  v_can_post boolean := false;
  v_missing_sku_count int := 0;
  v_line record;
  v_unit_cost numeric;
  v_line_cost numeric;
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
      'total_cogs', 0,
      'lines', '[]'::jsonb,
      'journal_lines', '[]'::jsonb,
      'errors', jsonb_build_array('Source not found'),
      'can_post', false
    );
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    v_errors := array_append(v_errors, 'Order is cancelled');
  end if;

  if lower(coalesce(v_order.financial_status, '')) <> 'paid' then
    v_errors := array_append(v_errors, 'Order is not paid');
  end if;

  select p.finance_doc_id,
         j.doc_no,
         p.cogs_posted_at,
         p.cogs_journal_id,
         p.cogs_status
    into v_post
    from public.erp_sales_finance_posts p
    left join public.erp_fin_journals j
      on j.id = p.finance_doc_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = v_order.id or p.order_id = v_order.id);

  if v_post.finance_doc_id is null then
    v_errors := array_append(v_errors, 'Revenue posting not found');
  end if;

  select id, code, name
    into v_cogs_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.code = '5001';

  select id, code, name
    into v_inventory_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.code = '1301';

  if v_cogs_account.id is null or v_inventory_account.id is null then
    v_errors := array_append(v_errors, 'COGS accounts (5001/1301) missing');
  end if;

  select count(*)
    into v_missing_sku_count
    from public.erp_shopify_order_lines l
    where l.company_id = v_company_id
      and l.order_id = v_order.id
      and (l.sku is null or trim(l.sku) = '');

  if v_missing_sku_count > 0 then
    v_errors := array_append(v_errors, 'Missing SKU for one or more order lines');
  end if;

  for v_line in
    select l.sku, sum(l.quantity)::numeric as qty
      from public.erp_shopify_order_lines l
      where l.company_id = v_company_id
        and l.order_id = v_order.id
        and coalesce(l.quantity, 0) > 0
        and l.sku is not null
        and trim(l.sku) <> ''
      group by l.sku
  loop
    select c.effective_unit_cost_final
      into v_unit_cost
      from public.erp_inventory_effective_unit_cost_v c
      where c.company_id = v_company_id
        and c.sku = v_line.sku
      order by c.on_hand_qty desc nulls last
      limit 1;

    if v_unit_cost is null then
      v_errors := array_append(v_errors, format('Missing cost for SKU %s', v_line.sku));
      continue;
    end if;

    v_line_cost := round(coalesce(v_line.qty, 0) * v_unit_cost, 2);
    v_total_cogs := v_total_cogs + v_line_cost;

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'sku', v_line.sku,
        'qty', v_line.qty,
        'unit_cost', v_unit_cost,
        'line_cost', v_line_cost
      )
    );
  end loop;

  v_total_cogs := round(v_total_cogs, 2);

  if v_total_cogs <= 0 then
    v_errors := array_append(v_errors, 'Invalid COGS total');
  end if;

  if array_length(v_errors, 1) is null
     and coalesce(v_post.cogs_posted_at, null) is null
     and coalesce(v_post.cogs_status, 'not_posted') <> 'posted' then
    v_journal_lines := jsonb_build_array(
      jsonb_build_object(
        'memo', 'Cost of goods sold',
        'side', 'debit',
        'amount', v_total_cogs,
        'account_id', v_cogs_account.id,
        'account_code', v_cogs_account.code,
        'account_name', v_cogs_account.name
      ),
      jsonb_build_object(
        'memo', 'Inventory asset',
        'side', 'credit',
        'amount', v_total_cogs,
        'account_id', v_inventory_account.id,
        'account_code', v_inventory_account.code,
        'account_name', v_inventory_account.name
      )
    );
    v_can_post := true;
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
    'total_cogs', v_total_cogs,
    'lines', v_lines,
    'journal_lines', v_journal_lines,
    'errors', to_jsonb(v_errors),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', coalesce(v_post.cogs_journal_id, v_post.finance_doc_id),
      'doc_no', v_post.doc_no,
      'cogs_status', v_post.cogs_status
    )
  );
end;
$$;

revoke all on function public.erp_shopify_sales_finance_cogs_preview(uuid) from public;
grant execute on function public.erp_shopify_sales_finance_cogs_preview(uuid) to authenticated;

create or replace function public.erp_shopify_sales_finance_cogs_post(
  p_order_id uuid,
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
  v_post record;
  v_cogs_account record;
  v_inventory_account record;
  v_line record;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_total_cogs numeric(14,2) := 0;
  v_journal_id uuid;
  v_line_no int := 1;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_missing_sku_count int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_order_id
      and o.company_id = v_company_id
    for update;

  if v_order.id is null then
    raise exception 'Source not found';
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    raise exception 'Order is cancelled';
  end if;

  if lower(coalesce(v_order.financial_status, '')) <> 'paid' then
    raise exception 'Order is not paid';
  end if;

  select *
    into v_post
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = v_order.id or p.order_id = v_order.id)
    for update;

  if v_post.id is null then
    raise exception 'Revenue posting not found';
  end if;

  if coalesce(v_post.cogs_posted_at, null) is not null
     or coalesce(v_post.cogs_status, 'not_posted') = 'posted' then
    return coalesce(v_post.cogs_journal_id, v_post.finance_doc_id);
  end if;

  select id, code, name
    into v_cogs_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.code = '5001';

  select id, code, name
    into v_inventory_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.code = '1301';

  if v_cogs_account.id is null or v_inventory_account.id is null then
    raise exception 'COGS accounts (5001/1301) missing';
  end if;

  select count(*)
    into v_missing_sku_count
    from public.erp_shopify_order_lines l
    where l.company_id = v_company_id
      and l.order_id = v_order.id
      and (l.sku is null or trim(l.sku) = '');

  if v_missing_sku_count > 0 then
    raise exception 'Missing SKU for one or more order lines';
  end if;

  for v_line in
    select l.sku, sum(l.quantity)::numeric as qty
      from public.erp_shopify_order_lines l
      where l.company_id = v_company_id
        and l.order_id = v_order.id
        and coalesce(l.quantity, 0) > 0
        and l.sku is not null
        and trim(l.sku) <> ''
      group by l.sku
  loop
    select c.effective_unit_cost_final
      into v_unit_cost
      from public.erp_inventory_effective_unit_cost_v c
      where c.company_id = v_company_id
        and c.sku = v_line.sku
      order by c.on_hand_qty desc nulls last
      limit 1;

    if v_unit_cost is null then
      raise exception 'Missing cost for SKU %', v_line.sku;
    end if;

    v_line_cost := round(coalesce(v_line.qty, 0) * v_unit_cost, 2);
    v_total_cogs := v_total_cogs + v_line_cost;
  end loop;

  v_total_cogs := round(v_total_cogs, 2);

  if v_total_cogs <= 0 then
    raise exception 'Invalid COGS total';
  end if;

  v_journal_id := v_post.finance_doc_id;

  if v_journal_id is null then
    raise exception 'Missing finance journal';
  end if;

  select coalesce(max(l.line_no), 0) + 1
    into v_line_no
    from public.erp_fin_journal_lines l
    where l.company_id = v_company_id
      and l.journal_id = v_journal_id;

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
    v_cogs_account.code,
    v_cogs_account.name,
    'Cost of goods sold',
    v_total_cogs,
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
    v_inventory_account.code,
    v_inventory_account.name,
    'Inventory asset',
    0,
    v_total_cogs
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

  update public.erp_sales_finance_posts
  set cogs_posted_at = now(),
      cogs_posted_by_user_id = v_actor,
      cogs_status = 'posted',
      cogs_journal_id = v_journal_id
  where id = v_post.id;

  return v_journal_id;
end;
$$;

revoke all on function public.erp_shopify_sales_finance_cogs_post(uuid, uuid) from public;
grant execute on function public.erp_shopify_sales_finance_cogs_post(uuid, uuid) to authenticated;

create or replace function public.erp_sales_finance_cogs_preview(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_cogs_preview(p_order_id);
end;
$$;

revoke all on function public.erp_sales_finance_cogs_preview(uuid) from public;
grant execute on function public.erp_sales_finance_cogs_preview(uuid) to authenticated;

create or replace function public.erp_sales_finance_cogs_post(
  p_order_id uuid,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_shopify_sales_finance_cogs_post(p_order_id, p_idempotency_key);
end;
$$;

revoke all on function public.erp_sales_finance_cogs_post(uuid, uuid) from public;
grant execute on function public.erp_sales_finance_cogs_post(uuid, uuid) to authenticated;
