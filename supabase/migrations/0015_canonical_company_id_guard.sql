-- Canonical company id is enforced by chk_erp_company_users_single_company
create or replace function public.erp_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid
$$;

revoke all on function public.erp_current_company_id() from public;
grant execute on function public.erp_current_company_id() to authenticated;
