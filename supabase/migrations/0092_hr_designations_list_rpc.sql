-- 0092_hr_designations_list_rpc.sql
-- Add missing list RPC used by UI and refresh PostgREST schema cache

begin;

drop function if exists public.erp_hr_designations_list(boolean);

create or replace function public.erp_hr_designations_list(
  p_include_inactive boolean default false
)
returns table (
  id uuid,
  code text,
  name text,
  description text,
  is_active boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.code,
    d.name,
    d.description,
    d.is_active,
    d.updated_at
  from public.erp_hr_designations d
  where d.company_id = public.erp_current_company_id()
    and (p_include_inactive or d.is_active = true)
  order by d.name asc, d.code asc;
$$;

revoke all on function public.erp_hr_designations_list(boolean) from public;
grant execute on function public.erp_hr_designations_list(boolean) to authenticated;

-- Refresh PostgREST schema cache
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then null;
end $$;

commit;
