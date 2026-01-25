-- 0247_inventory_health_views_min_levels.sql
-- Inventory health views, min levels table normalization, and RPCs

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_inventory_min_levels'
      and column_name = 'min_stock_level'
  ) then
    alter table public.erp_inventory_min_levels rename column min_stock_level to min_level;
  end if;
end;
$$;

alter table public.erp_inventory_min_levels
  add column if not exists id uuid,
  add column if not exists warehouse_id uuid null references public.erp_warehouses (id) on delete restrict,
  add column if not exists min_level numeric,
  add column if not exists note text null,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid;

alter table public.erp_inventory_min_levels
  alter column id set default gen_random_uuid();

update public.erp_inventory_min_levels
   set id = gen_random_uuid()
 where id is null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.constraint_schema = 'public'
      and tc.table_name = 'erp_inventory_min_levels'
      and tc.constraint_type = 'PRIMARY KEY'
  ) then
    alter table public.erp_inventory_min_levels
      add constraint erp_inventory_min_levels_pkey primary key (id);
  end if;
end;
$$;

alter table public.erp_inventory_min_levels
  alter column min_level type numeric using min_level::numeric,
  alter column min_level set default 0,
  alter column min_level set not null,
  alter column created_by set default auth.uid(),
  alter column updated_by set default auth.uid();

update public.erp_inventory_min_levels
   set created_by = coalesce(created_by, auth.uid(), gen_random_uuid()),
       updated_by = coalesce(updated_by, auth.uid(), gen_random_uuid())
 where created_by is null
    or updated_by is null;

alter table public.erp_inventory_min_levels
  alter column created_by set not null,
  alter column updated_by set not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.constraint_schema = 'public'
      and tc.table_name = 'erp_inventory_min_levels'
      and tc.constraint_name = 'erp_inventory_min_levels_min_level_check'
  ) then
    alter table public.erp_inventory_min_levels
      add constraint erp_inventory_min_levels_min_level_check check (min_level >= 0);
  end if;
end;
$$;

drop index if exists erp_inventory_min_levels_company_variant_key;

create unique index if not exists erp_inventory_min_levels_company_warehouse_variant_active_key
  on public.erp_inventory_min_levels (company_id, warehouse_id, variant_id)
  where is_active = true;

create or replace view public.erp_inventory_available_v as
  select
    public.erp_current_company_id() as company_id,
    a.warehouse_id,
    a.variant_id,
    a.internal_sku,
    a.on_hand,
    a.reserved,
    a.available
  from public.erp_inventory_available(null) a;

create or replace view public.erp_inventory_negative_stock_v as
  select
    company_id,
    warehouse_id,
    variant_id,
    internal_sku,
    on_hand,
    reserved,
    available
  from public.erp_inventory_available_v
  where available < 0;

create or replace view public.erp_inventory_low_stock_v as
  select
    a.company_id,
    a.warehouse_id,
    a.variant_id,
    a.internal_sku,
    a.on_hand,
    a.reserved,
    a.available,
    m.min_level,
    (m.min_level - a.available) as shortage
  from public.erp_inventory_available_v a
  join lateral (
    select ml.min_level
    from public.erp_inventory_min_levels ml
    where ml.company_id = a.company_id
      and ml.variant_id = a.variant_id
      and ml.is_active
      and (ml.warehouse_id = a.warehouse_id or ml.warehouse_id is null)
    order by (ml.warehouse_id is null) asc, ml.updated_at desc
    limit 1
  ) m on true
  where a.available <= m.min_level;

create or replace function public.erp_inventory_min_level_upsert(
  p_id uuid default null,
  p_variant_id uuid,
  p_warehouse_id uuid default null,
  p_min_level numeric,
  p_note text default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_target_id uuid;
  v_note text := nullif(trim(p_note), '');
begin
  perform public.erp_require_inventory_writer();

  if p_id is not null then
    update public.erp_inventory_min_levels
       set warehouse_id = p_warehouse_id,
           variant_id = p_variant_id,
           min_level = greatest(coalesce(p_min_level, 0), 0),
           note = v_note,
           is_active = coalesce(p_is_active, true),
           updated_at = now(),
           updated_by = coalesce(v_actor, updated_by)
     where id = p_id
       and company_id = v_company_id
     returning id into v_target_id;
  else
    select id
      into v_target_id
      from public.erp_inventory_min_levels
     where company_id = v_company_id
       and variant_id = p_variant_id
       and ((p_warehouse_id is null and warehouse_id is null) or warehouse_id = p_warehouse_id)
       and is_active
     limit 1;

    if v_target_id is not null then
      update public.erp_inventory_min_levels
         set min_level = greatest(coalesce(p_min_level, 0), 0),
             note = v_note,
             is_active = coalesce(p_is_active, true),
             updated_at = now(),
             updated_by = coalesce(v_actor, updated_by)
       where id = v_target_id;
    else
      insert into public.erp_inventory_min_levels (
        company_id,
        warehouse_id,
        variant_id,
        min_level,
        note,
        is_active,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_company_id,
        p_warehouse_id,
        p_variant_id,
        greatest(coalesce(p_min_level, 0), 0),
        v_note,
        coalesce(p_is_active, true),
        now(),
        coalesce(v_actor, auth.uid()),
        now(),
        coalesce(v_actor, auth.uid())
      )
      returning id into v_target_id;
    end if;
  end if;

  if v_target_id is null then
    raise exception 'Unable to upsert inventory min level.';
  end if;

  return v_target_id;
end;
$$;

create or replace function public.erp_inventory_min_levels_list(
  p_q text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  company_id uuid,
  warehouse_id uuid,
  warehouse_name text,
  warehouse_code text,
  variant_id uuid,
  internal_sku text,
  min_level numeric,
  note text,
  is_active boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(trim(p_q), '') as q
  )
  select
    m.id,
    m.company_id,
    m.warehouse_id,
    w.name as warehouse_name,
    w.code as warehouse_code,
    m.variant_id,
    v.sku as internal_sku,
    m.min_level,
    m.note,
    m.is_active,
    m.updated_at
  from public.erp_inventory_min_levels m
  join public.erp_variants v
    on v.id = m.variant_id
   and v.company_id = public.erp_current_company_id()
  left join public.erp_warehouses w
    on w.id = m.warehouse_id
   and w.company_id = public.erp_current_company_id()
  where m.company_id = public.erp_current_company_id()
    and (
      (select q from normalized) is null
      or v.sku ilike '%' || (select q from normalized) || '%'
    )
  order by v.sku asc, w.name asc nulls first
  limit p_limit
  offset p_offset;
$$;

create or replace function public.erp_inventory_health_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'negative_count', (select count(*) from public.erp_inventory_negative_stock_v),
    'low_stock_count', (select count(*) from public.erp_inventory_low_stock_v)
  );
$$;

revoke all on function public.erp_inventory_min_level_upsert(uuid, uuid, uuid, numeric, text, boolean) from public;
revoke all on function public.erp_inventory_min_levels_list(text, int, int) from public;
revoke all on function public.erp_inventory_health_summary() from public;
grant execute on function public.erp_inventory_min_level_upsert(uuid, uuid, uuid, numeric, text, boolean) to authenticated;
grant execute on function public.erp_inventory_min_levels_list(text, int, int) to authenticated;
grant execute on function public.erp_inventory_health_summary() to authenticated;

notify pgrst, 'reload schema';
