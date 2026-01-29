-- Attendance month effective updates (add PK + get RPC)

alter table public.erp_attendance_month_effective
  add column if not exists id uuid default gen_random_uuid();

update public.erp_attendance_month_effective
   set id = gen_random_uuid()
 where id is null;

alter table public.erp_attendance_month_effective
  alter column id set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_attendance_month_effective_pkey'
       and conrelid = 'public.erp_attendance_month_effective'::regclass
  ) then
    alter table public.erp_attendance_month_effective
      add constraint erp_attendance_month_effective_pkey primary key (id);
  end if;
end
$$;

create or replace function public.erp_attendance_month_effective_get(
  p_month date,
  p_employee_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date;
  v_result jsonb;
begin
  perform public.erp_require_hr_reader();

  if p_employee_id is null then
    raise exception 'Employee is required';
  end if;

  v_month := date_trunc('month', p_month)::date;

  perform 1
    from public.erp_employees e
   where e.company_id = v_company_id
     and e.id = p_employee_id;

  if not found then
    raise exception 'Employee not found for current company';
  end if;

  select to_jsonb(e)
    into v_result
    from public.erp_attendance_month_effective e
   where e.company_id = v_company_id
     and e.employee_id = p_employee_id
     and e.month = v_month
   limit 1;

  return v_result;
end;
$$;

revoke all on function public.erp_attendance_month_effective_get(date, uuid) from public;
grant execute on function public.erp_attendance_month_effective_get(date, uuid) to authenticated;
