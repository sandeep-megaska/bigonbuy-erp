-- 0005_enforce_single_company.sql
-- Enforce single-company tenant model by normalizing all rows to canonical company_id
-- and preventing multiple owners.
-- Canonical company_id:
-- b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a

do $$
begin
  -- Normalize erp_company_users.company_id -> canonical
  update public.erp_company_users
    set company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
  where company_id <> 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';

  -- Normalize erp_employee_users.company_id -> canonical only if column exists
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='erp_employee_users'
      and column_name='company_id'
  ) then
    execute $sql$
      update public.erp_employee_users
        set company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
      where company_id <> 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
    $sql$;
  end if;

  -- Ensure exactly one owner: keep earliest created_at owner if present, else smallest user_id
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='erp_company_users'
      and column_name='created_at'
  ) then
    with owners as (
      select user_id
      from public.erp_company_users
      where company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
        and role_key = 'owner'
      order by created_at asc, user_id asc
    ),
    keep as (
      select user_id from owners limit 1
    )
    update public.erp_company_users
      set role_key = 'admin'
    where company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
      and role_key = 'owner'
      and user_id not in (select user_id from keep);
  else
    with owners as (
      select user_id
      from public.erp_company_users
      where company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
        and role_key = 'owner'
      order by user_id asc
    ),
    keep as (
      select user_id from owners limit 1
    )
    update public.erp_company_users
      set role_key = 'admin'
    where company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
      and role_key = 'owner'
      and user_id not in (select user_id from keep);
  end if;

end $$;

-- At most one owner per company
create unique index if not exists ux_erp_company_users_one_owner_per_company
on public.erp_company_users (company_id)
where role_key = 'owner';

-- Single-company constraint (hardcoded UUID; variables cannot be used in CHECK)
alter table public.erp_company_users
  drop constraint if exists chk_erp_company_users_single_company;

alter table public.erp_company_users
  add constraint chk_erp_company_users_single_company
  check (company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid);

-- Apply same constraint to erp_employee_users if company_id exists
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='erp_employee_users'
      and column_name='company_id'
  ) then
    execute 'alter table public.erp_employee_users drop constraint if exists chk_erp_employee_users_single_company';
    execute $sql$
      alter table public.erp_employee_users
        add constraint chk_erp_employee_users_single_company
        check (company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid)
    $sql$;
  end if;
end $$;

-- Disable bootstrap forever after initialization
create or replace function public.erp_bootstrap_owner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'Bootstrap disabled: system already initialized';
end;
$fn$;

revoke all on function public.erp_bootstrap_owner() from public;
grant execute on function public.erp_bootstrap_owner() to authenticated;
