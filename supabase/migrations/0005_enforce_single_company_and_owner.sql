-- Enforce single company and single owner
do $$
begin
  delete from public.erp_company_users
  where company_id <> 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
end
$$;

do $$
declare
  v_canonical_company constant uuid := 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
begin
  with owners as (
    select id
    from public.erp_company_users
    where company_id = v_canonical_company
      and role_key = 'owner'
    order by created_at asc
    offset 1
  )
  update public.erp_company_users
     set role_key = 'admin',
         updated_at = now()
   where id in (select id from owners);
end
$$;

create unique index if not exists erp_company_users_owner_unique
  on public.erp_company_users (company_id)
  where role_key = 'owner';

create or replace function public.erp_bootstrap_owner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Bootstrap disabled: system already initialized';
end;
$$;

revoke all on function public.erp_bootstrap_owner() from public;
grant execute on function public.erp_bootstrap_owner() to authenticated;
