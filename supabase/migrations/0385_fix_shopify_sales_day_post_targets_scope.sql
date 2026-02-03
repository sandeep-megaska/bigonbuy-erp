begin;

create or replace function public.erp_shopify_sales_day_post_to_finance(
  p_day date,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_journal_id uuid;
  v_existing_journal_id uuid;
  v_doc_no text;
  v_total numeric(14,2);
  v_missing_count int;
  v_missing_order_ids uuid[];
  v_target_order_ids uuid[];
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

  if p_day is null then
    raise exception 'day is required';
  end if;

  perform public.erp__shopify_sales_assert_period_open(v_company_id, p_day);

  select j.id
    into v_existing_journal_id
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.reference_type = 'shopify_sales_day'
      and j.journal_date = p_day
    order by j.created_at desc nulls last
    limit 1;

  -- 1) Compute missing set (strictly unposted)
  with base as (
    select
      o.id,
      coalesce(f.net_sales_estimated, 0) as net_sales_estimated
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_facts f
      on f.company_id = v_company_id
     and f.order_id = o.shopify_order_id::text
    where o.company_id = v_company_id
      and o.order_created_at::date = p_day
      and not (o.is_cancelled or o.cancelled_at is not null)
  ),
  posts as (
    select
      coalesce(p.order_id, p.source_id) as order_id,
      coalesce(p.finance_journal_id, p.finance_doc_id) as journal_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  ),
  missing as (
    select b.id, b.net_sales_estimated
    from base b
    left join posts p
      on p.order_id = b.id
    where p.order_id is null
  )
  select
    array_agg(m.id),
    count(*)::int,
    coalesce(sum(m.net_sales_estimated), 0)
  into v_missing_order_ids, v_missing_count, v_total
  from missing m;

  if coalesce(v_missing_count, 0) = 0 then
    return v_existing_journal_id;
  end if;

  -- 2) Compute targets set:
  --    - all missing orders
  --    - plus any orders previously posted to the same existing day journal (for idempotent rebuild)
  with base as (
    select
      o.id,
      coalesce(f.net_sales_estimated, 0) as net_sales_estimated
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_facts f
      on f.company_id = v_company_id
     and f.order_id = o.shopify_order_id::text
    where o.company_id = v_company_id
      and o.order_created_at::date = p_day
      and not (o.is_cancelled or o.cancelled_at is not null)
  ),
  posts as (
    select
      coalesce(p.order_id, p.source_id) as order_id,
      coalesce(p.finance_journal_id, p.finance_doc_id) as journal_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  ),
  targets as (
    select b.id, b.net_sales_estimated
    from base b
    left join posts p
      on p.order_id = b.id
    where p.order_id is null
       or (v_existing_journal_id is not null and p.journal_id = v_existing_journal_id)
  )
  select
    array_agg(t.id),
    coalesce(sum(t.net_sales_estimated), 0)
  into v_target_order_ids, v_total
  from targets t;

  if v_total is null or v_total <= 0 then
    raise exception 'Invalid net sales amount';
  end if;

  -- Config (compat view now provides clearing_account_id + sales_account_id)
  select
    clearing_account_id,
    sales_account_id
    into v_config
  from public.erp_sales_posting_config c
  where c.company_id = v_company_id
  limit 1;

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

  -- Create or rebuild the day journal
  if v_existing_journal_id is null then
    insert into public.erp_fin_journals (
      company_id,
      journal_date,
      status,
      narration,
      reference_type,
      total_debit,
      total_credit,
      created_by,
      meta
    ) values (
      v_company_id,
      p_day,
      'posted',
      format('Shopify sales for %s', p_day),
      'shopify_sales_day',
      v_total,
      v_total,
      coalesce(p_actor_user_id, v_actor),
      jsonb_build_object(
        'day', p_day,
        'order_count', coalesce(array_length(v_target_order_ids, 1), 0),
        'order_ids', coalesce(to_jsonb(v_target_order_ids), '[]'::jsonb)
      )
    ) returning id into v_journal_id;
  else
    v_journal_id := v_existing_journal_id;

    update public.erp_fin_journals
    set total_debit = v_total,
        total_credit = v_total,
        narration = format('Shopify sales for %s', p_day),
        meta = jsonb_build_object(
          'day', p_day,
          'order_count', coalesce(array_length(v_target_order_ids, 1), 0),
          'order_ids', coalesce(to_jsonb(v_target_order_ids), '[]'::jsonb)
        )
    where id = v_journal_id
      and company_id = v_company_id;

    delete from public.erp_fin_journal_lines
    where company_id = v_company_id
      and journal_id = v_journal_id;
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
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_clearing.code,
      v_clearing.name,
      'Shopify sales clearing',
      v_total,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_sales.code,
      v_sales.name,
      'Shopify sales revenue',
      0,
      v_total
    );

  select j.doc_no
    into v_doc_no
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.id = v_journal_id;

  if v_doc_no is null then
    v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

    update public.erp_fin_journals
    set doc_no = v_doc_no
    where id = v_journal_id
      and company_id = v_company_id;
  end if;

  -- Upsert finance post rows for all currently missing orders (strictly missing only)
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
  )
  select
    v_company_id,
    'shopify_order',
    m.id,
    m.id,
    'JRN',
    v_journal_id,
    v_journal_id,
    'posted',
    now(),
    coalesce(p_actor_user_id, v_actor),
    jsonb_build_object('net_sales_estimated', m.net_sales_estimated)
  from (
    with base as (
      select
        o.id,
        coalesce(f.net_sales_estimated, 0) as net_sales_estimated
      from public.erp_shopify_orders o
      left join public.erp_shopify_order_facts f
        on f.company_id = v_company_id
       and f.order_id = o.shopify_order_id::text
      where o.company_id = v_company_id
        and o.order_created_at::date = p_day
        and not (o.is_cancelled or o.cancelled_at is not null)
    )
    select b.id, b.net_sales_estimated
    from base b
    left join public.erp_sales_finance_posts p
      on p.company_id = v_company_id
     and p.source_type = 'shopify_order'
     and p.status = 'posted'
     and coalesce(p.order_id, p.source_id) = b.id
    where p.id is null
  ) m
  on conflict (company_id, source_type, source_id) do update
    set finance_doc_id = excluded.finance_doc_id,
        finance_journal_id = excluded.finance_journal_id,
        order_id = excluded.order_id,
        status = excluded.status,
        posted_at = excluded.posted_at,
        posted_by_user_id = excluded.posted_by_user_id,
        meta = excluded.meta;

  return v_journal_id;
end;
$function$;

commit;
