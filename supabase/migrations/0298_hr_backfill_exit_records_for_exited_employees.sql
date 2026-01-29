-- Backfill exit records for employees already marked exited/inactive

with candidate_employees as (
  select
    e.id as employee_id,
    e.company_id,
    coalesce(e.exit_date, e.updated_at::date, current_date) as last_working_day
  from public.erp_employees e
  where e.company_id is not null
    and (
      lower(coalesce(e.lifecycle_status, '')) = 'exited'
      or lower(coalesce(e.status, '')) in ('inactive', 'exited')
    )
    and not exists (
      select 1
      from public.erp_hr_employee_exits ex
      where ex.company_id = e.company_id
        and ex.employee_id = e.id
    )
), defaults as (
  select
    c.employee_id,
    c.company_id,
    c.last_working_day,
    (
      select t.id
      from public.erp_hr_employee_exit_types t
      where t.company_id = c.company_id
        and t.is_active
      order by t.sort_order asc, t.name asc
      limit 1
    ) as exit_type_id,
    (
      select cu.user_id
      from public.erp_company_users cu
      where cu.company_id = c.company_id
      order by cu.created_at asc
      limit 1
    ) as initiated_by_user_id,
    (
      select j.manager_employee_id
      from public.erp_employee_jobs j
      where j.company_id = c.company_id
        and j.employee_id = c.employee_id
      order by j.effective_from desc, j.created_at desc
      limit 1
    ) as manager_employee_id
  from candidate_employees c
)
insert into public.erp_hr_employee_exits (
  company_id,
  employee_id,
  exit_type_id,
  exit_reason_id,
  initiated_by_user_id,
  status,
  initiated_on,
  last_working_day,
  notice_waived,
  manager_employee_id,
  notes
)
select
  d.company_id,
  d.employee_id,
  d.exit_type_id,
  null,
  d.initiated_by_user_id,
  'completed',
  d.last_working_day,
  d.last_working_day,
  false,
  d.manager_employee_id,
  null
from defaults d
where d.exit_type_id is not null
  and d.initiated_by_user_id is not null;
