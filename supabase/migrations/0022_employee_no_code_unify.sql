-- 0022_employee_no_code_unify.sql
-- Canonicalize employee number to employee_no, keep employee_code as synced alias,
-- and provide both generator functions.

create extension if not exists "pgcrypto";

-- 1) Ensure columns exist
alter table public.erp_employees
  add column if not exists employee_no text;

alter table public.erp_employees
  add column if not exists employee_code text;

-- 2) Single sequence to drive both
create sequence if not exists public.erp_employee_no_seq;

-- 3) Generator (canonical)
create or replace function public.erp_next_employee_no()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  select nextval('public.erp_employee_no_seq') into n;
  return 'BOB' || lpad(n::text, 4, '0');
end;
$$;

-- 4) Backward-compatible generator (used by earlier migrations/code)
create or replace function public.erp_next_employee_code()
returns text
language sql
stable
as $$
  select public.erp_next_employee_no();
$$;

-- 5) Backfill existing rows (prefer employee_no, then employee_code)
update public.erp_employees
   set employee_no = coalesce(nullif(employee_no, ''), nullif(employee_code, ''), public.erp_next_employee_no())
 where employee_no is null or employee_no = '';

-- Keep employee_code identical to employee_no
update public.erp_employees
   set employee_code = employee_no
 where employee_code is null or employee_code = '' or employee_code <> employee_no;

-- 6) NOT NULL (safe after backfill)
alter table public.erp_employees
  alter column employee_no set not null;

alter table public.erp_employees
  alter column employee_code set not null;

-- 7) Uniqueness per company
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'erp_employees_company_employee_no_uk'
  ) then
    alter table public.erp_employees
      add constraint erp_employees_company_employee_no_uk
      unique (company_id, employee_no);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'erp_employees_company_employee_code_uk'
  ) then
    alter table public.erp_employees
      add constraint erp_employees_company_employee_code_uk
      unique (company_id, employee_code);
  end if;
end $$;

-- 8) Keep them in sync going forward
create or replace function public.erp_employees_sync_no_code()
returns trigger
language plpgsql
as $$
begin
  if (new.employee_no is null or new.employee_no = '') and (new.employee_code is null or new.employee_code = '') then
    new.employee_no := public.erp_next_employee_no();
    new.employee_code := new.employee_no;
    return new;
  end if;

  if new.employee_no is null or new.employee_no = '' then
    new.employee_no := new.employee_code;
  end if;

  new.employee_code := new.employee_no;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_erp_employees_sync_no_code') then
    create trigger trg_erp_employees_sync_no_code
    before insert or update on public.erp_employees
    for each row
    execute function public.erp_employees_sync_no_code();
  end if;
end $$;
