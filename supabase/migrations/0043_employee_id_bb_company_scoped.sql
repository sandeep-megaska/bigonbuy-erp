-- 0043_employee_id_bb_company_scoped.sql
-- Fix employee code generation:
-- - India-ready format: BB + 6 digits (BB000001)
-- - Company-scoped atomic sequencing
-- - Keep UUID PK in erp_employees
-- - Trigger-based assignment when employee_code is blank
-- - Backward-compatible wrapper for old calls

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1) Company settings + counters (company-scoped)
-- ---------------------------------------------------------------------

create table if not exists public.erp_company_settings (
  company_id uuid primary key references public.erp_companies(id) on delete cascade,
  employee_id_prefix text not null default 'BB',
  employee_id_digits int not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ---------------------------------------------------------------------
-- Schema alignment for existing erp_company_settings (older schema)
-- ---------------------------------------------------------------------
alter table public.erp_company_settings
  add column if not exists employee_id_prefix text,
  add column if not exists employee_id_digits int;

create table if not exists public.erp_company_counters (
  company_id uuid primary key references public.erp_companies(id) on delete cascade,
  employee_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.erp_company_counters
  add column if not exists employee_seq bigint;

-- updated_at trigger helper (only create once)
create or replace function public.erp_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_erp_company_settings_updated_at'
  ) then
    create trigger trg_erp_company_settings_updated_at
    before update on public.erp_company_settings
    for each row execute function public.erp_touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_erp_company_counters_updated_at'
  ) then
    create trigger trg_erp_company_counters_updated_at
    before update on public.erp_company_counters
    for each row execute function public.erp_touch_updated_at();
  end if;
end $$;

-- Ensure every existing company has settings + counters
-- Ensure every existing company has settings + counters
-- If erp_company_settings has audit columns like created_by/updated_by NOT NULL,
-- seed them using the company owner/admin user if available.

-- Seed missing settings rows with required audit fields
insert into public.erp_company_settings (company_id, created_by, updated_by)
select
  c.id,
  coalesce(
    (select cu.user_id
     from public.erp_company_users cu
     where cu.company_id = c.id
       and coalesce(cu.is_active, true)
       and cu.role_key in ('owner','admin')
     order by case when cu.role_key='owner' then 0 else 1 end, cu.created_at nulls last
     limit 1),
    (select cu2.user_id
     from public.erp_company_users cu2
     where cu2.company_id = c.id
       and coalesce(cu2.is_active, true)
     order by cu2.created_at nulls last
     limit 1)
  ),
  coalesce(
    (select cu.user_id
     from public.erp_company_users cu
     where cu.company_id = c.id
       and coalesce(cu.is_active, true)
       and cu.role_key in ('owner','admin')
     order by case when cu.role_key='owner' then 0 else 1 end, cu.created_at nulls last
     limit 1),
    (select cu2.user_id
     from public.erp_company_users cu2
     where cu2.company_id = c.id
       and coalesce(cu2.is_active, true)
     order by cu2.created_at nulls last
     limit 1)
  )
from public.erp_companies c
where not exists (
  select 1 from public.erp_company_settings s where s.company_id = c.id
);

-- Now ensure BB/6 defaults are present (for both new + existing rows)
update public.erp_company_settings
set employee_id_prefix = coalesce(employee_id_prefix, 'BB'),
    employee_id_digits = coalesce(employee_id_digits, 6)
where employee_id_prefix is null
   or employee_id_digits is null;


insert into public.erp_company_counters (company_id)
select c.id
from public.erp_companies c
on conflict (company_id) do nothing;

-- ---------------------------------------------------------------------
-- 2) New company-scoped generator: erp_next_employee_code(company_id)
-- ---------------------------------------------------------------------

create or replace function public.erp_next_employee_code(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_digits int;
  v_next bigint;
begin
  -- Ensure rows exist
  insert into public.erp_company_settings (company_id)
  values (p_company_id)
  on conflict (company_id) do nothing;

  insert into public.erp_company_counters (company_id)
  values (p_company_id)
  on conflict (company_id) do nothing;

  select employee_id_prefix, employee_id_digits
    into v_prefix, v_digits
  from public.erp_company_settings
  where company_id = p_company_id;

  -- Atomic increment per company
  update public.erp_company_counters
     set employee_seq = employee_seq + 1,
         updated_at = now()
   where company_id = p_company_id
  returning employee_seq into v_next;

  return coalesce(v_prefix, 'BB') || lpad(v_next::text, coalesce(v_digits, 6), '0');
end;
$$;

-- Backward-compatible wrapper (old code paths call without args)
-- Uses erp_current_company_id() for the logged-in context.
create or replace function public.erp_next_employee_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.erp_next_employee_code(public.erp_current_company_id())
$$;

-- Restrict direct execution (recommended)
revoke all on function public.erp_next_employee_code(uuid) from public;
revoke all on function public.erp_next_employee_code() from public;

-- Allow authenticated only if you really need it from client-side RPC.
-- Otherwise, grant only to service_role and call via server routes.
grant execute on function public.erp_next_employee_code(uuid) to service_role;
grant execute on function public.erp_next_employee_code() to service_role;

-- ---------------------------------------------------------------------
-- 3) Ensure uniqueness and standard length/format enforcement
-- ---------------------------------------------------------------------

alter table public.erp_employees
  add column if not exists employee_code text;

-- Unique per company
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'erp_employees'
      and indexname = 'erp_employees_company_employee_code_uniq'
  ) then
    create unique index erp_employees_company_employee_code_uniq
      on public.erp_employees(company_id, employee_code)
      where employee_code is not null and btrim(employee_code) <> '';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Trigger to auto-assign employee_code on insert (single source of truth)
-- ---------------------------------------------------------------------

create or replace function public.erp_assign_employee_code_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    new.employee_code := public.erp_next_employee_code(new.company_id);
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_erp_employees_assign_employee_code'
  ) then
    create trigger trg_erp_employees_assign_employee_code
    before insert on public.erp_employees
    for each row
    execute function public.erp_assign_employee_code_trg();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) Optional: normalize old codes (only if you want)
-- WARNING: This will change existing employee codes. Run only if acceptable.
-- ---------------------------------------------------------------------
-- Example only (commented out):
-- update public.erp_employees
-- set employee_code = null
-- where employee_code like 'BOB%';

