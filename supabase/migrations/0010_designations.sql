-- Designation master decoupled from access roles
create extension if not exists "pgcrypto";

-- Ensure designation table exists with required columns
create table if not exists public.erp_designations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  department text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill missing columns if table pre-exists
alter table public.erp_designations
  add column if not exists department text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Ensure unique constraint on code
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_designations_code_key'
      and conrelid = 'public.erp_designations'::regclass
  ) then
    alter table public.erp_designations
      add constraint erp_designations_code_key unique (code);
  end if;
end
$$;

-- Normalize existing codes to uppercase to avoid duplicate seeds
update public.erp_designations
   set code = upper(code),
       updated_at = now()
 where code <> upper(code);

-- Maintain updated_at on updates (reuse shared helper if present)
create or replace function public.erp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists erp_set_updated_at on public.erp_designations;
create trigger erp_set_updated_at
before update on public.erp_designations
for each row
execute function public.erp_set_updated_at();

-- Seed default designations (codes in uppercase)
insert into public.erp_designations (code, name, department, is_active)
values
  ('ASSISTANT', 'Assistant', null, true),
  ('ACCOUNTANT', 'Accountant', null, true),
  ('STORE_MANAGER', 'Store Manager', null, true),
  ('HR_EXECUTIVE', 'HR Executive', null, true)
on conflict (code) do nothing;

-- Link employees to designations via foreign key
alter table public.erp_employees
  add column if not exists designation_id uuid references public.erp_designations (id);

-- Manager predicate (owner/admin/hr)
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  );
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- RPC for active designations (manager only)
create or replace function public.erp_list_designations()
returns table (
  id uuid,
  code text,
  name text,
  department text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  return query
  select
    d.id,
    d.code,
    d.name,
    d.department,
    d.is_active
  from public.erp_designations d
  where coalesce(d.is_active, true)
  order by d.name;
end;
$$;

revoke all on function public.erp_list_designations() from public;
grant execute on function public.erp_list_designations() to authenticated;
