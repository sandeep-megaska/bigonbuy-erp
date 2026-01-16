begin;

update public.erp_hr_employee_exits
   set status = 'draft'
 where status = 'submitted';

update public.erp_hr_employee_exits
   set status = 'rejected'
 where status = 'withdrawn';

alter table public.erp_hr_employee_exits
  drop constraint if exists erp_hr_employee_exits_status_check;

alter table public.erp_hr_employee_exits
  add constraint erp_hr_employee_exits_status_check
    check (status in ('draft', 'approved', 'rejected', 'completed'));

alter table public.erp_hr_employee_exits
  add column if not exists payment_notes text;

create unique index if not exists erp_hr_employee_exits_one_active_per_employee
  on public.erp_hr_employee_exits(company_id, employee_id)
  where status in ('draft', 'approved');

create or replace function public.erp_hr_exit_create_draft(
  p_employee_id uuid,
  p_exit_type_id uuid,
  p_exit_reason_id uuid default null,
  p_last_working_day date,
  p_notice_period_days int default null,
  p_notice_waived boolean default false,
  p_notes text default null,
  p_initiated_on date default current_date,
  p_manager_employee_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_exit_id uuid;
  v_manager_employee_id uuid;
begin
  perform public.erp_require_hr_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_exit_type_id is null then
    raise exception 'exit_type_id is required';
  end if;

  if p_last_working_day is null then
    raise exception 'last_working_day is required';
  end if;

  if exists (
    select 1
    from public.erp_hr_employee_exits e
    where e.company_id = v_company_id
      and e.employee_id = p_employee_id
      and e.status in ('draft', 'approved')
  ) then
    raise exception 'An active exit already exists for this employee.';
  end if;

  if not exists (
    select 1
    from public.erp_employees e
    where e.id = p_employee_id
      and e.company_id = v_company_id
  ) then
    raise exception 'Invalid employee_id';
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

  if p_manager_employee_id is not null then
    v_manager_employee_id := p_manager_employee_id;
  else
    select j.manager_employee_id
      into v_manager_employee_id
    from public.erp_employee_jobs j
    where j.company_id = v_company_id
      and j.employee_id = p_employee_id
    order by j.effective_from desc, j.created_at desc
    limit 1;
  end if;

  insert into public.erp_hr_employee_exits (
    company_id,
    employee_id,
    exit_type_id,
    exit_reason_id,
    initiated_by_user_id,
    status,
    initiated_on,
    last_working_day,
    notice_period_days,
    notice_waived,
    manager_employee_id,
    notes
  ) values (
    v_company_id,
    p_employee_id,
    p_exit_type_id,
    p_exit_reason_id,
    v_actor,
    'draft',
    coalesce(p_initiated_on, current_date),
    p_last_working_day,
    p_notice_period_days,
    coalesce(p_notice_waived, false),
    v_manager_employee_id,
    p_notes
  )
  returning id into v_exit_id;

  return v_exit_id;
end;
$$;

revoke all on function public.erp_hr_exit_create_draft(
  uuid,
  uuid,
  uuid,
  date,
  int,
  boolean,
  text,
  date,
  uuid
) from public;

grant execute on function public.erp_hr_exit_create_draft(
  uuid,
  uuid,
  uuid,
  date,
  int,
  boolean,
  text,
  date,
  uuid
) to authenticated;

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

create or replace function public.erp_hr_exit_get(p_exit_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exit', to_jsonb(e),
    'employee', to_jsonb(emp),
    'manager', to_jsonb(mgr),
    'exit_type', to_jsonb(et),
    'exit_reason', to_jsonb(er)
  )
  from public.erp_hr_employee_exits e
  join public.erp_employees emp
    on emp.id = e.employee_id
  left join public.erp_employees mgr
    on mgr.id = e.manager_employee_id
  left join public.erp_hr_employee_exit_types et
    on et.id = e.exit_type_id
  left join public.erp_hr_employee_exit_reasons er
    on er.id = e.exit_reason_id
  where e.id = p_exit_id
    and e.company_id = public.erp_current_company_id();
$$;

revoke all on function public.erp_hr_exit_get(uuid) from public;

grant execute on function public.erp_hr_exit_get(uuid) to authenticated;

commit;
