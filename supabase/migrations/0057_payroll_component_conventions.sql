-- Payroll component conventions and defaults

-- Ensure component_type constraint is present and calc_type supports variable entries
alter table public.erp_salary_components
  drop constraint if exists erp_salary_components_type_check;

alter table public.erp_salary_components
  add constraint erp_salary_components_type_check
    check (component_type in ('earning', 'deduction'));

alter table public.erp_salary_components
  alter column calc_type drop not null,
  alter column calc_type drop default;

alter table public.erp_salary_components
  drop constraint if exists erp_salary_components_calc_check;

alter table public.erp_salary_components
  add constraint erp_salary_components_calc_check
    check (calc_type is null or calc_type in ('fixed', 'percent', 'variable'));

-- Seed default payroll components for a salary structure
create or replace function public.erp_payroll_seed_default_components_for_structure(p_structure_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_structure_id uuid;
begin
  perform public.erp_require_hr_writer();

  if p_structure_id is null then
    raise exception 'structure_id is required';
  end if;

  select s.id
    into v_structure_id
    from public.erp_salary_structures s
   where s.id = p_structure_id
     and s.company_id = v_company_id;

  if v_structure_id is null then
    raise exception 'Salary structure not found';
  end if;

  with defaults as (
    select *
    from (
      values
        ('BASIC', 'Basic', 'earning', null, true),
        ('HRA', 'House Rent Allowance', 'earning', null, true),
        ('ALLOW', 'Allowance', 'earning', null, true),
        ('OT', 'Overtime', 'earning', 'variable', true),
        ('PF_EE', 'Provident Fund (Employee)', 'deduction', null, false),
        ('ESI_EE', 'ESI (Employee)', 'deduction', null, false),
        ('PT', 'Professional Tax', 'deduction', null, false),
        ('TDS', 'TDS', 'deduction', null, false)
    ) as v(code, name, component_type, calc_type, is_taxable)
  )
  insert into public.erp_salary_components (
    company_id,
    structure_id,
    name,
    code,
    component_type,
    calc_type,
    default_amount,
    is_taxable,
    is_active
  )
  select
    v_company_id,
    p_structure_id,
    d.name,
    d.code,
    d.component_type,
    d.calc_type,
    null,
    d.is_taxable,
    true
  from defaults d
  where not exists (
    select 1
      from public.erp_salary_components sc
     where sc.structure_id = p_structure_id
       and sc.company_id = v_company_id
       and sc.code = d.code
  );
end
$$;

revoke all on function public.erp_payroll_seed_default_components_for_structure(uuid) from public;
grant execute on function public.erp_payroll_seed_default_components_for_structure(uuid) to authenticated;

notify pgrst, 'reload schema';
