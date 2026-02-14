begin;

create table if not exists public.erp_mkt_budget_allocator_settings (
  company_id uuid primary key references public.erp_companies(id) on delete cascade,
  weekly_budget_inr numeric not null default 0,
  min_retargeting_share numeric not null default 0.20,
  max_prospecting_share numeric not null default 0.60,
  updated_at timestamptz not null default now()
);

alter table public.erp_mkt_budget_allocator_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_budget_allocator_settings'
      and policyname = 'erp_mkt_budget_allocator_settings_select'
  ) then
    create policy erp_mkt_budget_allocator_settings_select on public.erp_mkt_budget_allocator_settings
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

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'erp_mkt_budget_allocator_settings'
      and policyname = 'erp_mkt_budget_allocator_settings_write'
  ) then
    create policy erp_mkt_budget_allocator_settings_write on public.erp_mkt_budget_allocator_settings
      for all using (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      ) with check (
        company_id = public.erp_current_company_id()
        and auth.role() = 'service_role'
      );
  end if;
end;
$$;

create or replace view public.erp_mkt_budget_allocator_reco_v1 as
with current_company as (
  select public.erp_current_company_id() as company_id
),
settings as (
  select
    s.company_id,
    s.weekly_budget_inr,
    s.min_retargeting_share,
    s.max_prospecting_share
  from public.erp_mkt_budget_allocator_settings s
  join current_company c on c.company_id = s.company_id
),
latest_week as (
  select
    c.company_id,
    coalesce(
      (select max(week_start) from public.erp_mkt_sku_demand_scores where company_id = c.company_id),
      date_trunc('week', (now() at time zone 'utc')::date)::date
    ) as week_start
  from current_company c
),
scale_skus as (
  select
    a.company_id,
    a.week_start,
    a.sku,
    d.revenue_30d::numeric as revenue_30d,
    d.confidence_score::numeric as confidence_score,
    d.demand_score::numeric as demand_score
  from public.erp_mkt_activation_scale_skus_v1 a
  join public.erp_mkt_sku_demand_latest_v1 d
    on d.company_id = a.company_id
   and d.week_start = a.week_start
   and d.sku = a.sku
),
expand_cities as (
  select
    a.company_id,
    a.week_start,
    a.city,
    d.revenue_30d::numeric as revenue_30d,
    d.confidence_score::numeric as confidence_score,
    d.demand_score::numeric as demand_score
  from public.erp_mkt_activation_expand_cities_v1 a
  join public.erp_mkt_city_demand_latest_v1 d
    on d.company_id = a.company_id
   and d.week_start = a.week_start
   and d.city = a.city
),
inputs as (
  select
    lw.company_id,
    lw.week_start,
    coalesce(st.weekly_budget_inr, 0)::numeric as weekly_budget_inr,
    coalesce(st.min_retargeting_share, 0.20)::numeric as min_retargeting_share,
    coalesce(st.max_prospecting_share, 0.60)::numeric as max_prospecting_share,

    (select count(*) from scale_skus) as count_scale_skus,
    (select count(*) from expand_cities) as count_expand_cities,

    (select coalesce(sum(revenue_30d),0) from scale_skus) as total_scale_rev,
    (select coalesce(sum(revenue_30d),0) from expand_cities) as total_city_rev,

    (select coalesce(avg(confidence_score),0) from scale_skus) as avg_scale_conf,
    (select coalesce(avg(confidence_score),0) from expand_cities) as avg_city_conf
  from latest_week lw
  left join settings st on st.company_id = lw.company_id
),
weights as (
  select
    i.*,
    case
      when (i.total_scale_rev + i.total_city_rev) <= 0 then 0.5
      else i.total_scale_rev / nullif(i.total_scale_rev + i.total_city_rev, 0)
    end as norm_rev_scale,
    case
      when (i.total_scale_rev + i.total_city_rev) <= 0 then 0.5
      else i.total_city_rev / nullif(i.total_scale_rev + i.total_city_rev, 0)
    end as norm_rev_city
  from inputs i
),
scored as (
  select
    w.*,
    ((0.60 * w.norm_rev_scale) + (0.40 * w.avg_scale_conf))::numeric as w_scale,
    ((0.60 * w.norm_rev_city)  + (0.40 * w.avg_city_conf))::numeric as w_city
  from weights w
),
alloc as (
  select
    s.*,
    s.min_retargeting_share::numeric as retarget_share,
    (1 - s.min_retargeting_share)::numeric as remaining_share,
    case
      when (s.w_scale + s.w_city) = 0 then (1 - s.min_retargeting_share) * 0.5
      else (1 - s.min_retargeting_share) * (s.w_scale / nullif(s.w_scale + s.w_city, 0))
    end as scale_share_raw
  from scored s
),
clamped as (
  select
    a.*,
    greatest(0::numeric, least(a.remaining_share, a.scale_share_raw)) as scale_share,
    (a.remaining_share - greatest(0::numeric, least(a.remaining_share, a.scale_share_raw))) as prospecting_share_raw
  from alloc a
),
final as (
  select
    c.*,
    case
      when c.prospecting_share_raw > c.max_prospecting_share then c.max_prospecting_share
      else c.prospecting_share_raw
    end as prospecting_share,
    case
      when c.prospecting_share_raw > c.max_prospecting_share
        then c.scale_share + (c.prospecting_share_raw - c.max_prospecting_share)
      else c.scale_share
    end as scale_share_final
  from clamped c
)
select
  f.company_id,
  f.week_start,
  f.weekly_budget_inr,
  f.scale_share_final as scale_share,
  f.prospecting_share as prospecting_share,
  f.retarget_share as retarget_share,
  round(f.weekly_budget_inr * f.scale_share_final, 0) as scale_budget_inr,
  round(f.weekly_budget_inr * f.prospecting_share, 0) as prospecting_budget_inr,
  round(f.weekly_budget_inr * f.retarget_share, 0) as retarget_budget_inr,
  jsonb_build_object(
    'count_scale_skus', f.count_scale_skus,
    'count_expand_cities', f.count_expand_cities,
    'total_scale_rev', f.total_scale_rev,
    'total_expand_rev', f.total_city_rev,
    'avg_scale_conf', f.avg_scale_conf,
    'avg_city_conf', f.avg_city_conf
  ) as drivers
from final f;


grant select on public.erp_mkt_budget_allocator_reco_v1 to authenticated, service_role;
grant select, insert, update on public.erp_mkt_budget_allocator_settings to authenticated, service_role;

commit;
