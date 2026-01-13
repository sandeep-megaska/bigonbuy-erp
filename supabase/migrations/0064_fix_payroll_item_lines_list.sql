-- Fix payroll item lines list RPC: remove invalid array_agg usage
-- Return rows directly.

drop function if exists public.erp_payroll_item_lines_list(uuid);

create function public.erp_payroll_item_lines_list(p_payroll_item_id uuid)
returns setof public.erp_payroll_item_lines
language sql
security definer
set search_path = public
as $$
  select l.*
  from public.erp_payroll_item_lines l
  where l.company_id = public.erp_current_company_id()
    and l.payroll_item_id = p_payroll_item_id
  order by l.created_at asc;
$$;

revoke all on function public.erp_payroll_item_lines_list(uuid) from public;
grant execute on function public.erp_payroll_item_lines_list(uuid) to authenticated;

notify pgrst, 'reload schema';
