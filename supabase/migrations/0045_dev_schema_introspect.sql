create or replace function public.erp_dev_schema_columns(p_table_name text default null)
returns table (
  table_schema text,
  table_name text,
  column_name text,
  data_type text,
  is_nullable text,
  ordinal_position integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  has_admin_func boolean := to_regprocedure('public.is_erp_admin(uuid)') is not null;
  is_authorized boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;

  if has_admin_func then
    is_authorized := public.is_erp_admin(auth.uid());
  else
    select exists (
      select 1
      from public.erp_user_roles ur
      where ur.user_id = auth.uid()
        and ur.role_key in ('owner', 'admin')
    )
    into is_authorized;
  end if;

  if coalesce(is_authorized, false) is not true then
    raise exception 'Not authorized';
  end if;

  return query
  select
    c.table_schema,
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.ordinal_position
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name like 'erp_%'
    and (p_table_name is null or c.table_name = p_table_name)
  order by c.table_name, c.ordinal_position;
end;
$$;

revoke all on function public.erp_dev_schema_columns(text) from public;
grant execute on function public.erp_dev_schema_columns(text) to authenticated;
