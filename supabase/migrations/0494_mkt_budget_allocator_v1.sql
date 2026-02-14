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
    c.company_id,
    coalesce(s.weekly_budget_inr, 0)::numeric as weekly_budget_inr,
    coalesce(s.min_retargeting_share, 0.20)::numeric as min_retargeting_share,
    coalesce(s.max_prospecting_share, 0.60)::numeric as max_prospecting_share
  from current_company c
  left join public.erp_mkt_budget_allocator_settings s
    on s.company_id = c.company_id
),
week_ref as (
  select max(week_start) as week_start
  from (
    select s.week_start
    from public.erp_mkt_activation_scale_skus_v1 s
    where s.company_id = (select company_id from current_company)
    union all
    select c.week_start
    from public.erp_mkt_activation_expand_cities_v1 c
    where c.company_id = (select company_id from current_company)
  ) all_weeks
),
scale_stats as (
  select
    count(*)::int as count_scale_skus,
    coalesce(sum(s.revenue_30d), 0)::numeric as total_scale_rev,
    coalesce(avg(s.confidence_score), 0)::numeric as avg_scale_conf
  from public.erp_mkt_activation_scale_skus_v1 s
  where s.company_id = (select company_id from current_company)
    and s.week_start = (select week_start from week_ref)
),
city_stats as (
  select
    count(*)::int as count_expand_cities,
    coalesce(sum(cd.revenue_30d), 0)::numeric as total_expand_rev,
    coalesce(avg(c.confidence_score), 0)::numeric as avg_city_conf
  from public.erp_mkt_activation_expand_cities_v1 c
  left join public.erp_mkt_city_demand_latest_v1 cd
    on cd.company_id = c.company_id
   and cd.week_start = c.week_start
   and cd.city = c.city
  where c.company_id = (select company_id from current_company)
    and c.week_start = (select week_start from week_ref)
),
weights as (
  select
    st.company_id,
    wr.week_start,
    st.weekly_budget_inr,
    st.min_retargeting_share,
    st.max_prospecting_share,
    ss.count_scale_skus,
    cs.count_expand_cities,
    ss.total_scale_rev,
    cs.total_expand_rev,
    ss.avg_scale_conf,
    cs.avg_city_conf,
    case
      when (ss.total_scale_rev + cs.total_expand_rev) > 0 then ss.total_scale_rev / nullif(ss.total_scale_rev + cs.total_expand_rev, 0)
      else 0.5
    end as norm_rev_scale,
    case
      when (ss.total_scale_rev + cs.total_expand_rev) > 0 then cs.total_expand_rev / nullif(ss.total_scale_rev + cs.total_expand_rev, 0)
      else 0.5
    end as norm_rev_city
  from settings st
  cross join week_ref wr
  cross join scale_stats ss
  cross join city_stats cs
),
raw_shares as (
  select
    w.*,
    ((0.60 * w.norm_rev_scale) + (0.40 * w.avg_scale_conf))::numeric as w_scale,
    ((0.60 * w.norm_rev_city) + (0.40 * w.avg_city_conf))::numeric as w_city,
    least(greatest(w.min_retargeting_share, 0), 1)::numeric as retarget_share
  from weights w
),
allocated as (
  select
    r.*,
    (1 - r.retarget_share)::numeric as remaining_share,
    case
      when (r.w_scale + r.w_city) > 0 then (1 - r.retarget_share) * (r.w_scale / nullif(r.w_scale + r.w_city, 0))
      else (1 - r.retarget_share) * 0.5
    end as raw_scale_share,
    case
      when (r.w_scale + r.w_city) > 0 then (1 - r.retarget_share) * (r.w_city / nullif(r.w_scale + r.w_city, 0))
      else (1 - r.retarget_share) * 0.5
    end as raw_prospecting_share
  from raw_shares r
),
clamped as (
  select
    a.*,
    case
      when a.raw_prospecting_share > a.max_prospecting_share then a.max_prospecting_share
      else a.raw_prospecting_share
    end as prospecting_share,
    case
      when a.raw_prospecting_share > a.max_prospecting_share then a.raw_scale_share + (a.raw_prospecting_share - a.max_prospecting_share)
      else a.raw_scale_share
    end as scale_share
  from allocated a
)
select
  c.company_id,
  c.week_start,
  c.weekly_budget_inr,
  c.scale_share,
  c.prospecting_share,
  c.retarget_share,
  (c.weekly_budget_inr * c.scale_share)::numeric as scale_budget_inr,
  (c.weekly_budget_inr * c.prospecting_share)::numeric as prospecting_budget_inr,
  (c.weekly_budget_inr * c.retarget_share)::numeric as retarget_budget_inr,
  jsonb_build_object(
    'count_scale_skus', c.count_scale_skus,
    'count_expand_cities', c.count_expand_cities,
    'total_scale_rev', c.total_scale_rev,
    'total_expand_rev', c.total_expand_rev,
    'avg_scale_conf', c.avg_scale_conf,
    'avg_city_conf', c.avg_city_conf
  ) as drivers
from clamped c;

grant select on public.erp_mkt_budget_allocator_reco_v1 to authenticated, service_role;
grant select, insert, update on public.erp_mkt_budget_allocator_settings to authenticated, service_role;

commit;
