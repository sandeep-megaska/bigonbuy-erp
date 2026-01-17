begin;

alter table public.erp_salary_structures
  add column if not exists effective_from date not null default current_date;

drop function if exists public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, uuid);
drop function if exists public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, date, uuid);

create or replace function public.erp_salary_structure_upsert(
  p_name text,
  p_is_active boolean default true,
  p_notes text default null,
  p_basic_pct numeric default 50,
  p_hra_pct_of_basic numeric default 40,
  p_allowances_mode text default 'remainder',
  p_effective_from date default null,
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
  v_allowances_mode text := coalesce(nullif(lower(btrim(coalesce(p_allowances_mode, ''))), ''), 'remainder');
  v_effective_from date := coalesce(p_effective_from, current_date);
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

  if v_allowances_mode not in ('remainder') then
    raise exception 'allowances_mode must be remainder';
  end if;

  if p_id is null then
    insert into public.erp_salary_structures (
      company_id,
      name,
      is_active,
      notes,
      basic_pct,
      hra_pct_of_basic,
      allowances_mode,
      effective_from,
      created_at,
      created_by
    )
    values (
      v_company_id,
      trim(p_name),
      coalesce(p_is_active, true),
      p_notes,
      coalesce(p_basic_pct, 50),
      coalesce(p_hra_pct_of_basic, 40),
      v_allowances_mode,
      v_effective_from,
      now(),
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_salary_structures s
    set name = trim(p_name),
        is_active = coalesce(p_is_active, true),
        notes = p_notes,
        basic_pct = coalesce(p_basic_pct, s.basic_pct),
        hra_pct_of_basic = coalesce(p_hra_pct_of_basic, s.hra_pct_of_basic),
        allowances_mode = v_allowances_mode,
        effective_from = coalesce(p_effective_from, s.effective_from),
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

revoke all on function public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, date, uuid) from public;
grant execute on function public.erp_salary_structure_upsert(text, boolean, text, numeric, numeric, text, date, uuid) to authenticated;

commit;
