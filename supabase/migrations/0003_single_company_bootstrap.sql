-- Single-company bootstrap for Bigonbuy ERP
create extension if not exists "pgcrypto";

-- Canonical company master with fixed tenant row
create table if not exists public.erp_companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  brand_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'legal_name'
  ) then
    alter table public.erp_companies add column legal_name text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'brand_name'
  ) then
    alter table public.erp_companies add column brand_name text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'updated_at'
  ) then
    alter table public.erp_companies add column updated_at timestamptz not null default now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'created_at'
  ) then
    alter table public.erp_companies alter column created_at set default now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'updated_at'
  ) then
    alter table public.erp_companies alter column updated_at set default now();
  end if;

  update public.erp_companies
  set legal_name = coalesce(legal_name, name, 'Bigonbuy Trading Private Limited')
  where legal_name is null;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'erp_companies' and column_name = 'legal_name'
  ) then
    alter table public.erp_companies alter column legal_name set not null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_companies_legal_name_key'
      and conrelid = 'public.erp_companies'::regclass
  ) then
    alter table public.erp_companies add constraint erp_companies_legal_name_key unique (legal_name);
  end if;
end
$$;

insert into public.erp_companies (id, legal_name, brand_name)
values ('11111111-1111-1111-1111-111111111111', 'Bigonbuy Trading Private Limited', 'Megaska')
on conflict (id) do nothing;

alter table public.erp_companies enable row level security;
alter table public.erp_companies force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'erp_companies' and p.policyname = 'erp_companies_select_authenticated'
  ) then
    create policy erp_companies_select_authenticated
      on public.erp_companies
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
  select id from public.erp_companies order by created_at limit 1;
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
  v_company_id uuid;
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

  insert into public.erp_companies (id, legal_name, brand_name)
  values ('11111111-1111-1111-1111-111111111111', 'Bigonbuy Trading Private Limited', 'Megaska')
  on conflict (id) do nothing;

  select id
  into v_company_id
  from public.erp_companies
  order by created_at
  limit 1;

  select count(*)
  into v_owner_count
  from public.erp_company_users cu
  where cu.company_id = v_company_id
    and cu.role_key = 'owner';

  if v_owner_count > 0 then
    if not exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = v_user_id
        and cu.role_key in ('owner', 'admin')
    ) then
      raise exception 'Owner already exists. Only an owner or admin can promote another owner.';
    end if;
  end if;

  insert into public.erp_company_users (company_id, user_id, role_key, updated_at)
  values (v_company_id, v_user_id, 'owner', now())
  on conflict (company_id, user_id) do update
    set role_key = 'owner',
        updated_at = now();

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
