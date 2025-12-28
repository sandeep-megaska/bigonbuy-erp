-- Ensure key RPCs exist with correct signatures and authorization

-- Manager predicate (owner/admin/hr) using canonical company id
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.erp_companies
  limit 1;

  if v_company_id is null then
    return false;
  end if;

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' and auth.uid() <> uid then
    if not exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = auth.uid()
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner', 'admin', 'hr')
    ) then
      raise exception 'Not authorized: owner/admin/hr only';
    end if;
  end if;

  return exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  );
end;
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- Employee list RPC with canonical company selection and manager gate
