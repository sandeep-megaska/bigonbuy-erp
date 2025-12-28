-- Enable UUID generation extension used for primary keys
create extension if not exists "pgcrypto";

-- Core ERP role definitions
create table if not exists public.erp_roles (
  key text primary key,
  name text not null
);

create table if not exists public.erp_user_roles (
  user_id uuid primary key references auth.users (id),
  role_key text not null references public.erp_roles (key)
);

-- Product catalog
create table if not exists public.erp_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.erp_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.erp_products (id) on delete cascade,
  sku text not null,
  size text,
  color text,
  cost_price numeric(12, 2),
  selling_price numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint erp_variants_sku_key unique (sku)
);

create table if not exists public.erp_inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.erp_variants (id),
  qty integer not null,
  type text not null,
  reason text,
  ref text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- Shared predicate: user must be owner or admin
create or replace function public.erp_is_owner_or_admin()
returns boolean
language sql
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.erp_user_roles ur
      where ur.user_id = auth.uid()
        and ur.role_key in ('owner', 'admin')
    );
$$;

-- Enable RLS
alter table public.erp_roles enable row level security;
alter table public.erp_user_roles enable row level security;
alter table public.erp_products enable row level security;
alter table public.erp_variants enable row level security;
alter table public.erp_inventory_ledger enable row level security;

alter table public.erp_roles force row level security;
alter table public.erp_user_roles force row level security;
alter table public.erp_products force row level security;
alter table public.erp_variants force row level security;
alter table public.erp_inventory_ledger force row level security;

-- Authenticated read access
create policy erp_roles_read_authenticated
  on public.erp_roles
  for select
  using (auth.role() = 'service_role' or auth.uid() is not null);

create policy erp_user_roles_read_authenticated
  on public.erp_user_roles
  for select
  using (auth.role() = 'service_role' or auth.uid() is not null);

create policy erp_products_read_authenticated
  on public.erp_products
  for select
  using (auth.role() = 'service_role' or auth.uid() is not null);

create policy erp_variants_read_authenticated
  on public.erp_variants
  for select
  using (auth.role() = 'service_role' or auth.uid() is not null);

create policy erp_inventory_ledger_read_authenticated
  on public.erp_inventory_ledger
  for select
  using (auth.role() = 'service_role' or auth.uid() is not null);

-- Owner/admin write access
create policy erp_roles_write_admin
  on public.erp_roles
  for insert
  with check (public.erp_is_owner_or_admin());

create policy erp_roles_update_admin
  on public.erp_roles
  for update
  using (public.erp_is_owner_or_admin())
  with check (public.erp_is_owner_or_admin());

create policy erp_roles_delete_admin
  on public.erp_roles
  for delete
  using (public.erp_is_owner_or_admin());

create policy erp_user_roles_write_admin
  on public.erp_user_roles
  for insert
  with check (public.erp_is_owner_or_admin());

create policy erp_user_roles_update_admin
  on public.erp_user_roles
  for update
  using (public.erp_is_owner_or_admin())
  with check (public.erp_is_owner_or_admin());

create policy erp_user_roles_delete_admin
  on public.erp_user_roles
  for delete
  using (public.erp_is_owner_or_admin());

create policy erp_products_write_admin
  on public.erp_products
  for insert
  with check (public.erp_is_owner_or_admin());

create policy erp_products_update_admin
  on public.erp_products
  for update
  using (public.erp_is_owner_or_admin())
  with check (public.erp_is_owner_or_admin());

create policy erp_products_delete_admin
  on public.erp_products
  for delete
  using (public.erp_is_owner_or_admin());

create policy erp_variants_write_admin
  on public.erp_variants
  for insert
  with check (public.erp_is_owner_or_admin());

create policy erp_variants_update_admin
  on public.erp_variants
  for update
  using (public.erp_is_owner_or_admin())
  with check (public.erp_is_owner_or_admin());

create policy erp_variants_delete_admin
  on public.erp_variants
  for delete
  using (public.erp_is_owner_or_admin());

create policy erp_inventory_ledger_write_admin
  on public.erp_inventory_ledger
  for insert
  with check (public.erp_is_owner_or_admin());

create policy erp_inventory_ledger_update_admin
  on public.erp_inventory_ledger
  for update
  using (public.erp_is_owner_or_admin())
  with check (public.erp_is_owner_or_admin());

create policy erp_inventory_ledger_delete_admin
  on public.erp_inventory_ledger
  for delete
  using (public.erp_is_owner_or_admin());

-- Seed roles
insert into public.erp_roles (key, name) values
  ('owner', 'Owner'),
  ('admin', 'Administrator'),
  ('staff', 'Staff')
on conflict (key) do update set name = excluded.name;

insert into public.erp_roles (key, name) values
  ('hr', 'HR Manager'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- Replace OWNER_USER_ID with your auth.users id before running this seed
insert into public.erp_user_roles (user_id, role_key)
select 'OWNER_USER_ID'::uuid, 'owner'
where exists (
  select 1 from auth.users u where u.id = 'OWNER_USER_ID'::uuid
)
on conflict (user_id) do update set role_key = excluded.role_key;
