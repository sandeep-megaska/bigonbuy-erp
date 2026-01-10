-- Add canonical user_id link to employees (Employee = ERP User)

-- 1) Add column
alter table public.erp_employees
  add column if not exists user_id uuid;

-- 2) Backfill from existing mapping table if present
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema='public'
      and table_name='erp_employee_users'
  ) then
    update public.erp_employees e
       set user_id = eu.user_id
      from public.erp_employee_users eu
     where eu.employee_id = e.id
       and coalesce(eu.is_active, true)
       and e.user_id is null;
  end if;
end $$;

-- 3) Ensure one user_id per employee (optional but recommended)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_employees_user_id_uk'
  ) then
    alter table public.erp_employees
      add constraint erp_employees_user_id_uk unique (user_id);
  end if;
end $$;

-- 4) Index for auth lookups
create index if not exists erp_employees_user_id_idx
  on public.erp_employees(user_id);

-- 5) FK to auth.users (recommended for integrity)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_employees_user_id_fkey'
  ) then
    alter table public.erp_employees
      add constraint erp_employees_user_id_fkey
      foreign key (user_id) references auth.users(id)
      on delete set null;
  end if;
end $$;

-- 6) (Optional) Make user_id NOT NULL only if every employee must be a system user.
-- If you have employees that are not onboarded yet, keep it nullable.
-- Uncomment only after you confirm no rows have null user_id.
-- alter table public.erp_employees alter column user_id set not null;
