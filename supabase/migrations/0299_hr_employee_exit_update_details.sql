-- Allow updating draft exit details through a SECURITY DEFINER RPC

create or replace function public.erp_hr_employee_exit_update_details(
  p_exit_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid default null,
  p_last_working_day date default null,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_exit_company_id uuid;
  v_exit_status text;
begin
  perform public.erp_require_hr_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_exit_id is null then
    raise exception 'exit_id is required';
  end if;

  if p_exit_type_id is null then
    raise exception 'exit_type_id is required';
  end if;

  select e.company_id, e.status
    into v_exit_company_id, v_exit_status
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id;

  if v_exit_company_id is null or v_exit_company_id <> v_company_id then
    raise exception 'Exit request not found';
  end if;

  if v_exit_status not in ('draft', 'approved') then
    raise exception 'Only draft or approved exit requests can be updated';
  end if;

  if not exists (
    select 1
    from public.erp_hr_employee_exit_types t
    where t.id = p_exit_type_id
      and t.company_id = v_company_id
      and t.is_active
  ) then
    raise exception 'Invalid exit_type_id';
  end if;

  if p_exit_reason_id is not null then
    if not exists (
      select 1
      from public.erp_hr_employee_exit_reasons r
      where r.id = p_exit_reason_id
        and r.company_id = v_company_id
        and r.is_active
    ) then
      raise exception 'Invalid exit_reason_id';
    end if;
  end if;

  update public.erp_hr_employee_exits
     set exit_type_id = p_exit_type_id,
         exit_reason_id = p_exit_reason_id,
         last_working_day = coalesce(p_last_working_day, last_working_day),
         notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_exit_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_employee_exit_update_details(uuid, uuid, uuid, date, text) from public;

grant execute on function public.erp_hr_employee_exit_update_details(uuid, uuid, uuid, date, text) to authenticated;
