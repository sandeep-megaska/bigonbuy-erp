-- 0195_fix_require_company_user.sql
-- Creates missing auth/company membership guard used by settings RPCs.

create or replace function public.erp_require_company_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_uid
      and coalesce(cu.is_active, true) = true
  ) then
    raise exception 'Not a company user';
  end if;
end;
$$;

grant execute on function public.erp_require_company_user() to authenticated;
