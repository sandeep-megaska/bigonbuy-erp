-- 0182_fix_doc_sequences_schema.sql
-- Normalize erp_doc_sequences to use doc_key (canonical).
-- Idempotent: handles cases where doc_key already exists.

do $$
begin
  -- Case A: legacy schema has doc_type but not doc_key -> rename
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_type'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_key'
  ) then
    execute 'alter table public.erp_doc_sequences rename column doc_type to doc_key';
  end if;
end $$;

-- Ensure doc_key is NOT NULL (canonical requirement), but only if it exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_key'
  ) then
    execute 'alter table public.erp_doc_sequences alter column doc_key set not null';
  end if;
end $$;

-- If both doc_key and legacy doc_type exist, keep doc_type synced from doc_key
-- so old constraints/queries won't break while we phase doc_type out.
create or replace function public.erp_doc_sequences_sync_doc_type()
returns trigger
language plpgsql
as $$
begin
  -- If legacy doc_type exists, keep it in sync with doc_key
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_type'
  ) then
    if new.doc_type is null then
      new.doc_type := new.doc_key;
    end if;
  end if;

  return new;
end $$;

do $$
begin
  -- Only create trigger if doc_type exists (legacy) AND doc_key exists
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_type'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_doc_sequences' and column_name='doc_key'
  ) then
    -- Backfill any NULL doc_type from doc_key to satisfy NOT NULL
    execute 'update public.erp_doc_sequences set doc_type = doc_key where doc_type is null';

    -- Create trigger (idempotent)
    execute 'drop trigger if exists trg_erp_doc_sequences_sync_doc_type on public.erp_doc_sequences';
    execute 'create trigger trg_erp_doc_sequences_sync_doc_type
             before insert or update on public.erp_doc_sequences
             for each row execute function public.erp_doc_sequences_sync_doc_type()';
  end if;
end $$;

create index if not exists idx_erp_doc_sequences_key
  on public.erp_doc_sequences(company_id, fiscal_year, doc_key);
