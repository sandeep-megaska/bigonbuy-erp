-- 0187_fix_doc_allocate_number_array_concat.sql
-- Fix malformed array literal error by correctly concatenating text[] arrays in erp_doc_allocate_number

create or replace function public.erp_doc_allocate_number(p_doc_id uuid, p_doc_key text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    v_columns := v_columns || array['doc_type'];
    v_values := v_values || format('%L', v_doc_key);
  end if;

  if v_has_fy_label then
    v_columns := v_columns || array['fy_label'];
    v_values := v_values || format('%L', v_fiscal_year);
  end if;

  if v_has_fy_start then
    v_columns := v_columns || array['fy_start'];
    v_values := v_values || format('%L', v_fy_start);
  end if;

  if v_has_fy_end then
    v_columns := v_columns || array['fy_end'];
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
$function$;
