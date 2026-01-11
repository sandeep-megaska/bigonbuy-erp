create or replace function public.erp_log_hr_audit(
  p_action text,
  p_entity_id uuid,
  p_entity_type text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_table regclass;
  audit_table_name text;
  column_list text[] := array[]::text[];
  value_list text[] := array[]::text[];
  has_column boolean;
  insert_sql text;
begin
  audit_table := to_regclass('public.erp_hr_audit_log');
  if audit_table is null then
    audit_table := to_regclass('public.erp_audit_log');
  end if;

  if audit_table is null then
    return;
  end if;

  audit_table_name := split_part(audit_table::text, '.', 2);

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'company_id'
  ) into has_column;
  if has_column then
    column_list := column_list || 'company_id';
    value_list := value_list || 'erp_current_company_id()';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'actor_user_id'
  ) into has_column;
  if has_column then
    column_list := column_list || 'actor_user_id';
    value_list := value_list || 'auth.uid()';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'action'
  ) into has_column;
  if has_column then
    column_list := column_list || 'action';
    value_list := value_list || format('%L::text', p_action);
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'entity_type'
  ) into has_column;
  if has_column then
    column_list := column_list || 'entity_type';
    value_list := value_list || format('%L::text', p_entity_type);
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'entity_id'
  ) into has_column;
  if has_column then
    column_list := column_list || 'entity_id';
    value_list := value_list || format('%L::uuid', p_entity_id);
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'payload'
  ) into has_column;
  if has_column then
    column_list := column_list || 'payload';
    value_list := value_list || format('%L::jsonb', p_payload::text);
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = audit_table_name
      and column_name = 'created_at'
  ) into has_column;
  if has_column then
    column_list := column_list || 'created_at';
    value_list := value_list || 'now()';
  end if;

  if array_length(column_list, 1) is null then
    return;
  end if;

  insert_sql := format(
    'insert into %s (%s) values (%s)',
    audit_table,
    array_to_string(array(select quote_ident(col) from unnest(column_list) as col), ', '),
    array_to_string(value_list, ', ')
  );

  execute insert_sql;
end;
$$;

revoke execute on function public.erp_log_hr_audit(text, uuid, text, jsonb) from public;
grant execute on function public.erp_log_hr_audit(text, uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
