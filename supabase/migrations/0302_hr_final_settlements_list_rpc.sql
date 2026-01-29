begin;

drop function if exists public.erp_hr_final_settlements_list(date, date, text, text);

create function public.erp_hr_final_settlements_list(
  p_month text default null,
  p_status text default null,
  p_query text default null
) returns table(
  id uuid,
  exit_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  last_working_day date,
  status text,
  net_amount numeric,
  updated_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_month text := nullif(trim(coalesce(p_month, '')), '');
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  return query
  select
    fs.id as id,
    fs.exit_id as exit_id,
    e.id as employee_id,
    e.employee_code as employee_code,
    e.full_name as employee_name,
    ex.last_working_day as last_working_day,
    fs.status as status,
    case
      when count(i.id) = 0 then null
      else (
        coalesce(sum(case when i.kind in ('earning', 'earnings', 'credit') then i.amount else 0 end), 0)
        - coalesce(sum(case when i.kind in ('deduction', 'deductions', 'debit') then i.amount else 0 end), 0)
      )::numeric
    end as net_amount,
    fs.updated_at as updated_at,
    fs.created_at as created_at
  from public.erp_hr_final_settlements fs
  join public.erp_hr_employee_exits ex
    on ex.id = fs.exit_id
    and ex.company_id = v_company_id
  join public.erp_employees e
    on e.id = ex.employee_id
    and e.company_id = v_company_id
  left join public.erp_hr_final_settlement_items i
    on i.settlement_id = fs.id
    and i.company_id = v_company_id
  where fs.company_id = v_company_id
    and (
      v_month is null
      or to_char(coalesce(ex.last_working_day, fs.created_at::date), 'YYYY-MM') = v_month
    )
    and (
      v_status is null
      or fs.status = v_status
    )
    and (
      v_query is null
      or e.employee_code ilike '%' || v_query || '%'
      or e.full_name ilike '%' || v_query || '%'
    )
  group by fs.id, fs.exit_id, e.id, e.employee_code, e.full_name, ex.last_working_day, fs.status, fs.updated_at, fs.created_at
  order by fs.updated_at desc, fs.created_at desc;
end;
$$;

revoke all on function public.erp_hr_final_settlements_list from public;
grant execute on function public.erp_hr_final_settlements_list to authenticated;

commit;
