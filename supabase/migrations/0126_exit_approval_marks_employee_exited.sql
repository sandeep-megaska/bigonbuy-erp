begin;

create or replace function public.erp_hr_exit_set_status(
  p_exit_id uuid,
  p_status text,
  p_rejection_reason text default null,
  p_payment_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_employee_id uuid;
  v_exit_status text;
  v_last_working_day date;
  v_manager_employee_id uuid;
  v_is_hr boolean;
  v_is_manager boolean;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_exit_id is null then
    raise exception 'exit_id is required';
  end if;

  if p_status is null then
    raise exception 'status is required';
  end if;

  select e.employee_id,
         e.status,
         e.last_working_day,
         e.manager_employee_id
    into v_employee_id,
         v_exit_status,
         v_last_working_day,
         v_manager_employee_id
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id
    and e.company_id = v_company_id;

  if v_employee_id is null then
    raise exception 'Exit request not found';
  end if;

  if p_status not in ('approved', 'rejected', 'completed') then
    raise exception 'Invalid status transition';
  end if;

  select public.erp_is_hr_admin(v_actor) into v_is_hr;

  if p_status in ('approved', 'rejected') then
    if not v_is_hr then
      if v_manager_employee_id is null then
        select j.manager_employee_id
          into v_manager_employee_id
        from public.erp_employee_jobs j
        where j.company_id = v_company_id
          and j.employee_id = v_employee_id
        order by j.effective_from desc, j.created_at desc
        limit 1;
      end if;

      if v_manager_employee_id is not null then
        select exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = v_manager_employee_id
            and eu.user_id = v_actor
            and coalesce(eu.is_active, true)
        ) into v_is_manager;
      end if;
    end if;

    if not v_is_hr and not coalesce(v_is_manager, false) then
      raise exception 'Not authorized';
    end if;
  end if;

  if p_status = 'completed' and not v_is_hr then
    raise exception 'Not authorized';
  end if;

  if v_exit_status = 'draft' and p_status = 'approved' then
    update public.erp_hr_employee_exits
       set status = 'approved',
           approved_by_user_id = v_actor,
           approved_at = now()
     where id = p_exit_id
       and company_id = v_company_id
       and status = 'draft';

    if not found then
      raise exception 'Exit request must be in draft status';
    end if;

    update public.erp_employees
       set exit_date = v_last_working_day,
           lifecycle_status = 'exited'
     where id = v_employee_id
       and company_id = v_company_id;
  elsif v_exit_status = 'draft' and p_status = 'rejected' then
    update public.erp_hr_employee_exits
       set status = 'rejected',
           rejected_by_user_id = v_actor,
           rejected_at = now(),
           rejection_reason = p_rejection_reason
     where id = p_exit_id
       and company_id = v_company_id
       and status = 'draft';

    if not found then
      raise exception 'Exit request must be in draft status';
    end if;
  elsif v_exit_status = 'approved' and p_status = 'completed' then
    update public.erp_hr_employee_exits
       set status = 'completed',
           completed_by_user_id = v_actor,
           completed_at = now(),
           payment_notes = p_payment_notes
     where id = p_exit_id
       and company_id = v_company_id
       and status = 'approved';

    if not found then
      raise exception 'Exit request must be approved before completion';
    end if;

    update public.erp_employees
       set exit_date = v_last_working_day,
           lifecycle_status = 'exited'
     where id = v_employee_id
       and company_id = v_company_id;
  elsif v_exit_status in ('rejected', 'completed') then
    raise exception 'Exit request is already finalized';
  else
    raise exception 'Invalid status transition';
  end if;
end;
$$;

revoke all on function public.erp_hr_exit_set_status(uuid, text, text, text) from public;
grant execute on function public.erp_hr_exit_set_status(uuid, text, text, text) to authenticated;

commit;
