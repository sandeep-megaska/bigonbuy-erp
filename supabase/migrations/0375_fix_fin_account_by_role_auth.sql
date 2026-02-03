-- 0375_fix_fin_account_by_role_auth.sql
-- Allow service_role to resolve control-role accounts without user auth.
-- Forward-only patch; do NOT edit applied migrations.

begin;

create or replace function public.erp_fin_account_by_role(p_role text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := nullif(trim(lower(p_role)), '');
  v_account_id uuid;
begin
  -- Only enforce user-based finance reader when NOT service_role
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_reader();
  end if;

  if v_role is null then
    raise exception 'control role is required';
  end if;

  select a.id
    into v_account_id
    from public.erp_gl_accounts a
   where a.company_id = public.erp_current_company_id()
     and a.control_role = v_role;

  if v_account_id is null then
    raise exception 'COA control role not mapped: %', v_role;
  end if;

  return v_account_id;
end;
$function$;

revoke all on function public.erp_fin_account_by_role(text) from public;
grant execute on function public.erp_fin_account_by_role(text) to authenticated;

notify pgrst, 'reload schema';

commit;
