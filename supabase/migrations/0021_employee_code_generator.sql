-- 0021_employee_code_generator.sql
-- Provide employee_code generator + backfill codes safely

create extension if not exists "pgcrypto";

-- Sequence for employee codes (if you prefer sequence-based)
create sequence if not exists public.erp_employee_code_seq;

-- Generate next employee code like BOB0001
create or replace function public.erp_next_employee_code()
returns text
language plpgsql
stable
as $$
declare
  n bigint;
begin
  select nextval('public.erp_employee_code_seq') into n;
  return 'BOB' || lpad(n::text, 4, '0');
end;
$$;

-- Ensure column exists
alter table public.erp_employees
  add column if not exists employee_code text;

-- Backfill missing codes
update public.erp_employees
   set employee_code = public.erp_next_employee_code()
 where employee_code is null or employee_code = '';

-- Not null (only if you’re sure all rows now filled)
alter table public.erp_employees
  alter column employee_code set not null;

-- Unique per company (if company_id exists; it does in your system)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'erp_employees_company_employee_code_uk'
  ) then
    alter table public.erp_employees
      add constraint erp_employees_company_employee_code_uk
      unique (company_id, employee_code);
  end if;
end $$;
