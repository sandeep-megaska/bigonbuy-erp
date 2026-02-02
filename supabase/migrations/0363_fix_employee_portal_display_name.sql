-- 0363_fix_employee_portal_display_name.sql
-- Fix employee portal auth user get: erp_employees uses full_name (not name)

create or replace function public.erp_employee_auth_user_get(
  p_employee_code text
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  password_hash text,
  is_active boolean,
  must_reset_password boolean,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_employee_code is null or trim(p_employee_code) = '' then
    raise exception 'employee_code is required';
  end if;

  return query
  select
    e.company_id,
    e.id as employee_id,
    e.employee_code,
    au.password_hash,
    au.is_active,
    au.must_reset_password,
    coalesce(nullif(e.full_name, ''), e.employee_code) as display_name
  from public.erp_employees e
  join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.employee_code = p_employee_code;
end;
$$;

revoke all on function public.erp_employee_auth_user_get(text) from public;
grant execute on function public.erp_employee_auth_user_get(text) to service_role;
