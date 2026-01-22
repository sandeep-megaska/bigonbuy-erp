-- 0183_fix_doc_sequences_fy_label.sql
-- Normalize fiscal year column naming for erp_doc_sequences.
-- Compatibility: if legacy fy_label exists and is NOT NULL, keep it filled from fiscal_year/doc_key.

do $$
begin
  -- Case A: legacy has fy_label but not fiscal_year -> rename fy_label -> fiscal_year
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fy_label'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fiscal_year'
  ) then
    execute 'alter table public.erp_doc_sequences rename column fy_label to fiscal_year';
  end if;
end $$;

-- Ensure fiscal_year is NOT NULL if it exists
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fiscal_year'
  ) then
    execute 'alter table public.erp_doc_sequences alter column fiscal_year set not null';
  end if;
end $$;

-- Compatibility sync: if BOTH fiscal_year and legacy fy_label exist, keep fy_label non-null.
create or replace function public.erp_doc_sequences_sync_fy_label()
returns trigger
language plpgsql
as $$
begin
  -- If legacy fy_label column exists, keep it in sync
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fy_label'
  ) then
    if new.fy_label is null then
      new.fy_label := new.fiscal_year;
    end if;

    if new.fiscal_year is null then
      new.fiscal_year := new.fy_label;
    end if;
  end if;

  return new;
end $$;

do $$
begin
  -- Only do this if both columns exist
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fy_label'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='fiscal_year'
  ) then
    -- Backfill existing nulls to satisfy NOT NULL constraints
    execute 'update public.erp_doc_sequences set fy_label = fiscal_year where fy_label is null and fiscal_year is not null';
    execute 'update public.erp_doc_sequences set fiscal_year = fy_label where fiscal_year is null and fy_label is not null';

    -- Recreate trigger idempotently
    execute 'drop trigger if exists trg_erp_doc_sequences_sync_fy_label on public.erp_doc_sequences';
    execute 'create trigger trg_erp_doc_sequences_sync_fy_label
             before insert or update on public.erp_doc_sequences
             for each row execute function public.erp_doc_sequences_sync_fy_label()';
  end if;
end $$;

-- Helpful composite index (idempotent)
create index if not exists idx_erp_doc_sequences_fy_key
  on public.erp_doc_sequences(company_id, fiscal_year);
