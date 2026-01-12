-- Fix: erp_dev_schema_columns return types must match declared RETURNS TABLE(...)
-- information_schema uses sql_identifier (name-like). Cast to text to avoid mismatch.

create or replace function public.erp_dev_schema_columns(
  p_table_name text default null
)
returns table(
  table_schema text,
  table_name text,
  column_name text,
  data_type text,
  is_nullable text,
  ordinal_position int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- keep your existing admin check pattern
  if not public.is_erp_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    c.table_schema::text,
    c.table_name::text,
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.ordinal_position::int
  from information_schema.columns c
  where c.table_schema = 'public'
    and (p_table_name is null or c.table_name = p_table_name)
    and c.table_name like 'erp_%'
  order by c.table_name, c.ordinal_position;
end;
$$;

revoke all on function public.erp_dev_schema_columns(text) from public;
grant execute on function public.erp_dev_schema_columns(text) to authenticated;
