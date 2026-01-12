create or replace function public.erp_employee_profile(p_employee_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- If you already have a profile RPC, call it here:
  -- select public.erp_hr_employee_profile(p_employee_id);

  -- Fallback minimal profile (employee + contacts + addresses)
  select jsonb_build_object(
    'employee',
      (select to_jsonb(e)
       from public.erp_employees e
       where e.company_id = public.erp_current_company_id()
         and e.id = p_employee_id),
    'contacts',
      coalesce((
        select jsonb_agg(to_jsonb(c) order by c.is_primary desc, c.contact_type asc)
        from public.erp_employee_contacts c
        where c.company_id = public.erp_current_company_id()
          and c.employee_id = p_employee_id
      ), '[]'::jsonb),
    'addresses',
      coalesce((
        select jsonb_agg(to_jsonb(a) order by a.is_primary desc, a.address_type asc)
        from public.erp_employee_addresses a
        where a.company_id = public.erp_current_company_id()
          and a.employee_id = p_employee_id
      ), '[]'::jsonb)
  );
$$;

revoke all on function public.erp_employee_profile(uuid) from public;
grant execute on function public.erp_employee_profile(uuid) to authenticated;
