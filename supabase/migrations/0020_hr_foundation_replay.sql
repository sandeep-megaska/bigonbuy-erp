create or replace function public.erp_is_hr_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.user_id = uid
      and cu.company_id = public.erp_current_company_id()
      and cu.role_key in ('owner', 'admin', 'hr')
  );
$$;
