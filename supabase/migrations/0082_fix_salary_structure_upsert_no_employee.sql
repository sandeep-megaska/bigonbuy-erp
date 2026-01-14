-- 0082_fix_salary_structure_upsert_no_employee.sql
-- Ensure upsert does not require/set employee_id

begin;

drop function if exists public.erp_salary_structure_upsert(text,boolean,text,uuid);

create or replace function public.erp_salary_structure_upsert(
  p_name text,
  p_is_active boolean default true,
  p_notes text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
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

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_id is null then
    insert into public.erp_salary_structures (
      company_id, name, is_active, notes, created_at, created_by
    )
    values (
      v_company_id, trim(p_name), coalesce(p_is_active,true), p_notes, now(), v_actor
    )
    returning id into v_id;
  else
    update public.erp_salary_structures s
    set name = trim(p_name),
        is_active = coalesce(p_is_active,true),
        notes = p_notes,
        updated_at = now(),
        updated_by = v_actor
    where s.company_id = v_company_id
      and s.id = p_id
    returning s.id into v_id;

    if v_id is null then
      raise exception 'Salary structure not found';
    end if;
  end if;

  return v_id;
end;
$$;

commit;
