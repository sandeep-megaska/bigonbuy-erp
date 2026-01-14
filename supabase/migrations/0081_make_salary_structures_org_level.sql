-- 0081_make_salary_structures_org_level.sql
-- Convert erp_salary_structures from employee-scoped to company-scoped templates

begin;

-- 1) Make employee_id nullable (structure is org-level)
alter table public.erp_salary_structures
  alter column employee_id drop not null;

-- 2) If there is a unique constraint that includes employee_id, replace it
-- We don't know the exact name, so drop by pattern safely using catalog lookup.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.erp_salary_structures'::regclass
      and contype = 'u'
  loop
    -- Drop any unique constraint that references employee_id
    if exists (
      select 1
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid
      join unnest(c.conkey) as k(attnum) on true
      where c.conname = r.conname
        and a.attnum = k.attnum
        and a.attname = 'employee_id'
    ) then
      execute format('alter table public.erp_salary_structures drop constraint %I', r.conname);
    end if;
  end loop;
end $$;

-- 3) Add a sensible org-level uniqueness (optional but recommended)
-- If your structures are identified by name:
do $$
begin
  -- create unique(company_id, name) if not exists
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.erp_salary_structures'::regclass
      and contype = 'u'
      and conname = 'erp_salary_structures_company_name_uniq'
  ) then
    alter table public.erp_salary_structures
      add constraint erp_salary_structures_company_name_uniq unique (company_id, name);
  end if;
exception when others then
  -- If 'name' column doesn't exist or differs, skip.
  -- We'll adjust after seeing schema.
end $$;

commit;
