-- 0084_fix_employee_salary_assign_effective_from.sql
-- Prevent backdated salary assignment that would violate effective_to >= effective_from.

begin;

drop function if exists public.erp_employee_salary_assign(uuid,uuid,date,numeric,text);

create or replace function public.erp_employee_salary_assign(
  p_employee_id uuid,
  p_salary_structure_id uuid,
  p_effective_from date,
  p_ctc_monthly numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_prev_id uuid;
  v_prev_effective_from date;
  v_new_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_employee_id is null then
    raise exception 'employee_id is required';
  end if;

  if p_salary_structure_id is null then
    raise exception 'salary_structure_id is required';
  end if;

  if p_effective_from is null then
    raise exception 'effective_from is required';
  end if;

  if p_ctc_monthly is null or p_ctc_monthly <= 0 then
    raise exception 'ctc_monthly must be > 0';
  end if;

  -- Find current active assignment (effective_to is null)
  select a.id, a.effective_from
    into v_prev_id, v_prev_effective_from
  from public.erp_employee_salary_assignments a
  where a.company_id = v_company_id
    and a.employee_id = p_employee_id
    and a.effective_to is null
  order by a.effective_from desc
  limit 1;

  -- Block backdated changes that would make previous row invalid
  if v_prev_id is not null and p_effective_from <= v_prev_effective_from then
    raise exception
      'effective_from (%) must be after current assignment effective_from (%) for this employee. If you need backdating, edit/delete the current assignment first.',
      p_effective_from, v_prev_effective_from;
  end if;

  -- Close previous active assignment (safe now)
  if v_prev_id is not null then
    update public.erp_employee_salary_assignments
      set effective_to = (p_effective_from - 1),
          updated_at = now(),
          updated_by = v_actor
    where company_id = v_company_id
      and id = v_prev_id;
  end if;

  -- Insert new assignment
  insert into public.erp_employee_salary_assignments(
    company_id, employee_id, salary_structure_id,
    effective_from, effective_to,
    ctc_monthly, notes,
    created_at, created_by
  ) values (
    v_company_id, p_employee_id, p_salary_structure_id,
    p_effective_from, null,
    p_ctc_monthly, p_notes,
    now(), v_actor
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

commit;
