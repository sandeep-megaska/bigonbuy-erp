-- 0289_shopify_analytics_v1.sql
-- Shopify analytics fact tables + RPCs

create table if not exists public.erp_shopify_order_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_account_id uuid not null references public.erp_channel_accounts (id) on delete cascade,
  order_id text not null,
  order_number text null,
  created_at date not null,
  currency text null,
  ship_state text null,
  ship_city text null,
  ship_zip text null,
  customer_key text null,
  gross_sales numeric not null default 0,
  discounts numeric not null default 0,
  net_sales_estimated numeric not null default 0,
  units int not null default 0,
  created_at_ts timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid()
);

create unique index if not exists erp_shopify_order_facts_unique_order_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, order_id);

create index if not exists erp_shopify_order_facts_company_channel_date_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, created_at desc);

create index if not exists erp_shopify_order_facts_company_channel_ship_state_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, ship_state);

create index if not exists erp_shopify_order_facts_company_channel_ship_city_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, ship_city);

create index if not exists erp_shopify_order_facts_company_channel_customer_idx
  on public.erp_shopify_order_facts (company_id, channel_account_id, customer_key);

create table if not exists public.erp_shopify_order_line_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_account_id uuid not null references public.erp_channel_accounts (id) on delete cascade,
  order_id text not null,
  line_id text not null,
  sku text null,
  qty int not null default 0,
  line_gross numeric not null default 0,
  line_discount numeric not null default 0,
  created_at date not null,
  created_at_ts timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid()
);

create unique index if not exists erp_shopify_order_line_facts_unique_line_idx
  on public.erp_shopify_order_line_facts (company_id, channel_account_id, order_id, line_id);

create index if not exists erp_shopify_order_line_facts_company_channel_date_idx
  on public.erp_shopify_order_line_facts (company_id, channel_account_id, created_at desc);

create index if not exists erp_shopify_order_line_facts_company_channel_sku_idx
  on public.erp_shopify_order_line_facts (company_id, channel_account_id, sku);

drop trigger if exists erp_shopify_order_facts_set_updated on public.erp_shopify_order_facts;
create trigger erp_shopify_order_facts_set_updated
before update on public.erp_shopify_order_facts
for each row
execute function public.erp_set_updated_cols();

drop trigger if exists erp_shopify_order_line_facts_set_updated on public.erp_shopify_order_line_facts;
create trigger erp_shopify_order_line_facts_set_updated
before update on public.erp_shopify_order_line_facts
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_shopify_order_facts enable row level security;
alter table public.erp_shopify_order_facts force row level security;

alter table public.erp_shopify_order_line_facts enable row level security;
alter table public.erp_shopify_order_line_facts force row level security;

do $$
begin
  drop policy if exists erp_shopify_order_facts_select on public.erp_shopify_order_facts;
  drop policy if exists erp_shopify_order_facts_write on public.erp_shopify_order_facts;
  drop policy if exists erp_shopify_order_line_facts_select on public.erp_shopify_order_line_facts;
  drop policy if exists erp_shopify_order_line_facts_write on public.erp_shopify_order_line_facts;

  create policy erp_shopify_order_facts_select
    on public.erp_shopify_order_facts
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_shopify_order_facts_write
    on public.erp_shopify_order_facts
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

  create policy erp_shopify_order_line_facts_select
    on public.erp_shopify_order_line_facts
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
            and cu.role_key in ('owner', 'admin', 'inventory', 'finance')
        )
      )
    );

  create policy erp_shopify_order_line_facts_write
    on public.erp_shopify_order_line_facts
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

create or replace function public.erp_shopify_analytics_overview_v1(
  p_from date,
  p_to date,
  p_channel_account_id uuid
) returns table (
  gross_sales numeric,
  confirmed_orders_count int,
  cancellations_count int,
  returns_count int,
  discounts numeric,
  net_sales_estimated numeric,
  avg_per_day numeric,
  days_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_account_id uuid := p_channel_account_id;
  v_from date := p_from;
  v_to date := p_to;
  v_days int := (p_to - p_from + 1);
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    sum(f.gross_sales) as gross_sales,
    count(distinct f.order_id)::int as confirmed_orders_count,
    0::int as cancellations_count,
    0::int as returns_count,
    sum(f.discounts) as discounts,
    sum(f.net_sales_estimated) as net_sales_estimated,
    case when v_days > 0 then round(sum(f.gross_sales)::numeric / v_days::numeric, 2) else null end as avg_per_day,
    greatest(v_days, 0)::int as days_count
  from public.erp_shopify_order_facts f
  where f.company_id = v_company_id
    and f.channel_account_id = v_channel_account_id
    and f.created_at >= v_from
    and f.created_at <= v_to;
end;
$$;

revoke all on function public.erp_shopify_analytics_overview_v1(date, date, uuid) from public;

grant execute on function public.erp_shopify_analytics_overview_v1(date, date, uuid) to authenticated;

create or replace function public.erp_shopify_analytics_sku_summary_v1(
  p_from date,
  p_to date,
  p_channel_account_id uuid,
  p_sort text default 'units_desc',
  p_q text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  mapped_variant_id uuid,
  erp_sku text,
  style_code text,
  size text,
  color text,
  orders int,
  customers int,
  units int,
  gross numeric,
  net numeric,
  asp numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_account_id uuid := p_channel_account_id;
  v_sort text := lower(coalesce(p_sort, 'units_desc'));
  v_query text := nullif(trim(p_q), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_sort not in ('units_desc', 'units_asc', 'net_desc', 'net_asc') then
    raise exception 'sort must be units_desc, units_asc, net_desc, net_asc';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with scoped as (
    select
      l.sku,
      f.order_id,
      f.customer_key,
      coalesce(l.qty, 0) as qty,
      coalesce(l.line_gross, 0) as line_gross,
      coalesce(l.line_discount, 0) as line_discount
    from public.erp_shopify_order_line_facts l
    join public.erp_shopify_order_facts f
      on f.company_id = l.company_id
      and f.channel_account_id = l.channel_account_id
      and f.order_id = l.order_id
    where f.company_id = v_company_id
      and f.channel_account_id = v_channel_account_id
      and f.created_at >= p_from
      and f.created_at <= p_to
      and (v_query is null or lower(coalesce(l.sku, '')) like '%' || lower(v_query) || '%')
  )
  select
    null::uuid as mapped_variant_id,
    scoped.sku as erp_sku,
    null::text as style_code,
    null::text as size,
    null::text as color,
    count(distinct scoped.order_id)::int as orders,
    count(distinct scoped.customer_key)::int as customers,
    sum(scoped.qty)::int as units,
    sum(scoped.line_gross) as gross,
    sum(scoped.line_gross - scoped.line_discount) as net,
    case when sum(scoped.qty) > 0
      then round(sum(scoped.line_gross - scoped.line_discount)::numeric / sum(scoped.qty)::numeric, 2)
      else null end as asp
  from scoped
  group by scoped.sku
  order by
    case when v_sort = 'units_desc' then sum(scoped.qty) end desc nulls last,
    case when v_sort = 'units_asc' then sum(scoped.qty) end asc nulls last,
    case when v_sort = 'net_desc' then sum(scoped.line_gross - scoped.line_discount) end desc nulls last,
    case when v_sort = 'net_asc' then sum(scoped.line_gross - scoped.line_discount) end asc nulls last,
    sum(scoped.line_gross - scoped.line_discount) desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_sku_summary_v1(date, date, uuid, text, text, int, int) from public;

grant execute on function public.erp_shopify_analytics_sku_summary_v1(date, date, uuid, text, text, int, int) to authenticated;

create or replace function public.erp_shopify_analytics_sales_by_sku_v1(
  p_from date,
  p_to date,
  p_channel_account_id uuid,
  p_grain text default 'day',
  p_limit int default 200,
  p_offset int default 0
) returns table (
  grain_start date,
  mapped_variant_id uuid,
  erp_sku text,
  style_code text,
  size text,
  color text,
  units int,
  gross numeric,
  tax numeric,
  net numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_account_id uuid := p_channel_account_id;
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_trunc text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('day', 'week') then
    raise exception 'grain must be day or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'day' end;

  perform public.erp_require_analytics_reader();

  return query
  select
    date_trunc(v_trunc, f.created_at)::date as grain_start,
    null::uuid as mapped_variant_id,
    l.sku as erp_sku,
    null::text as style_code,
    null::text as size,
    null::text as color,
    sum(coalesce(l.qty, 0))::int as units,
    sum(coalesce(l.line_gross, 0)) as gross,
    0::numeric as tax,
    sum(coalesce(l.line_gross, 0) - coalesce(l.line_discount, 0)) as net
  from public.erp_shopify_order_line_facts l
  join public.erp_shopify_order_facts f
    on f.company_id = l.company_id
    and f.channel_account_id = l.channel_account_id
    and f.order_id = l.order_id
  where f.company_id = v_company_id
    and f.channel_account_id = v_channel_account_id
    and f.created_at >= p_from
    and f.created_at <= p_to
  group by grain_start, l.sku
  order by grain_start, l.sku
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_sales_by_sku_v1(date, date, uuid, text, int, int) from public;

grant execute on function public.erp_shopify_analytics_sales_by_sku_v1(date, date, uuid, text, int, int) to authenticated;

create or replace function public.erp_shopify_analytics_sales_by_geo_v1(
  p_from date,
  p_to date,
  p_channel_account_id uuid,
  p_level text default 'state',
  p_state text default null,
  p_limit int default 200,
  p_offset int default 0
) returns table (
  geo_key text,
  state text,
  city text,
  orders int,
  customers int,
  units int,
  gross numeric,
  gross_share_within_state numeric,
  rank_within_state int,
  rank_overall int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_account_id uuid := p_channel_account_id;
  v_level text := lower(coalesce(p_level, 'state'));
  v_state text := nullif(trim(p_state), '');
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_level not in ('state', 'city') then
    raise exception 'level must be state or city';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with normalized as (
    select
      f.order_id,
      coalesce(nullif(upper(trim(f.ship_state)), ''), 'UNKNOWN') as state_key,
      coalesce(nullif(initcap(lower(trim(f.ship_city))), ''), 'Unknown') as norm_city,
      f.customer_key,
      coalesce(f.units, 0) as units,
      coalesce(f.gross_sales, 0) as gross
    from public.erp_shopify_order_facts f
    where f.company_id = v_company_id
      and f.channel_account_id = v_channel_account_id
      and f.created_at >= p_from
      and f.created_at <= p_to
  ),
  mapped as (
    select
      n.order_id,
      coalesce(m.canonical_state, n.state_key) as norm_state,
      n.norm_city,
      n.customer_key,
      n.units,
      n.gross
    from normalized n
    left join public.erp_geo_state_canonical_map m
      on m.state_key = n.state_key
      and m.is_active
  ),
  scoped as (
    select
      norm_state as state,
      case when v_level = 'city' then norm_city else null end as city,
      order_id,
      customer_key,
      units,
      gross
    from mapped
    where v_state is null or norm_state = v_state
  ),
  grouped as (
    select
      state,
      city,
      count(distinct order_id)::int as orders,
      count(distinct customer_key)::int as customers,
      sum(units)::int as units,
      sum(gross) as gross
    from scoped
    group by state, city
  )
  select
    case when v_level = 'city' then state || ' / ' || city else state end as geo_key,
    state,
    city,
    orders,
    customers,
    units,
    gross,
    case when v_level = 'city' then
      case when sum(gross) over (partition by state) = 0 then 0
        else round(gross / nullif(sum(gross) over (partition by state), 0), 4)
      end
    else null end as gross_share_within_state,
    case when v_level = 'city' then dense_rank() over (partition by state order by gross desc) else null end as rank_within_state,
    dense_rank() over (order by gross desc) as rank_overall
  from grouped
  order by gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_sales_by_geo_v1(date, date, uuid, text, text, int, int) from public;

grant execute on function public.erp_shopify_analytics_sales_by_geo_v1(date, date, uuid, text, text, int, int) to authenticated;

create or replace function public.erp_shopify_analytics_customers_v1(
  p_from date,
  p_to date,
  p_channel_account_id uuid,
  p_cohort_grain text default 'month',
  p_limit int default 500,
  p_offset int default 0
) returns table (
  cohort_start date,
  period_index int,
  customers int,
  repeat_customers int,
  orders int,
  gross numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_channel_account_id uuid := p_channel_account_id;
  v_grain text := lower(coalesce(p_cohort_grain, 'month'));
  v_trunc text;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_channel_account_id is null then
    raise exception 'channel_account_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('month', 'week') then
    raise exception 'cohort grain must be month or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'month' end;

  perform public.erp_require_analytics_reader();

  return query
  with customer_first as (
    select
      coalesce(nullif(trim(f.customer_key), ''), 'order:' || f.order_id) as customer_key,
      min(f.created_at)::date as first_purchase_date
    from public.erp_shopify_order_facts f
    where f.company_id = v_company_id
      and f.channel_account_id = v_channel_account_id
    group by 1
  ),
  scoped as (
    select
      f.order_id,
      coalesce(nullif(trim(f.customer_key), ''), 'order:' || f.order_id) as customer_key,
      cf.first_purchase_date,
      date_trunc(v_trunc, cf.first_purchase_date)::date as cohort_start,
      case
        when v_trunc = 'week' then
          floor(
            extract(epoch from (date_trunc('week', f.created_at) - date_trunc('week', cf.first_purchase_date)))
            / (60 * 60 * 24 * 7)
          )::int
        else
          ((date_part('year', f.created_at) - date_part('year', cf.first_purchase_date)) * 12
            + (date_part('month', f.created_at) - date_part('month', cf.first_purchase_date)))::int
      end as period_index,
      coalesce(f.gross_sales, 0) as gross
    from public.erp_shopify_order_facts f
    join customer_first cf
      on coalesce(nullif(trim(f.customer_key), ''), 'order:' || f.order_id) = cf.customer_key
    where f.company_id = v_company_id
      and f.channel_account_id = v_channel_account_id
      and f.created_at >= v_from
      and f.created_at <= v_to
  )
  select
    s.cohort_start,
    s.period_index,
    count(distinct s.customer_key)::int as customers,
    count(distinct s.customer_key) filter (where s.period_index > 0)::int as repeat_customers,
    count(distinct s.order_id)::int as orders,
    sum(s.gross) as gross
  from scoped s
  group by s.cohort_start, s.period_index
  order by s.cohort_start, s.period_index
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_shopify_analytics_customers_v1(date, date, uuid, text, int, int) from public;

grant execute on function public.erp_shopify_analytics_customers_v1(date, date, uuid, text, int, int) to authenticated;
