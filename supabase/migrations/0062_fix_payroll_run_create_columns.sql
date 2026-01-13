-- Fix erp_payroll_run_create to match erp_payroll_runs table (no created_by/updated_by)

create or replace function public.erp_payroll_run_create(
  p_year int,
  p_month int,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_run_id uuid;
begin
  perform public.erp_require_payroll_writer();

  if p_year is null or p_month is null then
    raise exception 'year and month are required';
  end if;

  if exists (
    select 1
    from public.erp_payroll_runs r
    where r.company_id = v_company_id
      and r.year = p_year
      and r.month = p_month
  ) then
    raise exception 'Payroll run already exists for this period';
  end if;

  insert into public.erp_payroll_runs (
    company_id,
    year,
    month,
    status,
    notes,
    created_at
  ) values (
    v_company_id,
    p_year,
    p_month,
    'draft',
    p_notes,
    now()
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.erp_payroll_run_create(int, int, text) from public;
grant execute on function public.erp_payroll_run_create(int, int, text) to authenticated;
