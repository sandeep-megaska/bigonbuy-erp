create or replace function public.erp_hr_employees_list()
returns table(
  id uuid,
  employee_code text,
  full_name text,
  email text,
  user_id uuid,
  role_key text,
  manager_employee_id uuid,
  manager_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.employee_code,
    e.full_name,
    null::text as email,
    e.user_id,
    cu.role_key,
    e.manager_employee_id,
    m.full_name as manager_name,
    e.is_active,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_company_users cu
    on cu.company_id = e.company_id and cu.user_id = e.user_id
  left join public.erp_employees m
    on m.id = e.manager_employee_id and m.company_id = e.company_id
  where e.company_id = public.erp_current_company_id()
  order by e.is_active desc, e.full_name asc;
$$;

create or replace function public.erp_hr_employees_managers_list()
returns table(
  id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.full_name
  from public.erp_employees e
  where e.company_id = public.erp_current_company_id()
    and e.is_active = true
  order by e.full_name asc;
$$;

revoke all on function public.erp_hr_employees_list() from public;
grant execute on function public.erp_hr_employees_list() to authenticated;

revoke all on function public.erp_hr_employees_managers_list() from public;
grant execute on function public.erp_hr_employees_managers_list() to authenticated;

notify pgrst, 'reload schema';
