create table if not exists public.erp_ui_route_hits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  user_id uuid null references auth.users (id) on delete set null,
  route text not null,
  kind text not null check (kind in ('deprecated', 'hidden', 'direct_access')),
  referrer text null,
  user_agent text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists erp_ui_route_hits_company_created_at_idx
  on public.erp_ui_route_hits (company_id, created_at desc);

create index if not exists erp_ui_route_hits_company_route_created_at_idx
  on public.erp_ui_route_hits (company_id, route, created_at desc);

create index if not exists erp_ui_route_hits_company_kind_created_at_idx
  on public.erp_ui_route_hits (company_id, kind, created_at desc);

alter table public.erp_ui_route_hits enable row level security;
alter table public.erp_ui_route_hits force row level security;

drop policy if exists erp_ui_route_hits_select on public.erp_ui_route_hits;

create policy erp_ui_route_hits_select
  on public.erp_ui_route_hits
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
          and cu.role_key in ('owner', 'admin')
      )
    )
  );

create or replace function public.erp_ui_route_hit_insert(
  p_route text,
  p_kind text,
  p_referrer text default null,
  p_user_agent text default null,
  p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'Missing company context';
  end if;

  if p_route is null or p_route = '' or p_route not like '/erp/%' then
    raise exception 'Invalid route';
  end if;

  if p_kind is null or p_kind not in ('deprecated', 'hidden', 'direct_access') then
    raise exception 'Invalid kind';
  end if;

  insert into public.erp_ui_route_hits (
    company_id,
    user_id,
    route,
    kind,
    referrer,
    user_agent,
    meta
  )
  values (
    v_company_id,
    auth.uid(),
    p_route,
    p_kind,
    nullif(p_referrer, ''),
    nullif(p_user_agent, ''),
    coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.erp_ui_route_hit_insert(
  text,
  text,
  text,
  text,
  jsonb
) from public;
grant execute on function public.erp_ui_route_hit_insert(
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.erp_ui_route_hits_summary(
  p_from date,
  p_to date,
  p_kind text default null,
  p_query text default null
) returns table (
  route text,
  kind text,
  hits bigint,
  last_hit_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'Missing date range';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized';
  end if;

  return query
    select
      hits.route,
      hits.kind,
      hits.hits,
      hits.last_hit_at
    from (
      select
        route,
        kind,
        count(*)::bigint as hits,
        max(created_at) as last_hit_at
      from public.erp_ui_route_hits
      where company_id = public.erp_current_company_id()
        and created_at >= p_from::timestamptz
        and created_at < (p_to::timestamptz + interval '1 day')
        and (p_kind is null or kind = p_kind)
        and (p_query is null or route ilike '%' || p_query || '%')
      group by route, kind
    ) hits
    order by hits.hits desc, hits.last_hit_at desc;
end;
$$;

revoke all on function public.erp_ui_route_hits_summary(
  date,
  date,
  text,
  text
) from public;
grant execute on function public.erp_ui_route_hits_summary(
  date,
  date,
  text,
  text
) to authenticated;
