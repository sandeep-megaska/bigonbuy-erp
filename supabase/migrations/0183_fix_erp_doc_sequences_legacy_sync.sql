-- 0183_fix_erp_doc_sequences_legacy_sync.sql
-- Normalize erp_doc_sequences to canonical columns while keeping legacy columns synced.

-- Inspect existing columns and constraints for visibility in migration logs.
do $$
declare
  v_columns text;
  v_constraints text;
begin
  select string_agg(col_def, ', ' order by ordinal_position)
    into v_columns
    from (
      select
        ordinal_position,
        format('%s %s%s',
          column_name,
          data_type,
          case when is_nullable = 'NO' then ' not null' else '' end
        ) as col_def
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'erp_doc_sequences'
    ) cols;

  select string_agg(format('%s %s', c.conname, pg_get_constraintdef(c.oid)), '; ')
    into v_constraints
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'erp_doc_sequences';

  raise notice 'erp_doc_sequences columns: %', coalesce(v_columns, '<none>');
  raise notice 'erp_doc_sequences constraints: %', coalesce(v_constraints, '<none>');
end $$;

-- Ensure canonical columns exist.
alter table public.erp_doc_sequences
  add column if not exists company_id uuid,
  add column if not exists fiscal_year text,
  add column if not exists doc_key text,
  add column if not exists next_seq int;

alter table public.erp_doc_sequences
  alter column next_seq set default 1;

-- Backfill canonical columns from legacy columns when available.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_key'
  ) then
    execute 'update public.erp_doc_sequences set doc_key = coalesce(doc_key, doc_type)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fiscal_year'
  ) then
    execute 'update public.erp_doc_sequences set fiscal_year = coalesce(fiscal_year, fy_label)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'next_seq'
  ) then
    execute 'update public.erp_doc_sequences set next_seq = coalesce(next_seq, 1)';
  end if;
end $$;

-- Backfill legacy columns from canonical values when they exist (for NOT NULL safety).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_type'
  ) then
    execute 'update public.erp_doc_sequences set doc_type = coalesce(doc_type, doc_key)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_label'
  ) then
    execute 'update public.erp_doc_sequences set fy_label = coalesce(fy_label, fiscal_year)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_start'
  ) then
    execute '
      update public.erp_doc_sequences
      set fy_start = coalesce(
        fy_start,
        case
          when fiscal_year ~ ''^FY\d{2}-\d{2}$'' then make_date(2000 + substring(fiscal_year from 3 for 2)::int, 4, 1)
          else make_date(extract(year from current_date)::int, 4, 1)
        end
      )';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_end'
  ) then
    execute '
      update public.erp_doc_sequences
      set fy_end = coalesce(
        fy_end,
        (case
          when fiscal_year ~ ''^FY\d{2}-\d{2}$'' then make_date(2000 + substring(fiscal_year from 3 for 2)::int, 4, 1)
          else make_date(extract(year from current_date)::int, 4, 1)
        end + interval ''1 year - 1 day'')::date
      )';
  end if;
end $$;

-- Set NOT NULL on canonical columns only when safe.
do $$
declare
  v_nulls int;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_key'
  ) then
    execute 'select count(*) from public.erp_doc_sequences where doc_key is null' into v_nulls;
    if v_nulls = 0 then
      execute 'alter table public.erp_doc_sequences alter column doc_key set not null';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fiscal_year'
  ) then
    execute 'select count(*) from public.erp_doc_sequences where fiscal_year is null' into v_nulls;
    if v_nulls = 0 then
      execute 'alter table public.erp_doc_sequences alter column fiscal_year set not null';
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'next_seq'
  ) then
    execute 'select count(*) from public.erp_doc_sequences where next_seq is null' into v_nulls;
    if v_nulls = 0 then
      execute 'alter table public.erp_doc_sequences alter column next_seq set not null';
    end if;
  end if;
end $$;

-- Keep legacy columns synced from canonical columns on insert/update.
create or replace function public.erp_doc_sequences_sync_legacy()
returns trigger
language plpgsql
as $$
declare
  v_has_doc_type boolean;
  v_has_fy_label boolean;
  v_has_fy_start boolean;
  v_has_fy_end boolean;
  v_start_year int;
  v_fy_start date;
  v_fy_end date;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_type'
  ) into v_has_doc_type;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_label'
  ) into v_has_fy_label;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_start'
  ) into v_has_fy_start;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_end'
  ) into v_has_fy_end;

  if v_has_doc_type and new.doc_type is null then
    new.doc_type := new.doc_key;
  end if;

  if v_has_fy_label and new.fy_label is null then
    new.fy_label := new.fiscal_year;
  end if;

  if v_has_fy_start or v_has_fy_end then
    if new.fiscal_year ~ '^FY\d{2}-\d{2}$' then
      v_start_year := 2000 + substring(new.fiscal_year from 3 for 2)::int;
    else
      v_start_year := extract(year from current_date)::int;
    end if;

    v_fy_start := make_date(v_start_year, 4, 1);
    v_fy_end := (v_fy_start + interval '1 year - 1 day')::date;

    if v_has_fy_start and new.fy_start is null then
      new.fy_start := v_fy_start;
    end if;

    if v_has_fy_end and new.fy_end is null then
      new.fy_end := v_fy_end;
    end if;
  end if;

  return new;
end $$;

-- Create trigger only if legacy columns are present.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name in ('doc_type', 'fy_label', 'fy_start', 'fy_end')
  ) then
    execute 'drop trigger if exists trg_erp_doc_sequences_sync_doc_type on public.erp_doc_sequences';
    execute 'drop trigger if exists trg_erp_doc_sequences_sync_legacy on public.erp_doc_sequences';
    execute 'create trigger trg_erp_doc_sequences_sync_legacy
             before insert or update on public.erp_doc_sequences
             for each row execute function public.erp_doc_sequences_sync_legacy()';
  end if;
end $$;

-- Ensure canonical uniqueness.
create unique index if not exists erp_doc_sequences_company_fiscal_year_doc_key_key
  on public.erp_doc_sequences (company_id, fiscal_year, doc_key);

create or replace function public.erp_doc_allocate_number(p_doc_id uuid, p_doc_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_key text := upper(trim(p_doc_key));
  v_doc_date date;
  v_fiscal_year text;
  v_seq int;
  v_fy_start date;
  v_fy_end date;
  v_has_doc_type boolean;
  v_has_fy_label boolean;
  v_has_fy_start boolean;
  v_has_fy_end boolean;
  v_columns text[] := array['company_id', 'fiscal_year', 'doc_key', 'next_seq'];
  v_values text[] := array[]::text[];
  v_sql text;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_doc_id is null then
    raise exception 'doc_id is required';
  end if;

  if v_doc_key = '' then
    raise exception 'doc_key is required';
  end if;

  case v_doc_key
    when 'PO' then
      select order_date
        into v_doc_date
        from public.erp_purchase_orders
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Purchase order not found';
      end if;
    when 'GRN' then
      select received_at::date
        into v_doc_date
        from public.erp_grns
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'GRN not found';
      end if;
    when 'CN', 'DN' then
      select note_date
        into v_doc_date
        from public.erp_notes
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Note not found';
      end if;
    else
      raise exception 'Unsupported document key: %', v_doc_key;
  end case;

  if v_doc_date is null then
    v_doc_date := current_date;
  end if;

  v_fiscal_year := public.erp_fiscal_year(v_doc_date);
  v_fy_start := case
    when extract(month from v_doc_date)::int >= 4
      then make_date(extract(year from v_doc_date)::int, 4, 1)
    else make_date(extract(year from v_doc_date)::int - 1, 4, 1)
  end;
  v_fy_end := (v_fy_start + interval '1 year - 1 day')::date;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_type'
  ) into v_has_doc_type;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_label'
  ) into v_has_fy_label;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_start'
  ) into v_has_fy_start;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fy_end'
  ) into v_has_fy_end;

  v_values := array[
    format('%L', v_company_id),
    format('%L', v_fiscal_year),
    format('%L', v_doc_key),
    '1'
  ];

  if v_has_doc_type then
    v_columns := v_columns || 'doc_type';
    v_values := v_values || format('%L', v_doc_key);
  end if;

  if v_has_fy_label then
    v_columns := v_columns || 'fy_label';
    v_values := v_values || format('%L', v_fiscal_year);
  end if;

  if v_has_fy_start then
    v_columns := v_columns || 'fy_start';
    v_values := v_values || format('%L', v_fy_start);
  end if;

  if v_has_fy_end then
    v_columns := v_columns || 'fy_end';
    v_values := v_values || format('%L', v_fy_end);
  end if;

  v_sql := format(
    'insert into public.erp_doc_sequences (%s) values (%s) on conflict (company_id, fiscal_year, doc_key) do nothing',
    array_to_string(v_columns, ', '),
    array_to_string(v_values, ', ')
  );

  execute v_sql;

  select next_seq
    into v_seq
    from public.erp_doc_sequences
    where company_id = v_company_id
      and fiscal_year = v_fiscal_year
      and doc_key = v_doc_key
    for update;

  update public.erp_doc_sequences
  set next_seq = next_seq + 1
  where company_id = v_company_id
    and fiscal_year = v_fiscal_year
    and doc_key = v_doc_key;

  return v_fiscal_year || '/' || v_doc_key || '/' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_doc_allocate_number(uuid, text) from public;
grant execute on function public.erp_doc_allocate_number(uuid, text) to authenticated;

--
-- Verification (run manually):
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'erp_doc_sequences'
--  order by ordinal_position;
--
-- select conname, pg_get_constraintdef(c.oid)
--   from pg_constraint c
--   join pg_class t on t.oid = c.conrelid
--   join pg_namespace n on n.oid = t.relnamespace
--  where n.nspname = 'public' and t.relname = 'erp_doc_sequences';
--
-- insert into public.erp_doc_sequences (company_id, fiscal_year, doc_key, next_seq)
-- values (public.erp_current_company_id(), public.erp_fiscal_year(current_date), 'PO', 1)
-- on conflict do nothing;
--
-- select * from public.erp_doc_sequences
--  where company_id = public.erp_current_company_id()
--  order by fiscal_year desc, doc_key;
