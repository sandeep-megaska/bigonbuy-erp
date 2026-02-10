begin;

create table if not exists public.erp_mkt_audience_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id),
  code text not null,
  name text not null,
  description text null,
  audience_type text not null default 'customer',
  rule_json jsonb not null default '{}'::jsonb,
  is_system boolean not null default true,
  is_active boolean not null default true,
  refresh_freq text not null default 'daily',
  last_refreshed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mkt_audience_definitions_company_code_uniq unique (company_id, code)
);

create table if not exists public.erp_mkt_audience_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id),
  audience_id uuid not null references public.erp_mkt_audience_definitions(id),
  customer_key text not null,
  em_hash text null,
  ph_hash text null,
  member_since timestamptz not null default now(),
  member_rank integer null,
  member_score numeric null,
  meta jsonb not null default '{}'::jsonb,
  ended_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint erp_mkt_audience_members_company_audience_customer_uniq unique (company_id, audience_id, customer_key)
);

create unique index if not exists erp_mkt_audience_definitions_company_code_uniq
  on public.erp_mkt_audience_definitions (company_id, code);
create index if not exists erp_mkt_audience_members_company_audience_idx
  on public.erp_mkt_audience_members (company_id, audience_id);
create index if not exists erp_mkt_audience_members_company_customer_idx
  on public.erp_mkt_audience_members (company_id, customer_key);
create index if not exists erp_mkt_audience_members_company_audience_score_idx
  on public.erp_mkt_audience_members (company_id, audience_id, member_score desc);

alter table public.erp_mkt_audience_definitions enable row level security;
alter table public.erp_mkt_audience_members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_audience_definitions'
      and policyname = 'erp_mkt_audience_definitions_select'
  ) then
    create policy erp_mkt_audience_definitions_select on public.erp_mkt_audience_definitions
      for select using (company_id = public.erp_current_company_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_audience_members'
      and policyname = 'erp_mkt_audience_members_select'
  ) then
    create policy erp_mkt_audience_members_select on public.erp_mkt_audience_members
      for select using (company_id = public.erp_current_company_id());
  end if;
end;
$$;

insert into public.erp_mkt_audience_definitions (
  company_id,
  code,
  name,
  description,
  audience_type,
  rule_json,
  is_system,
  is_active,
  refresh_freq,
  updated_at
)
select
  c.id,
  v.code,
  v.name,
  v.description,
  'customer',
  v.rule_json,
  true,
  true,
  'daily',
  now()
from public.erp_companies c
cross join (
  values
    ('buyers_7d', 'Buyers (7D)', 'Customers who bought in the last 7 days', jsonb_build_object('source', 'erp_mkt_customer_scores', 'last_order_days', 7)),
    ('buyers_30d', 'Buyers (30D)', 'Customers who bought in the last 30 days', jsonb_build_object('source', 'erp_mkt_customer_scores', 'last_order_days', 30)),
    ('repeat_buyers', 'Repeat Buyers', 'Customers with 2+ orders', jsonb_build_object('source', 'erp_mkt_customer_scores', 'min_orders_count', 2)),
    ('top_ltv_10pct', 'Top LTV 10%', 'Top customers by lifetime value', jsonb_build_object('source', 'erp_mkt_customer_scores', 'selection', 'top_10pct_or_top_5_if_small')),
    ('winback_high_churn', 'Winback High Churn', 'High churn risk, inactive 30-180 days', jsonb_build_object('source', 'erp_mkt_customer_scores', 'churn_risk_gte', 0.6, 'days_since_last_order_between', jsonb_build_array(30, 180))),
    ('top_cities_20', 'Top Cities 20', 'Customers in top 20 cities by conversion index', jsonb_build_object('source', 'erp_mkt_city_scores', 'top_cities_limit', 20)),
    ('top_skus_20', 'Top SKUs 20', 'Customers preferring top 20 SKUs by velocity_30d', jsonb_build_object('source', 'erp_mkt_sku_scores', 'top_skus_limit', 20))
) as v(code, name, description, rule_json)
on conflict (company_id, code)
do update set
  name = excluded.name,
  description = excluded.description,
  rule_json = excluded.rule_json,
  is_system = true,
  is_active = true,
  refresh_freq = excluded.refresh_freq,
  updated_at = now();

create or replace function public.erp_mkt_audiences_refresh_v1(
  p_actor_user_id uuid,
  p_audience_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_target_code text := nullif(trim(p_audience_code), '');
  v_audience record;
  v_customer_count int := 0;
  v_target_count int := 0;
  v_upserted int := 0;
  v_result jsonb := '{}'::jsonb;
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
    raise exception 'Only owner/admin can refresh audiences';
  end if;

  create temporary table if not exists tmp_mkt_audience_members (
    customer_key text not null,
    em_hash text null,
    ph_hash text null,
    member_rank int null,
    member_score numeric null,
    meta jsonb not null default '{}'::jsonb
  ) on commit drop;

  for v_audience in
    select d.id, d.code
    from public.erp_mkt_audience_definitions d
    where d.company_id = v_company_id
      and d.is_active = true
      and (v_target_code is null or d.code = v_target_code)
    order by d.code
  loop
    truncate table tmp_mkt_audience_members;

    if v_audience.code = 'buyers_7d' then
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score)
      select s.customer_key, s.em_hash, s.ph_hash, s.ltv
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and s.last_order_at >= now() - interval '7 days';
    elsif v_audience.code = 'buyers_30d' then
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score)
      select s.customer_key, s.em_hash, s.ph_hash, s.ltv
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and s.last_order_at >= now() - interval '30 days';
    elsif v_audience.code = 'repeat_buyers' then
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score)
      select s.customer_key, s.em_hash, s.ph_hash, s.orders_count::numeric
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and coalesce(s.orders_count, 0) >= 2;
    elsif v_audience.code = 'top_ltv_10pct' then
      select count(*)::int
      into v_customer_count
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id;

      with ranked as (
        select
          s.customer_key,
          s.em_hash,
          s.ph_hash,
          s.ltv,
          row_number() over (order by s.ltv desc nulls last, s.customer_key asc) as rn,
          case
            when v_customer_count < 20 then least(5, v_customer_count)
            else greatest(1, ceil(v_customer_count * 0.10)::int)
          end as target_n
        from public.erp_mkt_customer_scores s
        where s.company_id = v_company_id
      )
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_rank, member_score)
      select customer_key, em_hash, ph_hash, rn, ltv
      from ranked
      where rn <= target_n;
    elsif v_audience.code = 'winback_high_churn' then
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score)
      select s.customer_key, s.em_hash, s.ph_hash, s.churn_risk
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and coalesce(s.churn_risk, 0) >= 0.6
        and coalesce(s.days_since_last_order, 0) between 30 and 180;
    elsif v_audience.code = 'top_cities_20' then
      with top_cities as (
        select c.city
        from public.erp_mkt_city_scores c
        where c.company_id = v_company_id
        order by c.conversion_index desc nulls last, c.city asc
        limit 20
      )
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score, meta)
      select s.customer_key, s.em_hash, s.ph_hash, s.ltv, jsonb_build_object('top_city', s.top_city)
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and s.top_city in (select city from top_cities);
    elsif v_audience.code = 'top_skus_20' then
      with top_skus as (
        select k.sku_code
        from public.erp_mkt_sku_scores k
        where k.company_id = v_company_id
        order by k.velocity_30d desc nulls last, k.sku_code asc
        limit 20
      )
      insert into tmp_mkt_audience_members (customer_key, em_hash, ph_hash, member_score, meta)
      select s.customer_key, s.em_hash, s.ph_hash, s.ltv, jsonb_build_object('preferred_sku', s.preferred_sku)
      from public.erp_mkt_customer_scores s
      where s.company_id = v_company_id
        and s.preferred_sku in (select sku_code from top_skus);
    end if;

    with ranked_members as (
      select
        t.customer_key,
        t.em_hash,
        t.ph_hash,
        coalesce(t.member_rank, row_number() over (order by t.member_score desc nulls last, t.customer_key asc)) as member_rank,
        t.member_score,
        t.meta
      from tmp_mkt_audience_members t
    )
    select count(*)::int into v_target_count from ranked_members;

    update public.erp_mkt_audience_members m
    set ended_at = now(),
        updated_at = now()
    where m.company_id = v_company_id
      and m.audience_id = v_audience.id
      and m.ended_at is null;

    with ranked_members as (
      select
        t.customer_key,
        t.em_hash,
        t.ph_hash,
        coalesce(t.member_rank, row_number() over (order by t.member_score desc nulls last, t.customer_key asc)) as member_rank,
        t.member_score,
        t.meta
      from tmp_mkt_audience_members t
    )
    insert into public.erp_mkt_audience_members (
      company_id,
      audience_id,
      customer_key,
      em_hash,
      ph_hash,
      member_rank,
      member_score,
      meta,
      ended_at,
      updated_at
    )
    select
      v_company_id,
      v_audience.id,
      r.customer_key,
      r.em_hash,
      r.ph_hash,
      r.member_rank,
      r.member_score,
      coalesce(r.meta, '{}'::jsonb),
      null,
      now()
    from ranked_members r
    on conflict (company_id, audience_id, customer_key)
    do update set
      em_hash = excluded.em_hash,
      ph_hash = excluded.ph_hash,
      member_rank = excluded.member_rank,
      member_score = excluded.member_score,
      meta = excluded.meta,
      ended_at = null,
      updated_at = now();

    get diagnostics v_upserted = row_count;

    update public.erp_mkt_audience_definitions d
    set last_refreshed_at = now(),
        updated_at = now()
    where d.id = v_audience.id;

    v_result := v_result || jsonb_build_object(
      v_audience.code,
      jsonb_build_object('eligible_count', v_target_count, 'upserted', v_upserted)
    );
  end loop;

  return jsonb_build_object(
    'company_id', v_company_id,
    'audiences', v_result
  );
end;
$$;

commit;
