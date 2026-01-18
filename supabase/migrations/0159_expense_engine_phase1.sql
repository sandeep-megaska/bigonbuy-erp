-- Expense engine phase 1 (categories + expenses + reports + import)

create or replace function public.erp_require_finance_writer()
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
      and cu.role_key in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_finance_writer() from public;
grant execute on function public.erp_require_finance_writer() to authenticated;

create table if not exists public.erp_expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  code text not null,
  name text not null,
  group_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint erp_expense_categories_unique unique (company_id, code)
);
alter table public.erp_expense_categories
  add column if not exists group_key text;

update public.erp_expense_categories
set group_key = coalesce(group_key, 'other')
where group_key is null;

create index if not exists erp_expense_categories_company_idx
  on public.erp_expense_categories (company_id, group_key);

create table if not exists public.erp_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  expense_date date not null default current_date,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'INR',
  category_id uuid not null references public.erp_expense_categories (id) on delete restrict,
  channel_id uuid null references public.erp_sales_channels (id) on delete set null,
  warehouse_id uuid null references public.erp_warehouses (id) on delete set null,
  vendor_id uuid null references public.erp_vendors (id) on delete set null,
  payee_name text null,
  reference text null,
  description text null,
  is_recurring boolean not null default false,
  recurring_rule text null,
  allocation_type text not null default 'direct',
  attachment_url text null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_expenses_company_date_idx
  on public.erp_expenses (company_id, expense_date);

create index if not exists erp_expenses_company_category_idx
  on public.erp_expenses (company_id, category_id);

create index if not exists erp_expenses_company_channel_idx
  on public.erp_expenses (company_id, channel_id);

create index if not exists erp_expenses_company_warehouse_idx
  on public.erp_expenses (company_id, warehouse_id);

alter table public.erp_expense_categories enable row level security;
alter table public.erp_expense_categories force row level security;
alter table public.erp_expenses enable row level security;
alter table public.erp_expenses force row level security;

do $$
begin
  drop policy if exists erp_expense_categories_select on public.erp_expense_categories;
  drop policy if exists erp_expense_categories_write on public.erp_expense_categories;
  drop policy if exists erp_expenses_select on public.erp_expenses;
  drop policy if exists erp_expenses_write on public.erp_expenses;

  create policy erp_expense_categories_select
    on public.erp_expense_categories
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

  create policy erp_expense_categories_write
    on public.erp_expense_categories
    for all
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_expenses_select
    on public.erp_expenses
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

  create policy erp_expenses_write
    on public.erp_expenses
    for all
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );
end;
$$;

with seed_categories as (
  select * from (
    values
      ('amazon_commission', 'Amazon Commission', 'marketplace_fees'),
      ('amazon_fba_fees', 'Amazon FBA Fees', 'marketplace_fees'),
      ('amazon_shipping_fees', 'Amazon Shipping Fees', 'marketplace_fees'),
      ('myntra_commission', 'Myntra Commission', 'marketplace_fees'),
      ('flipkart_fees', 'Flipkart Fees', 'marketplace_fees'),
      ('snapdeal_fees', 'Snapdeal Fees', 'marketplace_fees'),
      ('meta_ads', 'Meta Ads', 'marketing'),
      ('marketplace_ads', 'Marketplace Ads', 'marketing'),
      ('influencer_barter_notional', 'Influencer Barter (Notional)', 'marketing'),
      ('inward_logistics', 'Inward Logistics', 'logistics'),
      ('outward_logistics_to_fba', 'Outward Logistics to FBA', 'logistics'),
      ('packing_material', 'Packing Material', 'overheads'),
      ('warehouse_rent', 'Warehouse Rent', 'overheads'),
      ('utilities', 'Utilities', 'overheads'),
      ('office_expenses', 'Office Expenses', 'overheads'),
      ('travel', 'Travel', 'overheads'),
      ('emi_interest', 'EMI Interest', 'overheads'),
      ('ca_fees', 'CA Fees', 'professional'),
      ('legal_fees', 'Legal Fees', 'professional'),
      ('salaries_wages', 'Salaries & Wages', 'payroll')
  ) as sc(code, name, group_key)
)
insert into public.erp_expense_categories (company_id, code, name, group_key, is_active)
select c.id, sc.code, sc.name, sc.group_key, true
from public.erp_companies c
cross join seed_categories sc
on conflict (company_id, code) do nothing;

create or replace function public.erp_expense_categories_list()
returns table (
  id uuid,
  code text,
  name text,
  group_key text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    c.id,
    c.code,
    c.name,
    c.group_key,
    c.is_active
  from public.erp_expense_categories c
  where c.company_id = public.erp_current_company_id()
  order by c.group_key, c.name;
end;
$$;

revoke all on function public.erp_expense_categories_list() from public;
grant execute on function public.erp_expense_categories_list() to authenticated;

create or replace function public.erp_expense_upsert(
  p_id uuid default null,
  p_expense_date date,
  p_amount numeric,
  p_currency text,
  p_category_id uuid,
  p_channel_id uuid,
  p_warehouse_id uuid,
  p_vendor_id uuid,
  p_payee_name text,
  p_reference text,
  p_description text,
  p_is_recurring boolean,
  p_recurring_rule text,
  p_attachment_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be >= 0';
  end if;

  if not exists (
    select 1
    from public.erp_expense_categories c
    where c.id = p_category_id
      and c.company_id = v_company_id
  ) then
    raise exception 'Invalid category';
  end if;

  if p_channel_id is not null and not exists (
    select 1
    from public.erp_sales_channels ch
    where ch.id = p_channel_id
      and ch.company_id = v_company_id
  ) then
    raise exception 'Invalid channel';
  end if;

  if p_warehouse_id is not null and not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Invalid warehouse';
  end if;

  if p_vendor_id is not null and not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = v_company_id
  ) then
    raise exception 'Invalid vendor';
  end if;

  if p_id is null then
    insert into public.erp_expenses (
      company_id,
      expense_date,
      amount,
      currency,
      category_id,
      channel_id,
      warehouse_id,
      vendor_id,
      payee_name,
      reference,
      description,
      is_recurring,
      recurring_rule,
      attachment_url,
      created_by,
      updated_at
    )
    values (
      v_company_id,
      p_expense_date,
      p_amount,
      coalesce(nullif(p_currency, ''), 'INR'),
      p_category_id,
      p_channel_id,
      p_warehouse_id,
      p_vendor_id,
      nullif(p_payee_name, ''),
      nullif(p_reference, ''),
      nullif(p_description, ''),
      coalesce(p_is_recurring, false),
      nullif(p_recurring_rule, ''),
      nullif(p_attachment_url, ''),
      auth.uid(),
      now()
    )
    returning id into v_id;
  else
    update public.erp_expenses
    set
      expense_date = p_expense_date,
      amount = p_amount,
      currency = coalesce(nullif(p_currency, ''), 'INR'),
      category_id = p_category_id,
      channel_id = p_channel_id,
      warehouse_id = p_warehouse_id,
      vendor_id = p_vendor_id,
      payee_name = nullif(p_payee_name, ''),
      reference = nullif(p_reference, ''),
      description = nullif(p_description, ''),
      is_recurring = coalesce(p_is_recurring, false),
      recurring_rule = nullif(p_recurring_rule, ''),
      attachment_url = nullif(p_attachment_url, ''),
      updated_at = now()
    where id = p_id
      and company_id = v_company_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Expense not found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_expense_upsert(
  uuid,
  date,
  numeric,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text
) from public;
grant execute on function public.erp_expense_upsert(
  uuid,
  date,
  numeric,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text
) to authenticated;

create or replace function public.erp_expenses_list(
  p_from date,
  p_to date,
  p_category_id uuid default null,
  p_channel_id uuid default null,
  p_warehouse_id uuid default null,
  p_search text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  expense_date date,
  amount numeric,
  currency text,
  category_id uuid,
  category_name text,
  category_group text,
  channel_id uuid,
  channel_name text,
  warehouse_id uuid,
  warehouse_name text,
  vendor_id uuid,
  vendor_name text,
  payee_name text,
  reference text,
  description text,
  is_recurring boolean,
  recurring_rule text,
  attachment_url text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    e.id,
    e.expense_date,
    e.amount,
    e.currency,
    e.category_id,
    c.name as category_name,
    c.group_key as category_group,
    e.channel_id,
    ch.name as channel_name,
    e.warehouse_id,
    w.name as warehouse_name,
    e.vendor_id,
    v.legal_name as vendor_name,
    e.payee_name,
    e.reference,
    e.description,
    e.is_recurring,
    e.recurring_rule,
    e.attachment_url,
    e.created_at,
    e.updated_at
  from public.erp_expenses e
  join public.erp_expense_categories c
    on c.id = e.category_id
  left join public.erp_sales_channels ch
    on ch.id = e.channel_id
  left join public.erp_warehouses w
    on w.id = e.warehouse_id
  left join public.erp_vendors v
    on v.id = e.vendor_id
  where e.company_id = public.erp_current_company_id()
    and e.expense_date >= p_from
    and e.expense_date <= p_to
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_channel_id is null or e.channel_id = p_channel_id)
    and (p_warehouse_id is null or e.warehouse_id = p_warehouse_id)
    and (
      p_search is null
      or p_search = ''
      or e.reference ilike '%' || p_search || '%'
      or e.description ilike '%' || p_search || '%'
      or e.payee_name ilike '%' || p_search || '%'
      or v.legal_name ilike '%' || p_search || '%'
    )
  order by e.expense_date desc, e.created_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.erp_expenses_list(
  date,
  date,
  uuid,
  uuid,
  uuid,
  text,
  int,
  int
) from public;
grant execute on function public.erp_expenses_list(
  date,
  date,
  uuid,
  uuid,
  uuid,
  text,
  int,
  int
) to authenticated;

create or replace function public.erp_expenses_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_writer();

  delete from public.erp_expenses
  where id = p_id
    and company_id = public.erp_current_company_id();

  if not found then
    raise exception 'Expense not found';
  end if;
end;
$$;

revoke all on function public.erp_expenses_delete(uuid) from public;
grant execute on function public.erp_expenses_delete(uuid) to authenticated;

create or replace function public.erp_expense_monthly_summary(
  p_from date,
  p_to date
)
returns table (
  month text,
  category_group text,
  category_name text,
  amount numeric(14,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    to_char(date_trunc('month', e.expense_date), 'YYYY-MM') as month,
    c.group_key as category_group,
    c.name as category_name,
    round(sum(e.amount)::numeric, 2) as amount
  from public.erp_expenses e
  join public.erp_expense_categories c
    on c.id = e.category_id
  where e.company_id = public.erp_current_company_id()
    and e.expense_date >= p_from
    and e.expense_date <= p_to
  group by date_trunc('month', e.expense_date), c.group_key, c.name
  order by date_trunc('month', e.expense_date), c.group_key, c.name;
end;
$$;

revoke all on function public.erp_expense_monthly_summary(date, date) from public;
grant execute on function public.erp_expense_monthly_summary(date, date) to authenticated;

create or replace function public.erp_expense_monthly_by_channel(
  p_from date,
  p_to date
)
returns table (
  month text,
  channel_name text,
  amount numeric(14,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    to_char(date_trunc('month', e.expense_date), 'YYYY-MM') as month,
    coalesce(ch.name, 'Unassigned') as channel_name,
    round(sum(e.amount)::numeric, 2) as amount
  from public.erp_expenses e
  left join public.erp_sales_channels ch
    on ch.id = e.channel_id
  where e.company_id = public.erp_current_company_id()
    and e.expense_date >= p_from
    and e.expense_date <= p_to
  group by date_trunc('month', e.expense_date), ch.name
  order by date_trunc('month', e.expense_date), channel_name;
end;
$$;

revoke all on function public.erp_expense_monthly_by_channel(date, date) from public;
grant execute on function public.erp_expense_monthly_by_channel(date, date) to authenticated;

create or replace function public.erp_expense_monthly_by_warehouse(
  p_from date,
  p_to date
)
returns table (
  month text,
  warehouse_name text,
  amount numeric(14,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    to_char(date_trunc('month', e.expense_date), 'YYYY-MM') as month,
    coalesce(w.name, 'Unassigned') as warehouse_name,
    round(sum(e.amount)::numeric, 2) as amount
  from public.erp_expenses e
  left join public.erp_warehouses w
    on w.id = e.warehouse_id
  where e.company_id = public.erp_current_company_id()
    and e.expense_date >= p_from
    and e.expense_date <= p_to
  group by date_trunc('month', e.expense_date), w.name
  order by date_trunc('month', e.expense_date), warehouse_name;
end;
$$;

revoke all on function public.erp_expense_monthly_by_warehouse(date, date) from public;
grant execute on function public.erp_expense_monthly_by_warehouse(date, date) to authenticated;

create or replace function public.erp_expenses_import_csv(
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
  v_result jsonb;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  if p_validate_only then
    with raw_rows as (
      select
        (row->>'expense_date') as expense_date_raw,
        (row->>'amount') as amount_raw,
        (row->>'currency') as currency_raw,
        (row->>'category_code') as category_code,
        nullif(row->>'channel_code', '') as channel_code,
        nullif(row->>'warehouse_code', '') as warehouse_code,
        nullif(row->>'vendor_name', '') as vendor_name,
        nullif(row->>'payee_name', '') as payee_name,
        nullif(row->>'reference', '') as reference,
        nullif(row->>'description', '') as description,
        nullif(row->>'attachment_url', '') as attachment_url,
        ordinality as row_index
      from jsonb_array_elements(p_rows) with ordinality as row
    ),
    normalized as (
      select
        row_index,
        expense_date_raw,
        amount_raw,
        currency_raw,
        category_code,
        channel_code,
        warehouse_code,
        vendor_name,
        payee_name,
        reference,
        description,
        attachment_url,
        case
          when expense_date_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then expense_date_raw::date
          else null
        end as expense_date,
        case
          when regexp_replace(coalesce(amount_raw, ''), ',', '', 'g') ~ '^[0-9]+(\\.[0-9]+)?$'
            then regexp_replace(coalesce(amount_raw, ''), ',', '', 'g')::numeric
          else null
        end as amount,
        coalesce(nullif(currency_raw, ''), 'INR') as currency
      from raw_rows
    ),
    resolved as (
      select
        n.*,
        c.id as category_id,
        ch.id as channel_id,
        w.id as warehouse_id,
        v.id as vendor_id,
        coalesce(n.payee_name, n.vendor_name) as final_payee_name,
        upper(
          coalesce(n.expense_date_raw, '') || '|' ||
          coalesce(regexp_replace(coalesce(n.amount_raw, ''), ',', '', 'g'), '') || '|' ||
          coalesce(n.category_code, '') || '|' ||
          coalesce(n.reference, n.vendor_name, n.payee_name, '')
        ) as duplicate_key
      from normalized n
      left join public.erp_expense_categories c
        on c.company_id = v_company_id and c.code = n.category_code
      left join public.erp_sales_channels ch
        on ch.company_id = v_company_id and ch.code = n.channel_code
      left join public.erp_warehouses w
        on w.company_id = v_company_id and w.code = n.warehouse_code
      left join public.erp_vendors v
        on v.company_id = v_company_id and v.legal_name = n.vendor_name
    ),
    with_dup_counts as (
      select r.*, count(*) over (partition by r.duplicate_key) as dup_count
      from resolved r
    ),
    validated as (
      select
        *,
        array_remove(array[
          case when expense_date is null then 'Invalid expense_date' end,
          case when amount is null then 'Invalid amount' end,
          case when amount is not null and amount < 0 then 'Amount must be >= 0' end,
          case when category_id is null then 'Unknown category_code' end,
          case when channel_code is not null and channel_id is null then 'Unknown channel_code' end,
          case when warehouse_code is not null and warehouse_id is null then 'Unknown warehouse_code' end,
          case when dup_count > 1 then 'Duplicate row in upload' end
        ], null) as errors
      from with_dup_counts
    ),
    results as (
      select
        row_index,
        (array_length(errors, 1) is null) as ok,
        errors
      from validated
      order by row_index
    )
    select jsonb_build_object(
      'ok', true,
      'inserted', 0,
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'row_index', row_index,
        'ok', ok,
        'errors', coalesce(errors, array[]::text[])
      )), '[]'::jsonb)
    )
    into v_result
    from results;
  else
    with raw_rows as (
      select
        (row->>'expense_date') as expense_date_raw,
        (row->>'amount') as amount_raw,
        (row->>'currency') as currency_raw,
        (row->>'category_code') as category_code,
        nullif(row->>'channel_code', '') as channel_code,
        nullif(row->>'warehouse_code', '') as warehouse_code,
        nullif(row->>'vendor_name', '') as vendor_name,
        nullif(row->>'payee_name', '') as payee_name,
        nullif(row->>'reference', '') as reference,
        nullif(row->>'description', '') as description,
        nullif(row->>'attachment_url', '') as attachment_url,
        ordinality as row_index
      from jsonb_array_elements(p_rows) with ordinality as row
    ),
    normalized as (
      select
        row_index,
        expense_date_raw,
        amount_raw,
        currency_raw,
        category_code,
        channel_code,
        warehouse_code,
        vendor_name,
        payee_name,
        reference,
        description,
        attachment_url,
        case
          when expense_date_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then expense_date_raw::date
          else null
        end as expense_date,
        case
          when regexp_replace(coalesce(amount_raw, ''), ',', '', 'g') ~ '^[0-9]+(\\.[0-9]+)?$'
            then regexp_replace(coalesce(amount_raw, ''), ',', '', 'g')::numeric
          else null
        end as amount,
        coalesce(nullif(currency_raw, ''), 'INR') as currency
      from raw_rows
    ),
    resolved as (
      select
        n.*,
        c.id as category_id,
        ch.id as channel_id,
        w.id as warehouse_id,
        v.id as vendor_id,
        coalesce(n.payee_name, n.vendor_name) as final_payee_name,
        upper(
          coalesce(n.expense_date_raw, '') || '|' ||
          coalesce(regexp_replace(coalesce(n.amount_raw, ''), ',', '', 'g'), '') || '|' ||
          coalesce(n.category_code, '') || '|' ||
          coalesce(n.reference, n.vendor_name, n.payee_name, '')
        ) as duplicate_key
      from normalized n
      left join public.erp_expense_categories c
        on c.company_id = v_company_id and c.code = n.category_code
      left join public.erp_sales_channels ch
        on ch.company_id = v_company_id and ch.code = n.channel_code
      left join public.erp_warehouses w
        on w.company_id = v_company_id and w.code = n.warehouse_code
      left join public.erp_vendors v
        on v.company_id = v_company_id and v.legal_name = n.vendor_name
    ),
    with_dup_counts as (
      select r.*, count(*) over (partition by r.duplicate_key) as dup_count
      from resolved r
    ),
    validated as (
      select
        *,
        array_remove(array[
          case when expense_date is null then 'Invalid expense_date' end,
          case when amount is null then 'Invalid amount' end,
          case when amount is not null and amount < 0 then 'Amount must be >= 0' end,
          case when category_id is null then 'Unknown category_code' end,
          case when channel_code is not null and channel_id is null then 'Unknown channel_code' end,
          case when warehouse_code is not null and warehouse_id is null then 'Unknown warehouse_code' end,
          case when dup_count > 1 then 'Duplicate row in upload' end
        ], null) as errors
      from with_dup_counts
    ),
    to_insert as (
      select
        row_index,
        expense_date,
        amount,
        currency,
        category_id,
        channel_id,
        warehouse_id,
        vendor_id,
        final_payee_name as payee_name,
        reference,
        description,
        attachment_url,
        errors
      from validated
      where array_length(errors, 1) is null
    ),
    inserted as (
      insert into public.erp_expenses (
        company_id,
        expense_date,
        amount,
        currency,
        category_id,
        channel_id,
        warehouse_id,
        vendor_id,
        payee_name,
        reference,
        description,
        attachment_url,
        created_by,
        updated_at
      )
      select
        v_company_id,
        expense_date,
        amount,
        currency,
        category_id,
        channel_id,
        warehouse_id,
        vendor_id,
        payee_name,
        reference,
        description,
        attachment_url,
        auth.uid(),
        now()
      from to_insert
      returning id, row_index
    ),
    results as (
      select
        v.row_index,
        (array_length(v.errors, 1) is null) as ok,
        v.errors,
        i.id as expense_id
      from validated v
      left join inserted i on i.row_index = v.row_index
      order by v.row_index
    )
    select jsonb_build_object(
      'ok', true,
      'inserted', (select count(*) from inserted),
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'row_index', row_index,
        'ok', ok,
        'errors', coalesce(errors, array[]::text[]),
        'expense_id', expense_id
      )), '[]'::jsonb)
    )
    into v_result
    from results;
  end if;

  return v_result;
end;
$$;

revoke all on function public.erp_expenses_import_csv(jsonb, boolean) from public;
grant execute on function public.erp_expenses_import_csv(jsonb, boolean) to authenticated;
