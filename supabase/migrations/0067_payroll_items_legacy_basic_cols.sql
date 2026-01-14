-- Backward-compat for older UI/API that still selects payroll_items.basic/hra/allowances

alter table public.erp_payroll_items
  add column if not exists basic numeric(14,2),
  add column if not exists hra numeric(14,2),
  add column if not exists allowances numeric(14,2);

-- Backfill from the new columns (if present)
update public.erp_payroll_items
set
  basic = coalesce(basic, salary_basic, 0),
  hra = coalesce(hra, salary_hra, 0),
  allowances = coalesce(allowances, salary_allowances, 0)
where company_id is not null;

-- Keep legacy columns in sync going forward
create or replace function public.erp_payroll_items_sync_legacy_cols()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.salary_basic is not null then
    new.basic := new.salary_basic;
  end if;

  if new.salary_hra is not null then
    new.hra := new.salary_hra;
  end if;

  if new.salary_allowances is not null then
    new.allowances := new.salary_allowances;
  end if;

  if new.salary_basic is null and new.basic is not null then
    new.salary_basic := new.basic;
  end if;

  if new.salary_hra is null and new.hra is not null then
    new.salary_hra := new.hra;
  end if;

  if new.salary_allowances is null and new.allowances is not null then
    new.salary_allowances := new.allowances;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_payroll_items_sync_legacy_cols on public.erp_payroll_items;

create trigger trg_payroll_items_sync_legacy_cols
before insert or update on public.erp_payroll_items
for each row
execute function public.erp_payroll_items_sync_legacy_cols();

notify pgrst, 'reload schema';