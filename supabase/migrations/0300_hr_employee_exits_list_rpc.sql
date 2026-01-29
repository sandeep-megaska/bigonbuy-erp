-- Canonical HR exits list RPC scoped by current company

create or replace function public.erp_hr_employee_exits_list(
  p_month text default null,
  p_status text default null,
  p_query text default null
) returns table(
  id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  status text,
  last_working_day date,
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
    e.employee_id,
    emp.employee_code,
    emp.full_name as employee_name,
    e.status,
    e.last_working_day,
    e.created_at,
    e.updated_at
  from public.erp_hr_employee_exits e
  left join public.erp_employees emp
    on emp.id = e.employee_id
    and emp.company_id = e.company_id
  where e.company_id = public.erp_current_company_id()
    and (
      nullif(trim(coalesce(p_month, '')), '') is null
      or to_char(e.last_working_day, 'YYYY-MM') = p_month
    )
    and (
      nullif(trim(coalesce(p_status, '')), '') is null
      or e.status = p_status
    )
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or emp.employee_code ilike '%' || p_query || '%'
      or emp.full_name ilike '%' || p_query || '%'
    )
  order by e.updated_at desc nulls last, e.created_at desc;
$$;

revoke all on function public.erp_hr_employee_exits_list(text, text, text) from public;

grant execute on function public.erp_hr_employee_exits_list(text, text, text) to authenticated;
