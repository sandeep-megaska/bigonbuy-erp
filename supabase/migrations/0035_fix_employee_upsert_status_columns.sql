create or replace function public.erp_hr_employee_upsert(
     p_full_name text,
     p_id uuid default null,
     p_employee_code text default null,
     p_user_id uuid default null,
     p_manager_employee_id uuid default null,
     p_is_active boolean default true
   ) returns uuid
   language plpgsql
   security definer
   set search_path=public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid;
  v_lifecycle_status text := case when p_is_active then 'active' else 'inactive' end;
begin
  -- HR-only authorization
  perform public.erp_require_hr_writer();

  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Full name is required';
  end if;

  -- validate manager chain if helper exists
  if to_regprocedure('public.erp_hr_validate_manager_chain(uuid,uuid)') is not null then
    if p_id is not null then
      perform public.erp_hr_validate_manager_chain(p_id, p_manager_employee_id);
    end if;
  end if;

  if p_id is null then
    insert into public.erp_employees (
      company_id,
      full_name,
      employee_code,
      user_id,
      manager_employee_id,
      lifecycle_status,
      status
    )
    values (
      v_company_id,
      p_full_name,
      p_employee_code,
      p_user_id,
      p_manager_employee_id,
      v_lifecycle_status,
      v_lifecycle_status
    )
    returning id into v_employee_id;
  else
    update public.erp_employees e
      set full_name = p_full_name,
          employee_code = p_employee_code,
          user_id = p_user_id,
          manager_employee_id = p_manager_employee_id,
          lifecycle_status = v_lifecycle_status,
          status = v_lifecycle_status,
          updated_at = now()
    where e.id = p_id
      and e.company_id = v_company_id
    returning e.id into v_employee_id;

    if v_employee_id is null then
      raise exception 'Employee not found';
    end if;
  end if;

  -- post-insert manager chain validation
  if to_regprocedure('public.erp_hr_validate_manager_chain(uuid,uuid)') is not null then
    perform public.erp_hr_validate_manager_chain(v_employee_id, p_manager_employee_id);
  end if;

  return v_employee_id;
end;
$$;

revoke all on function public.erp_hr_employee_upsert(text,uuid,text,uuid,uuid,boolean) from public;
grant execute on function public.erp_hr_employee_upsert(text,uuid,text,uuid,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
