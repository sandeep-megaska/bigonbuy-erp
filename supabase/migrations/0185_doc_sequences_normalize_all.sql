-- 0185_doc_sequences_normalize_all.sql
-- Normalize erp_doc_sequences legacy columns and keep them in sync.

-- Inspect existing columns for visibility in migration logs.
do $$
declare
  v_columns text;
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

  raise notice 'erp_doc_sequences columns: %', coalesce(v_columns, '<none>');
end $$;

-- Backfill legacy columns from canonical values when available.
do $$
declare
  v_has_doc_key boolean;
  v_has_fiscal_year boolean;
  v_has_doc_type boolean;
  v_has_fy_label boolean;
  v_has_fy_start boolean;
  v_has_fy_end boolean;
  v_label_expr text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_key'
  ) into v_has_doc_key;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fiscal_year'
  ) into v_has_fiscal_year;

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

  if v_has_doc_type and v_has_doc_key then
    execute 'update public.erp_doc_sequences set doc_type = coalesce(doc_type, doc_key)';
  end if;

  if v_has_fy_label and v_has_fiscal_year then
    execute 'update public.erp_doc_sequences set fy_label = coalesce(fy_label, fiscal_year)';
  end if;

  if v_has_fiscal_year and v_has_fy_label then
    v_label_expr := 'coalesce(fiscal_year, fy_label)';
  elsif v_has_fiscal_year then
    v_label_expr := 'fiscal_year';
  elsif v_has_fy_label then
    v_label_expr := 'fy_label';
  else
    v_label_expr := 'null';
  end if;

  if v_has_fy_start then
    execute format(
      'update public.erp_doc_sequences set fy_start = coalesce(fy_start, case when %s ~ ''^FY\\d{2}-\\d{2}$'' then make_date(2000 + substring(%s from 3 for 2)::int, 4, 1) else make_date(extract(year from current_date)::int, 4, 1) end)',
      v_label_expr,
      v_label_expr
    );
  end if;

  if v_has_fy_end then
    execute format(
      'update public.erp_doc_sequences set fy_end = coalesce(fy_end, (case when %s ~ ''^FY\\d{2}-\\d{2}$'' then make_date(2000 + substring(%s from 3 for 2)::int, 4, 1) else make_date(extract(year from current_date)::int, 4, 1) end + interval ''1 year - 1 day'')::date)',
      v_label_expr,
      v_label_expr
    );
  end if;
end $$;

-- Keep legacy columns synced from canonical values (and vice versa) on insert/update.
create or replace function public.erp_doc_sequences_sync_legacy_all()
returns trigger
language plpgsql
as $$
declare
  v_has_doc_key boolean;
  v_has_fiscal_year boolean;
  v_has_doc_type boolean;
  v_has_fy_label boolean;
  v_has_fy_start boolean;
  v_has_fy_end boolean;
  v_label text;
  v_start_year int;
  v_fy_start date;
  v_fy_end date;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'doc_key'
  ) into v_has_doc_key;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_doc_sequences'
      and column_name = 'fiscal_year'
  ) into v_has_fiscal_year;

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

  if v_has_doc_key and v_has_doc_type then
    if new.doc_key is null then
      new.doc_key := new.doc_type;
    end if;
    if new.doc_type is null then
      new.doc_type := new.doc_key;
    end if;
  end if;

  if v_has_fiscal_year and v_has_fy_label then
    if new.fiscal_year is null then
      new.fiscal_year := new.fy_label;
    end if;
    if new.fy_label is null then
      new.fy_label := new.fiscal_year;
    end if;
  end if;

  if v_has_fy_start or v_has_fy_end then
    v_label := coalesce(new.fiscal_year, new.fy_label);
    if v_label ~ '^FY\d{2}-\d{2}$' then
      v_start_year := 2000 + substring(v_label from 3 for 2)::int;
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

-- Create a single trigger when legacy columns are present.
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
    execute 'drop trigger if exists trg_erp_doc_sequences_sync_legacy_all on public.erp_doc_sequences';
    execute 'create trigger trg_erp_doc_sequences_sync_legacy_all
             before insert or update on public.erp_doc_sequences
             for each row execute function public.erp_doc_sequences_sync_legacy_all()';
  end if;
end $$;
