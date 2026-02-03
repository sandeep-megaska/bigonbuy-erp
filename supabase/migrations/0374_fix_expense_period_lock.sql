-- 0374_fix_expense_period_lock.sql
-- Fix expense period-lock enforcement to use canonical finance lock function.
-- 0372 is already applied; forward-only patch.

begin;

create or replace function public.erp__expense_assert_period_open(
  p_company_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Canonical finance period lock enforcement
  perform public.erp_require_fin_open_period(p_company_id, p_date);
end;
$$;

revoke all on function public.erp__expense_assert_period_open(uuid, date) from public;
grant execute on function public.erp__expense_assert_period_open(uuid, date) to authenticated;

notify pgrst, 'reload schema';

commit;
