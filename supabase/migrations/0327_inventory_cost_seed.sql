-- 0327_inventory_cost_seed.sql
-- Inventory cost seed table and COGS fallback resolution

create table if not exists public.erp_inventory_cost_seed (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  sku text null,
  standard_unit_cost numeric(14,4) not null,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null
);

alter table public.erp_inventory_cost_seed
  add constraint erp_inventory_cost_seed_standard_unit_cost_check
  check (standard_unit_cost > 0);

create unique index if not exists erp_inventory_cost_seed_company_variant_active
  on public.erp_inventory_cost_seed (company_id, variant_id)
  where is_active and is_void = false;

create index if not exists erp_inventory_cost_seed_company_sku_idx
  on public.erp_inventory_cost_seed (company_id, sku);

drop trigger if exists erp_inventory_cost_seed_set_updated_at on public.erp_inventory_cost_seed;
create trigger erp_inventory_cost_seed_set_updated_at
before update on public.erp_inventory_cost_seed
for each row execute function public.erp_set_updated_at();

alter table public.erp_inventory_cost_seed enable row level security;
alter table public.erp_inventory_cost_seed force row level security;

do $$
begin
  drop policy if exists erp_inventory_cost_seed_select on public.erp_inventory_cost_seed;
  drop policy if exists erp_inventory_cost_seed_write on public.erp_inventory_cost_seed;

  create policy erp_inventory_cost_seed_select
    on public.erp_inventory_cost_seed
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

  create policy erp_inventory_cost_seed_write
    on public.erp_inventory_cost_seed
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
            and cu.role_key in ('owner', 'admin', 'inventory')
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
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );
end;
$$;

create or replace function public.erp_inventory_cost_seed_upsert(
  p_variant_id uuid,
  p_standard_unit_cost numeric,
  p_effective_from date default current_date,
  p_sku text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_variant record;
  v_sku text;
  v_cost numeric(14,4) := p_standard_unit_cost;
  v_effective_from date := coalesce(p_effective_from, current_date);
  v_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_variant_id is null then
    raise exception 'variant_id is required';
  end if;

  if v_cost is null or v_cost <= 0 then
    raise exception 'standard_unit_cost must be greater than 0';
  end if;

  select v.id, v.sku
    into v_variant
    from public.erp_variants v
    where v.company_id = v_company_id
      and v.id = p_variant_id
    limit 1;

  if v_variant.id is null then
    raise exception 'variant not found';
  end if;

  v_sku := nullif(trim(coalesce(p_sku, v_variant.sku)), '');

  update public.erp_inventory_cost_seed
     set is_active = false,
         updated_at = now(),
         updated_by = auth.uid()
   where company_id = v_company_id
     and variant_id = p_variant_id
     and is_active = true
     and is_void = false;

  insert into public.erp_inventory_cost_seed (
    company_id,
    variant_id,
    sku,
    standard_unit_cost,
    effective_from,
    is_active,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_variant_id,
    v_sku,
    v_cost,
    v_effective_from,
    true,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_inventory_cost_seed_upsert(uuid, numeric, date, text) from public;
grant execute on function public.erp_inventory_cost_seed_upsert(uuid, numeric, date, text) to authenticated;

create or replace function public.erp_inventory_cost_seed_list(
  p_search text default null
) returns table(
  id uuid,
  variant_id uuid,
  sku text,
  product_title text,
  style_code text,
  color text,
  size text,
  standard_unit_cost numeric,
  effective_from date,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_reader();

  return query
  select
    s.id,
    s.variant_id,
    coalesce(s.sku, v.sku) as sku,
    p.title as product_title,
    v.style_code,
    v.color,
    v.size,
    s.standard_unit_cost,
    s.effective_from,
    s.updated_at
  from public.erp_inventory_cost_seed s
  left join public.erp_variants v
    on v.id = s.variant_id
    and v.company_id = s.company_id
  left join public.erp_products p
    on p.id = v.product_id
  where s.company_id = public.erp_current_company_id()
    and s.is_active = true
    and s.is_void = false
    and (
      p_search is null
      or coalesce(s.sku, v.sku, '') ilike ('%' || p_search || '%')
      or coalesce(v.style_code, '') ilike ('%' || p_search || '%')
      or coalesce(p.title, '') ilike ('%' || p_search || '%')
    )
  order by coalesce(s.sku, v.sku, ''), s.updated_at desc;
end;
$$;

revoke all on function public.erp_inventory_cost_seed_list(text) from public;
grant execute on function public.erp_inventory_cost_seed_list(text) to authenticated;

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
  v_missing_cost boolean := false;
  v_line record;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_variant_id uuid;
  v_oms_order_id uuid;
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

  select o.id
    into v_oms_order_id
    from public.erp_oms_orders o
    where o.company_id = v_company_id
      and o.source_order_id = v_order.id
    order by o.order_created_at desc nulls last
    limit 1;

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

    v_variant_id := null;

    if v_unit_cost is null and v_oms_order_id is not null then
      select ol.variant_id
        into v_variant_id
        from public.erp_oms_order_lines ol
        where ol.company_id = v_company_id
          and ol.order_id = v_oms_order_id
          and ol.sku = v_line.sku
          and ol.variant_id is not null
        order by ol.updated_at desc nulls last
        limit 1;
    end if;

    if v_variant_id is null then
      select v.id
        into v_variant_id
        from public.erp_variants v
        where v.company_id = v_company_id
          and v.sku = v_line.sku
        limit 1;
    end if;

    if v_unit_cost is null and v_variant_id is not null then
      select l.unit_cost
        into v_unit_cost
        from public.erp_inventory_ledger l
        where l.company_id = v_company_id
          and l.variant_id = v_variant_id
          and coalesce(l.qty_in, 0) > 0
          and l.unit_cost is not null
          and coalesce(l.is_void, false) = false
        order by l.created_at desc nulls last
        limit 1;
    end if;

    if v_unit_cost is null and v_variant_id is not null then
      select s.standard_unit_cost
        into v_unit_cost
        from public.erp_inventory_cost_seed s
        where s.company_id = v_company_id
          and s.variant_id = v_variant_id
          and s.is_active = true
          and s.is_void = false
        order by s.effective_from desc, s.created_at desc
        limit 1;
    end if;

    if v_unit_cost is null then
      select s.standard_unit_cost
        into v_unit_cost
        from public.erp_inventory_cost_seed s
        where s.company_id = v_company_id
          and s.sku = v_line.sku
          and s.is_active = true
          and s.is_void = false
        order by s.effective_from desc, s.created_at desc
        limit 1;
    end if;

    if v_unit_cost is null then
      v_errors := array_append(v_errors, format('Missing cost for SKU %s', v_line.sku));
      v_missing_cost := true;
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

  if v_total_cogs <= 0 and not v_missing_cost then
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
  v_variant_id uuid;
  v_oms_order_id uuid;
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

  select o.id
    into v_oms_order_id
    from public.erp_oms_orders o
    where o.company_id = v_company_id
      and o.source_order_id = v_order.id
    order by o.order_created_at desc nulls last
    limit 1;

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

    v_variant_id := null;

    if v_unit_cost is null and v_oms_order_id is not null then
      select ol.variant_id
        into v_variant_id
        from public.erp_oms_order_lines ol
        where ol.company_id = v_company_id
          and ol.order_id = v_oms_order_id
          and ol.sku = v_line.sku
          and ol.variant_id is not null
        order by ol.updated_at desc nulls last
        limit 1;
    end if;

    if v_variant_id is null then
      select v.id
        into v_variant_id
        from public.erp_variants v
        where v.company_id = v_company_id
          and v.sku = v_line.sku
        limit 1;
    end if;

    if v_unit_cost is null and v_variant_id is not null then
      select l.unit_cost
        into v_unit_cost
        from public.erp_inventory_ledger l
        where l.company_id = v_company_id
          and l.variant_id = v_variant_id
          and coalesce(l.qty_in, 0) > 0
          and l.unit_cost is not null
          and coalesce(l.is_void, false) = false
        order by l.created_at desc nulls last
        limit 1;
    end if;

    if v_unit_cost is null and v_variant_id is not null then
      select s.standard_unit_cost
        into v_unit_cost
        from public.erp_inventory_cost_seed s
        where s.company_id = v_company_id
          and s.variant_id = v_variant_id
          and s.is_active = true
          and s.is_void = false
        order by s.effective_from desc, s.created_at desc
        limit 1;
    end if;

    if v_unit_cost is null then
      select s.standard_unit_cost
        into v_unit_cost
        from public.erp_inventory_cost_seed s
        where s.company_id = v_company_id
          and s.sku = v_line.sku
          and s.is_active = true
          and s.is_void = false
        order by s.effective_from desc, s.created_at desc
        limit 1;
    end if;

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
