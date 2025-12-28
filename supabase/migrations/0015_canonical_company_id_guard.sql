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
-- Ensure canonical owner membership exists and is active
insert into public.erp_company_users (company_id, user_id, role_key, is_active, created_at, updated_at)
values (
  public.erp_current_company_id(),
  '9673523f-3485-4acc-97c4-6a4662e48743'::uuid,
  'owner',
  true,
  now(),
  now()
)
on conflict (company_id, user_id) do update
  set role_key = excluded.role_key,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at;
