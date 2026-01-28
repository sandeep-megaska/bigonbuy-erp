-- 0274_amazon_analytics_v1.sql
-- Amazon analytics fact tables + RPCs

create or replace function public.erp_require_analytics_reader()
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

revoke all on function public.erp_require_analytics_reader() from public;
grant execute on function public.erp_require_analytics_reader() to authenticated;

create or replace function public.erp_require_analytics_writer()
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

revoke all on function public.erp_require_analytics_writer() from public;
grant execute on function public.erp_require_analytics_writer() to authenticated;

create unique index if not exists erp_channel_report_runs_unique_report_id_idx
  on public.erp_channel_report_runs (company_id, channel_key, marketplace_id, report_type, report_id)
  where report_id is not null;

create table if not exists public.erp_amazon_order_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  marketplace_id text not null,
  amazon_order_id text not null,
  order_item_id text null,
  purchase_date timestamptz not null,
  order_status text null,
  fulfillment_channel text null,
  sales_channel text null,
  buyer_email text null,
  buyer_name text null,
  ship_state text null,
  ship_city text null,
  ship_postal_code text null,
  asin text null,
  external_sku text null,
  fnsku text null,
  quantity int not null default 0,
  item_amount numeric not null default 0,
  item_tax numeric not null default 0,
  shipping_amount numeric not null default 0,
  shipping_tax numeric not null default 0,
  gift_wrap_amount numeric not null default 0,
  promo_discount numeric not null default 0,
  currency text null,
  mapped_variant_id uuid null references public.erp_variants (id) on delete restrict,
  erp_sku text null,
  style_code text null,
  size text null,
  color text null,
  source_run_id uuid null references public.erp_channel_report_runs (id),
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

alter table public.erp_amazon_order_facts
  add constraint erp_amazon_order_facts_unique_order_item
  unique (company_id, marketplace_id, amazon_order_id, order_item_id);

create unique index if not exists erp_amazon_order_facts_unique_order_item_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, amazon_order_id, coalesce(order_item_id, ''));

create index if not exists erp_amazon_order_facts_company_marketplace_purchase_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, purchase_date desc);

create index if not exists erp_amazon_order_facts_company_marketplace_variant_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, mapped_variant_id);

create index if not exists erp_amazon_order_facts_company_marketplace_ship_state_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, ship_state);

create index if not exists erp_amazon_order_facts_company_marketplace_ship_city_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, ship_city);

create index if not exists erp_amazon_order_facts_company_marketplace_buyer_email_idx
  on public.erp_amazon_order_facts (company_id, marketplace_id, buyer_email);

drop trigger if exists erp_amazon_order_facts_set_updated on public.erp_amazon_order_facts;
create trigger erp_amazon_order_facts_set_updated
before update on public.erp_amazon_order_facts
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_amazon_order_facts enable row level security;
alter table public.erp_amazon_order_facts force row level security;

create table if not exists public.erp_amazon_return_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  marketplace_id text not null,
  amazon_order_id text null,
  order_item_id text null,
  return_date timestamptz null,
  refund_date timestamptz null,
  asin text null,
  external_sku text null,
  quantity int null,
  refund_amount numeric null,
  currency text null,
  reason text null,
  status text null,
  mapped_variant_id uuid null references public.erp_variants (id) on delete restrict,
  erp_sku text null,
  source_run_id uuid null references public.erp_channel_report_runs (id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

create index if not exists erp_amazon_return_facts_company_marketplace_date_idx
  on public.erp_amazon_return_facts (company_id, marketplace_id, coalesce(return_date, refund_date) desc);

create index if not exists erp_amazon_return_facts_company_marketplace_variant_idx
  on public.erp_amazon_return_facts (company_id, marketplace_id, mapped_variant_id);

drop trigger if exists erp_amazon_return_facts_set_updated on public.erp_amazon_return_facts;
create trigger erp_amazon_return_facts_set_updated
before update on public.erp_amazon_return_facts
for each row
execute function public.erp_set_updated_cols();

alter table public.erp_amazon_return_facts enable row level security;
alter table public.erp_amazon_return_facts force row level security;

do $$
begin
  drop policy if exists erp_amazon_order_facts_select on public.erp_amazon_order_facts;
  drop policy if exists erp_amazon_order_facts_write on public.erp_amazon_order_facts;
  drop policy if exists erp_amazon_return_facts_select on public.erp_amazon_return_facts;
  drop policy if exists erp_amazon_return_facts_write on public.erp_amazon_return_facts;

  create policy erp_amazon_order_facts_select
    on public.erp_amazon_order_facts
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

  create policy erp_amazon_order_facts_write
    on public.erp_amazon_order_facts
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

  create policy erp_amazon_return_facts_select
    on public.erp_amazon_return_facts
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

  create policy erp_amazon_return_facts_write
    on public.erp_amazon_return_facts
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

-- Replace analytics RPCs with expanded signatures

drop function if exists public.erp_amazon_analytics_sales_by_sku(text, date, date, text);

drop function if exists public.erp_amazon_analytics_sales_by_geo(text, date, date, text);

drop function if exists public.erp_amazon_analytics_customer_cohorts(text, date, date, text);

create or replace function public.erp_amazon_analytics_sales_by_sku(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_grain text default 'day',
  p_limit int default 500,
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
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_from date := p_from;
  v_to date := p_to;
  v_trunc text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('day', 'week') then
    raise exception 'grain must be day or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'day' end;

  perform public.erp_require_analytics_reader();

  return query
  select
    date_trunc(v_trunc, f.purchase_date)::date as grain_start,
    f.mapped_variant_id,
    max(f.erp_sku) as erp_sku,
    max(f.style_code) as style_code,
    max(f.size) as size,
    max(f.color) as color,
    sum(coalesce(f.quantity, 0))::int as units,
    sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross,
    sum(coalesce(f.item_tax, 0) + coalesce(f.shipping_tax, 0)) as tax,
    sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0) - coalesce(f.item_tax, 0) - coalesce(f.shipping_tax, 0)) as net
  from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
    and f.marketplace_id = v_marketplace_id
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to
  group by date_trunc(v_trunc, f.purchase_date)::date, f.mapped_variant_id
  order by grain_start desc, gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_sku(text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sales_by_sku(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_amazon_analytics_sales_by_geo(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_level text default 'state',
  p_limit int default 200,
  p_offset int default 0
) returns table (
  geo_key text,
  state text,
  city text,
  orders int,
  customers int,
  units int,
  gross numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_level text := lower(coalesce(p_level, 'state'));
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_level not in ('state', 'city') then
    raise exception 'level must be state or city';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    case
      when v_level = 'city' then coalesce(f.ship_state, 'Unknown') || '|' || coalesce(f.ship_city, 'Unknown')
      else coalesce(f.ship_state, 'Unknown')
    end as geo_key,
    coalesce(f.ship_state, 'Unknown') as state,
    case when v_level = 'city' then coalesce(f.ship_city, 'Unknown') else null end as city,
    count(distinct f.amazon_order_id)::int as orders,
    count(distinct case when coalesce(trim(f.buyer_email), '') <> ''
      then lower(trim(f.buyer_email)) else f.amazon_order_id end)::int as customers,
    sum(coalesce(f.quantity, 0))::int as units,
    sum(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
  from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
    and f.marketplace_id = v_marketplace_id
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to
  group by geo_key, state, city
  order by gross desc nulls last
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_sales_by_geo(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_amazon_analytics_customer_cohorts(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_cohort_grain text default 'month'
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
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_cohort_grain, 'month'));
  v_trunc text;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
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
      lower(trim(f.buyer_email)) as customer_key,
      min(f.purchase_date)::date as first_purchase_date
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.buyer_email is not null
      and trim(f.buyer_email) <> ''
    group by lower(trim(f.buyer_email))
  ),
  scoped as (
    select
      f.amazon_order_id,
      lower(trim(f.buyer_email)) as customer_key,
      cf.first_purchase_date,
      date_trunc(v_trunc, cf.first_purchase_date)::date as cohort_start,
      case
        when v_trunc = 'week' then
          floor(
            extract(epoch from (date_trunc('week', f.purchase_date) - date_trunc('week', cf.first_purchase_date)))
            / (60 * 60 * 24 * 7)
          )::int
        else
          ((date_part('year', f.purchase_date) - date_part('year', cf.first_purchase_date)) * 12
            + (date_part('month', f.purchase_date) - date_part('month', cf.first_purchase_date)))::int
      end as period_index,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
    from public.erp_amazon_order_facts f
    join customer_first cf
      on lower(trim(f.buyer_email)) = cf.customer_key
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  )
  select
    s.cohort_start,
    s.period_index,
    count(distinct s.customer_key)::int as customers,
    count(distinct s.customer_key) filter (where s.period_index > 0)::int as repeat_customers,
    count(distinct s.amazon_order_id)::int as orders,
    sum(s.gross) as gross
  from scoped s
  group by s.cohort_start, s.period_index
  order by s.cohort_start, s.period_index;
end;
$$;

revoke all on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) to authenticated;

create or replace function public.erp_amazon_analytics_top_returns(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_limit int default 50
) returns table (
  mapped_variant_id uuid,
  erp_sku text,
  units_sold int,
  units_returned int,
  return_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  with returns as (
    select
      rf.mapped_variant_id,
      max(rf.erp_sku) as erp_sku,
      sum(coalesce(rf.quantity, 0))::int as units_returned
    from public.erp_amazon_return_facts rf
    where rf.company_id = v_company_id
      and rf.marketplace_id = v_marketplace_id
      and coalesce(rf.return_date, rf.refund_date)::date >= v_from
      and coalesce(rf.return_date, rf.refund_date)::date <= v_to
    group by rf.mapped_variant_id
  ),
  sales as (
    select
      f.mapped_variant_id,
      max(f.erp_sku) as erp_sku,
      sum(coalesce(f.quantity, 0))::int as units_sold
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
    group by f.mapped_variant_id
  )
  select
    r.mapped_variant_id,
    coalesce(r.erp_sku, s.erp_sku) as erp_sku,
    coalesce(s.units_sold, 0) as units_sold,
    r.units_returned,
    case when coalesce(s.units_sold, 0) = 0 then 0
      else round(r.units_returned::numeric / s.units_sold::numeric, 4)
    end as return_rate
  from returns r
  left join sales s on s.mapped_variant_id = r.mapped_variant_id
  order by r.units_returned desc nulls last
  limit greatest(p_limit, 1);
end;
$$;

revoke all on function public.erp_amazon_analytics_top_returns(text, date, date, int) from public;

grant execute on function public.erp_amazon_analytics_top_returns(text, date, date, int) to authenticated;
