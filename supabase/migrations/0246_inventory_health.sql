-- 0246_inventory_health.sql
-- Inventory health views and minimum stock levels

create or replace view public.erp_inventory_available_v as
  with ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(
        case
          when l.entry_type in ('reservation', 'reservation_cancel') then 0
          else (l.qty_in - l.qty_out)
        end
      )::numeric as on_hand,
      sum(
        case
          when l.entry_type = 'reservation' then l.qty_out
          when l.entry_type = 'reservation_cancel' then -l.qty_in
          else 0
        end
      )::numeric as reserved
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
    group by l.warehouse_id, l.variant_id
  )
  select
    lt.warehouse_id,
    lt.variant_id,
    lt.on_hand,
    coalesce(lt.reserved, 0) as reserved,
    (lt.on_hand - coalesce(lt.reserved, 0)) as available
  from ledger_totals lt;

create or replace view public.erp_inventory_negative_stock_v as
  select
    warehouse_id,
    variant_id,
    on_hand,
    reserved,
    available
  from public.erp_inventory_available_v
  where available < 0;

create table if not exists public.erp_inventory_min_levels (
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  min_stock_level integer not null default 0
);

create unique index if not exists erp_inventory_min_levels_company_variant_key
  on public.erp_inventory_min_levels (company_id, variant_id);

alter table public.erp_inventory_min_levels enable row level security;
alter table public.erp_inventory_min_levels force row level security;

do $$
begin
  drop policy if exists erp_inventory_min_levels_select on public.erp_inventory_min_levels;
  drop policy if exists erp_inventory_min_levels_write on public.erp_inventory_min_levels;

  create policy erp_inventory_min_levels_select
    on public.erp_inventory_min_levels
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

  create policy erp_inventory_min_levels_write
    on public.erp_inventory_min_levels
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

create or replace view public.erp_inventory_low_stock_v as
  select
    a.warehouse_id,
    a.variant_id,
    a.on_hand,
    a.reserved,
    a.available,
    m.min_stock_level
  from public.erp_inventory_available_v a
  join public.erp_inventory_min_levels m
    on m.variant_id = a.variant_id
   and m.company_id = public.erp_current_company_id()
  where a.available <= m.min_stock_level;

notify pgrst, 'reload schema';
