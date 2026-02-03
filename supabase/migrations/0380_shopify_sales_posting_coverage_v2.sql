-- 0380_shopify_sales_posting_coverage_v2.sql
-- Shopify sales posting coverage (facts-based) + idempotent posting adapter

begin;

-- -------------------------------------------------------------------
-- 1) Helper: internal period lock enforcement (reuse canonical finance lock)
-- -------------------------------------------------------------------

create or replace function public.erp__shopify_sales_assert_period_open(
  p_company_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_fin_open_period(p_company_id, p_date);
end;
$$;

revoke all on function public.erp__shopify_sales_assert_period_open(uuid, date) from public;
grant execute on function public.erp__shopify_sales_assert_period_open(uuid, date) to authenticated;

-- -------------------------------------------------------------------
-- 2) RPC: posting coverage summary for Shopify orders (facts-based)
-- -------------------------------------------------------------------

create or replace function public.erp_sales_shopify_posting_summary(
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
  with base as (
    select
      o.id,
      (o.is_cancelled or o.cancelled_at is not null) as is_excluded,
      coalesce(f.net_sales_estimated, 0) as net_sales_estimated
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_facts f
      on f.company_id = v_company_id
     and f.order_id = o.shopify_order_id::text
    where o.company_id = v_company_id
      and o.order_created_at::date between p_from and p_to
  ),
  posts as (
    select p.source_id as order_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  )
  select
    count(*)::int as total_count,
    sum(case when b.is_excluded = false and p.order_id is not null then 1 else 0 end)::int as posted_count,
    sum(case when b.is_excluded = false and p.order_id is null then 1 else 0 end)::int as missing_count,
    sum(case when b.is_excluded = true then 1 else 0 end)::int as excluded_count,
    coalesce(sum(b.net_sales_estimated), 0) as total_amount,
    coalesce(sum(case when b.is_excluded = false and p.order_id is not null then b.net_sales_estimated else 0 end), 0) as posted_amount,
    coalesce(sum(case when b.is_excluded = false and p.order_id is null then b.net_sales_estimated else 0 end), 0) as missing_amount,
    coalesce(sum(case when b.is_excluded = true then b.net_sales_estimated else 0 end), 0) as excluded_amount
  from base b
  left join posts p
    on p.order_id = b.id;
end;
$$;

revoke all on function public.erp_sales_shopify_posting_summary(date, date) from public;
grant execute on function public.erp_sales_shopify_posting_summary(date, date) to authenticated;

-- -------------------------------------------------------------------
-- 3) RPC: list Shopify orders with posting state + journal link
-- -------------------------------------------------------------------

create or replace function public.erp_shopify_orders_list_with_posting(
  p_from date,
  p_to date,
  p_search text default null,
  p_posting_filter text default 'all'
) returns table (
  order_uuid uuid,
  order_number text,
  order_created_at date,
  ship_state text,
  ship_city text,
  amount numeric,
  posting_state text,
  journal_id uuid,
  journal_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_pf text := lower(coalesce(nullif(trim(p_posting_filter), ''), 'all'));
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with base as (
    select
      o.id as order_uuid,
      coalesce(o.shopify_order_number, o.shopify_order_id::text) as order_number,
      o.order_created_at::date as order_created_at,
      f.ship_state,
      f.ship_city,
      coalesce(f.net_sales_estimated, 0) as amount,
      (o.is_cancelled or o.cancelled_at is not null) as is_excluded,
      o.created_at
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_facts f
      on f.company_id = v_company_id
     and f.order_id = o.shopify_order_id::text
    where o.company_id = v_company_id
      and o.order_created_at::date between p_from and p_to
      and (
        p_search is null
        or p_search = ''
        or o.shopify_order_number ilike ('%' || p_search || '%')
        or o.shopify_order_id::text ilike ('%' || p_search || '%')
        or coalesce(o.customer_email, '') ilike ('%' || p_search || '%')
      )
  ),
  posts as (
    select
      p.source_id as order_id,
      coalesce(p.finance_journal_id, p.finance_doc_id) as journal_id,
      j.doc_no as journal_no
    from public.erp_sales_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = coalesce(p.finance_journal_id, p.finance_doc_id)
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  ),
  merged as (
    select
      b.order_uuid,
      b.order_number,
      b.order_created_at,
      b.ship_state,
      b.ship_city,
      b.amount,
      case
        when b.is_excluded then 'excluded'
        when p.journal_id is not null then 'posted'
        else 'missing'
      end as posting_state,
      p.journal_id,
      p.journal_no,
      b.created_at
    from base b
    left join posts p
      on p.order_id = b.order_uuid
  )
  select
    m.order_uuid,
    m.order_number,
    m.order_created_at,
    m.ship_state,
    m.ship_city,
    m.amount,
    m.posting_state,
    m.journal_id,
    m.journal_no
  from merged m
  where
    v_pf = 'all'
    or (v_pf = 'posted' and m.posting_state = 'posted')
    or (v_pf = 'missing' and m.posting_state = 'missing')
    or (v_pf = 'excluded' and m.posting_state = 'excluded')
  order by m.order_created_at desc, m.created_at desc nulls last;
end;
$$;

revoke all on function public.erp_shopify_orders_list_with_posting(date, date, text, text) from public;
grant execute on function public.erp_shopify_orders_list_with_posting(date, date, text, text) to authenticated;

-- -------------------------------------------------------------------
-- 4) RPC: posting status for a single Shopify order
-- -------------------------------------------------------------------

create or replace function public.erp_shopify_order_finance_posting_get(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_post record;
begin
  perform public.erp_require_finance_reader();

  select p.*, j.doc_no
    into v_post
    from public.erp_sales_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = coalesce(p.finance_journal_id, p.finance_doc_id)
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = p_order_id or p.order_id = p_order_id)
      and p.status = 'posted';

  if v_post.id is null then
    return jsonb_build_object('posted', false);
  end if;

  return jsonb_build_object(
    'posted', true,
    'finance_doc_id', coalesce(v_post.finance_journal_id, v_post.finance_doc_id),
    'finance_doc_type', v_post.finance_doc_type,
    'posted_at', v_post.posted_at,
    'posted_by_user_id', v_post.posted_by_user_id,
    'journal_no', v_post.doc_no,
    'link', format('/erp/finance/journals/%s', coalesce(v_post.finance_journal_id, v_post.finance_doc_id))
  );
end;
$$;

revoke all on function public.erp_shopify_order_finance_posting_get(uuid) from public;
grant execute on function public.erp_shopify_order_finance_posting_get(uuid) to authenticated;

-- -------------------------------------------------------------------
-- 5) RPC: post a single Shopify order to finance (journal)
-- -------------------------------------------------------------------

create or replace function public.erp_shopify_order_post_to_finance(
  p_order_id uuid,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_order public.erp_shopify_orders%rowtype;
  v_existing_doc_id uuid;
  v_journal_id uuid;
  v_doc_no text;
  v_post_date date;
  v_amount numeric(14,2);
  v_config record;
  v_clearing record;
  v_sales record;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.company_id = v_company_id
      and o.id = p_order_id
    for update;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    raise exception 'Order is cancelled';
  end if;

  select coalesce(p.finance_journal_id, p.finance_doc_id)
    into v_existing_doc_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = p_order_id or p.order_id = p_order_id)
      and p.status = 'posted';

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select j.id
    into v_existing_doc_id
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.reference_type = 'shopify_order'
      and j.reference_id = p_order_id
    order by j.created_at desc nulls last
    limit 1;

  if v_existing_doc_id is not null then
    insert into public.erp_sales_finance_posts (
      company_id,
      source_type,
      source_id,
      order_id,
      finance_doc_type,
      finance_doc_id,
      finance_journal_id,
      status,
      posted_at,
      posted_by_user_id,
      meta
    ) values (
      v_company_id,
      'shopify_order',
      p_order_id,
      p_order_id,
      'JRN',
      v_existing_doc_id,
      v_existing_doc_id,
      'posted',
      now(),
      coalesce(p_actor_user_id, v_actor),
      jsonb_build_object('note', 'backfilled from existing journal')
    )
    on conflict (company_id, source_type, source_id) do nothing;

    return v_existing_doc_id;
  end if;

  select f.net_sales_estimated
    into v_amount
    from public.erp_shopify_order_facts f
    where f.company_id = v_company_id
      and f.order_id = v_order.shopify_order_id::text
    limit 1;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Invalid net sales amount';
  end if;

  v_post_date := v_order.order_created_at::date;
  perform public.erp__shopify_sales_assert_period_open(v_company_id, v_post_date);

  select
    clearing_account_id,
    sales_account_id
    into v_config
  from public.erp_sales_posting_config c
  where c.company_id = v_company_id;

  if v_config.clearing_account_id is null or v_config.sales_account_id is null then
    raise exception 'Sales posting config missing';
  end if;

  select id, code, name
    into v_clearing
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.id = v_config.clearing_account_id;

  select id, code, name
    into v_sales
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.id = v_config.sales_account_id;

  if v_clearing.id is null or v_sales.id is null then
    raise exception 'Sales posting accounts missing';
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
    v_post_date,
    'posted',
    format('Shopify order %s', coalesce(v_order.shopify_order_number, v_order.shopify_order_id::text)),
    'shopify_order',
    v_order.id,
    v_amount,
    v_amount,
    coalesce(p_actor_user_id, v_actor)
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
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_clearing.code,
      v_clearing.name,
      'Shopify order clearing',
      v_amount,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_sales.code,
      v_sales.name,
      'Shopify sales',
      0,
      v_amount
    );

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_sales_finance_posts (
    company_id,
    source_type,
    source_id,
    order_id,
    finance_doc_type,
    finance_doc_id,
    finance_journal_id,
    status,
    posted_at,
    posted_by_user_id,
    meta
  ) values (
    v_company_id,
    'shopify_order',
    v_order.id,
    v_order.id,
    'JRN',
    v_journal_id,
    v_journal_id,
    'posted',
    now(),
    coalesce(p_actor_user_id, v_actor),
    jsonb_build_object('net_sales_estimated', v_amount)
  );

  return v_journal_id;
exception
  when unique_violation then
    select coalesce(p.finance_journal_id, p.finance_doc_id)
      into v_existing_doc_id
      from public.erp_sales_finance_posts p
      where p.company_id = v_company_id
        and p.source_type = 'shopify_order'
        and (p.source_id = p_order_id or p.order_id = p_order_id)
        and p.status = 'posted'
      limit 1;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;

    raise;
end;
$$;

revoke all on function public.erp_shopify_order_post_to_finance(uuid, uuid) from public;
grant execute on function public.erp_shopify_order_post_to_finance(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
