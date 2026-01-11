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
set search_path=public
as $$
  select
    e.id,
    coalesce(nullif(e.employee_code,''), nullif(e.employee_no,'')) as employee_code,
    e.full_name,
    coalesce(nullif(e.work_email,''), nullif(e.personal_email,'')) as email,
    e.user_id,
    cu.role_key,
    e.manager_employee_id,
    m.full_name as manager_name,
    (
      e.exit_date is null
      and coalesce(lower(e.lifecycle_status),'active') not in ('inactive','terminated','exited','left','disabled')
      and coalesce(lower(e.status),'active') not in ('inactive','terminated','exited','left','disabled')
    ) as is_active,
    e.created_at,
    e.updated_at
  from public.erp_employees e
  left join public.erp_company_users cu
    on cu.company_id = e.company_id
   and cu.user_id = e.user_id
  left join public.erp_employees m
    on m.company_id = e.company_id
   and m.id = e.manager_employee_id
  where e.company_id = public.erp_current_company_id()
  order by
    (
      e.exit_date is null
      and coalesce(lower(e.lifecycle_status),'active') not in ('inactive','terminated','exited','left','disabled')
      and coalesce(lower(e.status),'active') not in ('inactive','terminated','exited','left','disabled')
    ) desc,
    e.full_name asc;
$$;

create or replace function public.erp_hr_employees_managers_list()
returns table(id uuid, full_name text)
language sql
stable
security definer
set search_path=public
as $$
  select e.id, e.full_name
  from public.erp_employees e
  where e.company_id = public.erp_current_company_id()
    and (
      e.exit_date is null
      and coalesce(lower(e.lifecycle_status),'active') not in ('inactive','terminated','exited','left','disabled')
      and coalesce(lower(e.status),'active') not in ('inactive','terminated','exited','left','disabled')
    )
  order by e.full_name asc;
$$;

revoke all on function public.erp_hr_employees_list() from public;
grant execute on function public.erp_hr_employees_list() to authenticated;
revoke all on function public.erp_hr_employees_managers_list() from public;
grant execute on function public.erp_hr_employees_managers_list() to authenticated;

notify pgrst, 'reload schema';
