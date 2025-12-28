-- Single-company bootstrap for Bigonbuy ERP (Megaska)
create extension if not exists "pgcrypto";

-- Canonical single company definition
create table if not exists public.erp_company (
  id uuid primary key,
  legal_name text not null,
  brand_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the only company (idempotent)
insert into public.erp_company (id, legal_name, brand_name)
values ('b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a', 'Bigonbuy Trading Private Limited', 'Megaska')
on conflict (id) do nothing;

insert into public.erp_companies (id, legal_name)
values ('b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a', 'Bigonbuy Trading Private Limited')
on conflict (id) do nothing;

-- RLS for the single-company master
alter table public.erp_company enable row level security;
alter table public.erp_company force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'erp_company' and p.policyname = 'erp_company_select_authenticated'
  ) then
    create policy erp_company_select_authenticated
      on public.erp_company
      for select
      using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
end
$$;

create or replace function public.erp_get_company()
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.erp_company limit 1;
$$;

revoke all on function public.erp_get_company() from public;
grant execute on function public.erp_get_company() to authenticated;

create or replace function public.erp_bootstrap_owner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id constant uuid := 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
  v_user_id uuid;
  v_owner_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_user_id := auth.uid();

  insert into public.erp_roles (key, name) values
    ('owner', 'Owner'),
    ('admin', 'Administrator'),
    ('hr', 'HR Manager'),
    ('employee', 'Employee')
  on conflict (key) do nothing;

  select count(*)
  into v_owner_count
  from public.erp_company_users cu
  where cu.company_id = v_company_id
    and cu.role_key = 'owner';

  if v_owner_count > 0 then
    raise exception 'Bootstrap disabled: owner already exists';
  end if;

  insert into public.erp_company_users (company_id, user_id, role_key, updated_at)
  values (v_company_id, v_user_id, 'owner', now())
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'company_id', v_company_id,
    'user_id', v_user_id,
    'role_key', 'owner'
  );
end;
$$;

revoke all on function public.erp_bootstrap_owner() from public;
grant execute on function public.erp_bootstrap_owner() to authenticated;
