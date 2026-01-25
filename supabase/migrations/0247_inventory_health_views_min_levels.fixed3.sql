-- 0247_inventory_health_views_min_levels.sql
-- Phase-4B-1: Inventory health (negative stock, low stock, available stock)

-- 1. Drop dependent views first (if they exist)
drop view if exists public.erp_inventory_negative_stock_v;
drop view if exists public.erp_inventory_low_stock_v;

-- 2. Ensure base table exists
create table if not exists public.erp_inventory_min_levels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  variant_id uuid not null,
  warehouse_id uuid null,
  min_level numeric not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  is_void boolean not null default false
);

-- 3. Add missing columns safely (for existing installs)
alter table public.erp_inventory_min_levels
  add column if not exists company_id uuid,
  add column if not exists variant_id uuid,
  add column if not exists warehouse_id uuid,
  add column if not exists min_level numeric default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists created_by uuid default auth.uid(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by uuid default auth.uid(),
  add column if not exists is_void boolean default false;

-- 4. Enforce canonical types safely
alter table public.erp_inventory_min_levels
  alter column min_level type numeric using min_level::numeric,
  alter column min_level set default 0,
  alter column min_level set not null;

-- 5. Index
create index if not exists erp_inventory_min_levels_company_variant_wh_idx
  on public.erp_inventory_min_levels(company_id, variant_id, warehouse_id);

-- 6. Negative stock view
create or replace view public.erp_inventory_negative_stock_v as
select
  l.warehouse_id,
  l.variant_id,
  v.sku as internal_sku,
  sum(l.qty_in - l.qty_out) as on_hand
from public.erp_inventory_ledger l
join public.erp_variants v
  on v.id = l.variant_id
 and v.company_id = public.erp_current_company_id()
where l.company_id = public.erp_current_company_id()
  and l.is_void = false
group by l.warehouse_id, l.variant_id, v.sku
having sum(l.qty_in - l.qty_out) < 0;

-- 7. Low stock view
create or replace view public.erp_inventory_low_stock_v as
select
  a.warehouse_id,
  a.variant_id,
  a.internal_sku,
  a.on_hand,
  a.reserved,
  a.available,
  ml.min_level
from public.erp_inventory_available(null) a
join public.erp_inventory_min_levels ml
  on ml.company_id = public.erp_current_company_id()
 and ml.variant_id = a.variant_id
 and (ml.warehouse_id is null or ml.warehouse_id = a.warehouse_id)
where a.available < ml.min_level
  and ml.is_void = false;

notify pgrst, 'reload schema';
