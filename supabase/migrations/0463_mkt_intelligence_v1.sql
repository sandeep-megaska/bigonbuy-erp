begin;

create table if not exists public.erp_mkt_customer_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id),
  customer_id uuid null,
  customer_key text not null,
  em_hash text null,
  ph_hash text null,
  ltv numeric not null default 0,
  orders_count int not null default 0,
  aov numeric not null default 0,
  last_order_at timestamptz null,
  days_since_last_order int null,
  repeat_probability numeric not null default 0,
  churn_risk numeric not null default 0,
  preferred_sku text null,
  preferred_size text null,
  top_city text null,
  updated_at timestamptz not null default now(),
  constraint erp_mkt_customer_scores_company_customer_key_uniq unique (company_id, customer_key)
);

alter table public.erp_mkt_customer_scores add column if not exists customer_id uuid null;
alter table public.erp_mkt_customer_scores add column if not exists customer_key text;
alter table public.erp_mkt_customer_scores add column if not exists em_hash text null;
alter table public.erp_mkt_customer_scores add column if not exists ph_hash text null;
alter table public.erp_mkt_customer_scores add column if not exists ltv numeric not null default 0;
alter table public.erp_mkt_customer_scores add column if not exists orders_count int not null default 0;
alter table public.erp_mkt_customer_scores add column if not exists aov numeric not null default 0;
alter table public.erp_mkt_customer_scores add column if not exists last_order_at timestamptz null;
alter table public.erp_mkt_customer_scores add column if not exists days_since_last_order int null;
alter table public.erp_mkt_customer_scores add column if not exists repeat_probability numeric not null default 0;
alter table public.erp_mkt_customer_scores add column if not exists churn_risk numeric not null default 0;
alter table public.erp_mkt_customer_scores add column if not exists preferred_sku text null;
alter table public.erp_mkt_customer_scores add column if not exists preferred_size text null;
alter table public.erp_mkt_customer_scores add column if not exists top_city text null;
alter table public.erp_mkt_customer_scores add column if not exists updated_at timestamptz not null default now();

create unique index if not exists erp_mkt_customer_scores_company_customer_key_uniq
  on public.erp_mkt_customer_scores (company_id, customer_key);
create index if not exists erp_mkt_customer_scores_company_ltv_idx
  on public.erp_mkt_customer_scores (company_id, ltv desc);
create index if not exists erp_mkt_customer_scores_company_last_order_idx
  on public.erp_mkt_customer_scores (company_id, last_order_at desc);

create table if not exists public.erp_mkt_sku_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id),
  sku_id uuid null,
  sku_code text not null,
  orders_count int not null default 0,
  units_sold numeric not null default 0,
  revenue numeric not null default 0,
  gross_margin numeric not null default 0,
  contribution numeric not null default 0,
  velocity_30d numeric not null default 0,
  repeat_rate numeric not null default 0,
  inventory_on_hand numeric not null default 0,
  profitability_score numeric not null default 0,
  inventory_pressure_score numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint erp_mkt_sku_scores_company_sku_code_uniq unique (company_id, sku_code)
);

alter table public.erp_mkt_sku_scores add column if not exists sku_id uuid null;
alter table public.erp_mkt_sku_scores add column if not exists sku_code text;
alter table public.erp_mkt_sku_scores add column if not exists orders_count int not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists units_sold numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists revenue numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists gross_margin numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists contribution numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists velocity_30d numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists repeat_rate numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists inventory_on_hand numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists profitability_score numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists inventory_pressure_score numeric not null default 0;
alter table public.erp_mkt_sku_scores add column if not exists updated_at timestamptz not null default now();

create unique index if not exists erp_mkt_sku_scores_company_sku_code_uniq
  on public.erp_mkt_sku_scores (company_id, sku_code);
create index if not exists erp_mkt_sku_scores_company_profitability_idx
  on public.erp_mkt_sku_scores (company_id, profitability_score desc);
create index if not exists erp_mkt_sku_scores_company_velocity_idx
  on public.erp_mkt_sku_scores (company_id, velocity_30d desc);

create table if not exists public.erp_mkt_city_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id),
  city text not null,
  orders_count int not null default 0,
  revenue numeric not null default 0,
  aov numeric not null default 0,
  conversion_index numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint erp_mkt_city_scores_company_city_uniq unique (company_id, city)
);

alter table public.erp_mkt_city_scores add column if not exists city text;
alter table public.erp_mkt_city_scores add column if not exists orders_count int not null default 0;
alter table public.erp_mkt_city_scores add column if not exists revenue numeric not null default 0;
alter table public.erp_mkt_city_scores add column if not exists aov numeric not null default 0;
alter table public.erp_mkt_city_scores add column if not exists conversion_index numeric not null default 0;
alter table public.erp_mkt_city_scores add column if not exists updated_at timestamptz not null default now();

create unique index if not exists erp_mkt_city_scores_company_city_uniq
  on public.erp_mkt_city_scores (company_id, city);
create index if not exists erp_mkt_city_scores_company_revenue_idx
  on public.erp_mkt_city_scores (company_id, revenue desc);

alter table public.erp_mkt_customer_scores enable row level security;
alter table public.erp_mkt_customer_scores force row level security;
alter table public.erp_mkt_sku_scores enable row level security;
alter table public.erp_mkt_sku_scores force row level security;
alter table public.erp_mkt_city_scores enable row level security;
alter table public.erp_mkt_city_scores force row level security;

-- Policies: create only if missing (migration-guard friendly; no DROP)

do $$
begin
  -- erp_mkt_customer_scores_select
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_customer_scores'
      and policyname = 'erp_mkt_customer_scores_select'
  ) then
    create policy erp_mkt_customer_scores_select on public.erp_mkt_customer_scores
      for select using (
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
  end if;

  -- erp_mkt_customer_scores_write
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_customer_scores'
      and policyname = 'erp_mkt_customer_scores_write'
  ) then
    create policy erp_mkt_customer_scores_write on public.erp_mkt_customer_scores
      for all using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin')
          )
        )
      ) with check (company_id = public.erp_current_company_id());
  end if;

  -- erp_mkt_sku_scores_select
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_sku_scores'
      and policyname = 'erp_mkt_sku_scores_select'
  ) then
    create policy erp_mkt_sku_scores_select on public.erp_mkt_sku_scores
      for select using (
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
  end if;

  -- erp_mkt_sku_scores_write
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_sku_scores'
      and policyname = 'erp_mkt_sku_scores_write'
  ) then
    create policy erp_mkt_sku_scores_write on public.erp_mkt_sku_scores
      for all using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin')
          )
        )
      ) with check (company_id = public.erp_current_company_id());
  end if;

  -- erp_mkt_city_scores_select
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_city_scores'
      and policyname = 'erp_mkt_city_scores_select'
  ) then
    create policy erp_mkt_city_scores_select on public.erp_mkt_city_scores
      for select using (
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
  end if;

  -- erp_mkt_city_scores_write
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_city_scores'
      and policyname = 'erp_mkt_city_scores_write'
  ) then
    create policy erp_mkt_city_scores_write on public.erp_mkt_city_scores
      for all using (
        company_id = public.erp_current_company_id()
        and (
          auth.role() = 'service_role'
          or exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin')
          )
        )
      ) with check (company_id = public.erp_current_company_id());
  end if;
end;
$$;

create or replace function public.erp_mkt_intelligence_refresh_v1(
  p_actor_user_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_from date := coalesce(p_from, (current_date - 180));
  v_to date := coalesce(p_to, current_date);
  v_customers_upserted int := 0;
  v_skus_upserted int := 0;
  v_cities_upserted int := 0;
begin
  if v_company_id is null then
    raise exception 'Company context is required';
  end if;

  if p_actor_user_id is null then
    raise exception 'actor user id is required';
  end if;

  if auth.role() <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception 'Actor mismatch';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = p_actor_user_id
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Only owner/admin can refresh marketing intelligence';
  end if;

  with sales_line_facts as (
    select
      o.company_id,
      concat('shopify:', o.shopify_order_id::text) as order_ref,
      o.order_created_at as order_at,
      lower(nullif(trim(o.customer_email), '')) as customer_key,
      public.erp_mkt_hash_field(lower(nullif(trim(o.customer_email), ''))) as em_hash,
      public.erp_mkt_hash_field(public.erp_mkt_normalize_phone(
        coalesce(
          nullif(o.raw_order#>>'{phone}', ''),
          nullif(o.raw_order#>>'{customer,phone}', ''),
          nullif(o.raw_order#>>'{shipping_address,phone}', '')
        )
      )) as ph_hash,
      coalesce(nullif(trim(l.sku), ''), nullif(trim(l.title), ''), 'unknown') as sku_code,
      nullif(trim(split_part(coalesce(l.title, ''), '/', 2)), '') as preferred_size,
      nullif(trim(o.raw_order#>>'{shipping_address,city}'), '') as city,
      greatest(coalesce(l.quantity, 0), 0)::numeric as quantity,
      greatest((coalesce(l.price, 0) * coalesce(l.quantity, 0)) - coalesce(l.line_discount, 0), 0)::numeric as revenue
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_lines l
      on l.company_id = o.company_id
     and l.order_id = o.id
    where o.company_id = v_company_id
      and coalesce(o.is_cancelled, false) = false
      and o.order_created_at::date between v_from and v_to

    union all

    select
      f.company_id,
      concat('amazon:', f.marketplace_id, ':', f.amazon_order_id) as order_ref,
      f.purchase_date as order_at,
      lower(nullif(trim(f.buyer_email), '')) as customer_key,
      public.erp_mkt_hash_field(lower(nullif(trim(f.buyer_email), ''))) as em_hash,
      null::text as ph_hash,
      coalesce(nullif(trim(f.erp_sku), ''), nullif(trim(f.external_sku), ''), nullif(trim(f.asin), ''), 'unknown') as sku_code,
      nullif(trim(f.size), '') as preferred_size,
      nullif(trim(f.ship_city), '') as city,
      greatest(coalesce(f.quantity, 0), 0)::numeric as quantity,
      greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.purchase_date::date between v_from and v_to
  ),
  customers_base as (
    select
      company_id,
      customer_key,
      max(em_hash) as em_hash,
      max(ph_hash) as ph_hash,
      sum(revenue) as ltv,
      count(distinct order_ref)::int as orders_count,
      max(order_at) as last_order_at,
      max(city) filter (where city is not null) as any_city
    from sales_line_facts
    where customer_key is not null
    group by company_id, customer_key
  ),
  customer_pref_sku as (
    select company_id, customer_key, sku_code, preferred_size
    from (
      select
        company_id,
        customer_key,
        sku_code,
        preferred_size,
        row_number() over (
          partition by company_id, customer_key
          order by sum(quantity) desc, sku_code asc
        ) as rn
      from sales_line_facts
      where customer_key is not null
      group by company_id, customer_key, sku_code, preferred_size
    ) ranked
    where rn = 1
  ),
  customer_top_city as (
    select company_id, customer_key, city
    from (
      select
        company_id,
        customer_key,
        city,
        row_number() over (
          partition by company_id, customer_key
          order by count(distinct order_ref) desc, sum(revenue) desc, city asc
        ) as rn
      from sales_line_facts
      where customer_key is not null
        and city is not null
      group by company_id, customer_key, city
    ) ranked
    where rn = 1
  ),
  upserted as (
    insert into public.erp_mkt_customer_scores (
      company_id,
      customer_key,
      em_hash,
      ph_hash,
      ltv,
      orders_count,
      aov,
      last_order_at,
      days_since_last_order,
      repeat_probability,
      churn_risk,
      preferred_sku,
      preferred_size,
      top_city,
      updated_at
    )
    select
      b.company_id,
      b.customer_key,
      b.em_hash,
      b.ph_hash,
      coalesce(b.ltv, 0),
      coalesce(b.orders_count, 0),
      case when coalesce(b.orders_count, 0) > 0 then coalesce(b.ltv, 0) / b.orders_count else 0 end,
      b.last_order_at,
      case when b.last_order_at is null then null else greatest((current_date - b.last_order_at::date), 0)::int end,
      least(1, greatest(coalesce(b.orders_count, 0)::numeric / 5, 0)),
      case
        when b.last_order_at is null then 1
        else least(1, greatest((current_date - b.last_order_at::date)::numeric / 90, 0))
      end,
      ps.sku_code,
      ps.preferred_size,
      tc.city,
      now()
    from customers_base b
    left join customer_pref_sku ps
      on ps.company_id = b.company_id
     and ps.customer_key = b.customer_key
    left join customer_top_city tc
      on tc.company_id = b.company_id
     and tc.customer_key = b.customer_key
    on conflict (company_id, customer_key) do update
    set
      em_hash = excluded.em_hash,
      ph_hash = excluded.ph_hash,
      ltv = excluded.ltv,
      orders_count = excluded.orders_count,
      aov = excluded.aov,
      last_order_at = excluded.last_order_at,
      days_since_last_order = excluded.days_since_last_order,
      repeat_probability = excluded.repeat_probability,
      churn_risk = excluded.churn_risk,
      preferred_sku = excluded.preferred_sku,
      preferred_size = excluded.preferred_size,
      top_city = excluded.top_city,
      updated_at = now()
    returning 1
  )
  select count(*)::int into v_customers_upserted from upserted;

  with sales_line_facts as (
    select
      o.company_id,
      concat('shopify:', o.shopify_order_id::text) as order_ref,
      o.order_created_at as order_at,
      lower(nullif(trim(o.customer_email), '')) as customer_key,
      coalesce(nullif(trim(l.sku), ''), nullif(trim(l.title), ''), 'unknown') as sku_code,
      greatest(coalesce(l.quantity, 0), 0)::numeric as quantity,
      greatest((coalesce(l.price, 0) * coalesce(l.quantity, 0)) - coalesce(l.line_discount, 0), 0)::numeric as revenue
    from public.erp_shopify_orders o
    left join public.erp_shopify_order_lines l
      on l.company_id = o.company_id
     and l.order_id = o.id
    where o.company_id = v_company_id
      and coalesce(o.is_cancelled, false) = false
      and o.order_created_at::date between v_from and v_to

    union all

    select
      f.company_id,
      concat('amazon:', f.marketplace_id, ':', f.amazon_order_id) as order_ref,
      f.purchase_date as order_at,
      lower(nullif(trim(f.buyer_email), '')) as customer_key,
      coalesce(nullif(trim(f.erp_sku), ''), nullif(trim(f.external_sku), ''), nullif(trim(f.asin), ''), 'unknown') as sku_code,
      greatest(coalesce(f.quantity, 0), 0)::numeric as quantity,
      greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.purchase_date::date between v_from and v_to
  ),
  per_customer as (
    select
      company_id,
      sku_code,
      customer_key,
      count(distinct order_ref)::int as customer_orders
    from sales_line_facts
    where customer_key is not null
    group by company_id, sku_code, customer_key
  ),
  sku_base as (
    select
      f.company_id,
      f.sku_code,
      count(distinct f.order_ref)::int as orders_count,
      sum(f.quantity) as units_sold,
      sum(f.revenue) as revenue,
      sum(f.revenue) as contribution,
      sum(f.quantity) filter (where f.order_at::date >= (current_date - 30)) as velocity_30d,
      coalesce((
        count(*) filter (where pc.customer_orders > 1)::numeric
        / nullif(count(*)::numeric, 0)
      ), 0) as repeat_rate
    from sales_line_facts f
    left join per_customer pc
      on pc.company_id = f.company_id
     and pc.sku_code = f.sku_code
     and pc.customer_key = f.customer_key
    group by f.company_id, f.sku_code
  ),
  upserted as (
    insert into public.erp_mkt_sku_scores (
      company_id,
      sku_code,
      orders_count,
      units_sold,
      revenue,
      gross_margin,
      contribution,
      velocity_30d,
      repeat_rate,
      inventory_on_hand,
      profitability_score,
      inventory_pressure_score,
      updated_at
    )
    select
      b.company_id,
      b.sku_code,
      coalesce(b.orders_count, 0),
      coalesce(b.units_sold, 0),
      coalesce(b.revenue, 0),
      0,
      coalesce(b.contribution, 0),
      coalesce(b.velocity_30d, 0),
      coalesce(b.repeat_rate, 0),
      0,
      least(1, greatest(coalesce(b.revenue, 0) / 100000, 0)),
      0,
      now()
    from sku_base b
    on conflict (company_id, sku_code) do update
    set
      orders_count = excluded.orders_count,
      units_sold = excluded.units_sold,
      revenue = excluded.revenue,
      gross_margin = excluded.gross_margin,
      contribution = excluded.contribution,
      velocity_30d = excluded.velocity_30d,
      repeat_rate = excluded.repeat_rate,
      inventory_on_hand = excluded.inventory_on_hand,
      profitability_score = excluded.profitability_score,
      inventory_pressure_score = excluded.inventory_pressure_score,
      updated_at = now()
    returning 1
  )
  select count(*)::int into v_skus_upserted from upserted;

  with city_base as (
    select
      s.company_id,
      initcap(lower(trim(s.city))) as city,
      count(distinct s.order_ref)::int as orders_count,
      sum(s.revenue) as revenue
    from (
      select
        o.company_id,
        concat('shopify:', o.shopify_order_id::text) as order_ref,
        nullif(trim(o.raw_order#>>'{shipping_address,city}'), '') as city,
        coalesce(o.total_price, 0)::numeric as revenue
      from public.erp_shopify_orders o
      where o.company_id = v_company_id
        and coalesce(o.is_cancelled, false) = false
        and o.order_created_at::date between v_from and v_to

      union all

      select
        f.company_id,
        concat('amazon:', f.marketplace_id, ':', f.amazon_order_id) as order_ref,
        nullif(trim(f.ship_city), '') as city,
        greatest(coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.item_tax, 0) - coalesce(f.promo_discount, 0), 0)::numeric as revenue
      from public.erp_amazon_order_facts f
      where f.company_id = v_company_id
        and f.purchase_date::date between v_from and v_to
    ) s
    where s.city is not null
    group by s.company_id, initcap(lower(trim(s.city)))
  ),
  company_totals as (
    select company_id, sum(orders_count)::numeric as total_orders
    from city_base
    group by company_id
  ),
  upserted as (
    insert into public.erp_mkt_city_scores (
      company_id,
      city,
      orders_count,
      revenue,
      aov,
      conversion_index,
      updated_at
    )
    select
      b.company_id,
      b.city,
      coalesce(b.orders_count, 0),
      coalesce(b.revenue, 0),
      case when coalesce(b.orders_count, 0) > 0 then coalesce(b.revenue, 0) / b.orders_count else 0 end,
      coalesce((b.orders_count::numeric / nullif(t.total_orders, 0)) * 100, 0),
      now()
    from city_base b
    left join company_totals t
      on t.company_id = b.company_id
    on conflict (company_id, city) do update
    set
      orders_count = excluded.orders_count,
      revenue = excluded.revenue,
      aov = excluded.aov,
      conversion_index = excluded.conversion_index,
      updated_at = now()
    returning 1
  )
  select count(*)::int into v_cities_upserted from upserted;

  return jsonb_build_object(
    'customers_upserted', v_customers_upserted,
    'skus_upserted', v_skus_upserted,
    'cities_upserted', v_cities_upserted
  );
end;
$$;

revoke all on function public.erp_mkt_intelligence_refresh_v1(uuid, date, date) from public;
grant execute on function public.erp_mkt_intelligence_refresh_v1(uuid, date, date) to authenticated, service_role;

commit;
