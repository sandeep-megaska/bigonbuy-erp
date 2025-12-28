-- Fix authorization gates for single-company model

-- Canonical company getter
create or replace function public.erp_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid
$$;

-- Authoritative manager predicate (owner/admin/hr)
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and cu.role_key in ('owner','admin','hr')
      and coalesce(cu.is_active, true)
  )
$$;

-- Owner predicate (owner/admin)
create or replace function public.is_erp_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and cu.role_key in ('owner','admin')
      and coalesce(cu.is_active, true)
  )
$$;

-- Ensure canonical owner membership exists and is active
insert into public.erp_company_users (company_id, user_id, role_key, is_active, created_at, updated_at)
values (
  'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid,
  '9673523f-3485-4acc-97c4-6a4662e48743'::uuid,
  'owner',
  true,
  now(),
  now()
)
on conflict (company_id, user_id) do update
  set role_key = excluded.role_key,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at;
