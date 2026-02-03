-- 0373_fix_expense_period_lock_detection.sql
-- Forward patch: improve period lock detection for expense posting.
-- 0372 is already applied; do NOT edit 0372.

begin;

create or replace function public.erp__expense_assert_period_open(
  p_company_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proc_oid oid;
  v_proc regprocedure;
  v_ret_type regtype;
  v_args text;
  v_name text;
  v_ok boolean;
begin
  -- 1) Try known candidates first (fast path)
  v_proc := to_regprocedure('public.erp_fin_period_lock_assert(uuid,date)');
  if v_proc is not null then
    execute format('select %s($1,$2)', v_proc) using p_company_id, p_date;
    return;
  end if;

  v_proc := to_regprocedure('public.erp_fin_assert_period_open(uuid,date)');
  if v_proc is not null then
    execute format('select %s($1,$2)', v_proc) using p_company_id, p_date;
    return;
  end if;

  v_proc := to_regprocedure('public.erp_fin_require_open_period(uuid,date)');
  if v_proc is not null then
    execute format('select %s($1,$2)', v_proc) using p_company_id, p_date;
    return;
  end if;

  v_proc := to_regprocedure('public.erp_fin_period_lock_check(uuid,date)');
  if v_proc is not null then
    execute format('select %s($1,$2)', v_proc) using p_company_id, p_date;
    return;
  end if;

  v_proc := to_regprocedure('public.erp_fin_period_lock_assert(date)');
  if v_proc is not null then
    execute format('select %s($1)', v_proc) using p_date;
    return;
  end if;

  v_proc := to_regprocedure('public.erp_fin_require_open_period(date)');
  if v_proc is not null then
    execute format('select %s($1)', v_proc) using p_date;
    return;
  end if;

  -- 2) Auto-detect: search for a plausible period lock function in public schema.
  -- We prefer functions with signatures (uuid,date) or (date) and names suggesting period/open/lock/close.
  select p.oid,
         p.proname,
         pg_get_function_identity_arguments(p.oid),
         p.prorettype::regtype
    into v_proc_oid, v_name, v_args, v_ret_type
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname ilike '%period%'
      or p.proname ilike '%month%'
      or p.proname ilike '%close%'
      or p.proname ilike '%lock%'
      or p.proname ilike '%open%'
    )
    and (
      -- exact argument patterns we can safely call
      pg_get_function_identity_arguments(p.oid) in ('uuid, date', 'date')
    )
    and (
      -- return type either boolean (is_open style) or void (assert style)
      p.prorettype::regtype in ('boolean'::regtype, 'void'::regtype)
    )
  order by
    -- prioritize names that look like asserts/checks for locks/close/open
    case
      when p.proname ilike '%assert%' then 0
      when p.proname ilike '%require%' then 1
      when p.proname ilike '%check%' then 2
      when p.proname ilike '%is_%open%' then 3
      when p.proname ilike '%open%' then 4
      else 9
    end,
    p.proname
  limit 1;

  if v_proc_oid is null then
    raise exception
      'Period lock enforcement function not found in schema. Define a public function that either asserts or returns boolean with args (uuid,date) or (date).';
  end if;

  -- 3) Call the detected function safely.
  if v_args = 'uuid, date' then
    if v_ret_type = 'void'::regtype then
      execute format('select public.%I($1,$2)', v_name) using p_company_id, p_date;
      return;
    else
      execute format('select public.%I($1,$2)', v_name) into v_ok using p_company_id, p_date;
      if coalesce(v_ok, false) = false then
        raise exception 'Period is locked/closed (function %).', v_name;
      end if;
      return;
    end if;
  elsif v_args = 'date' then
    if v_ret_type = 'void'::regtype then
      execute format('select public.%I($1)', v_name) using p_date;
      return;
    else
      execute format('select public.%I($1)', v_name) into v_ok using p_date;
      if coalesce(v_ok, false) = false then
        raise exception 'Period is locked/closed (function %).', v_name;
      end if;
      return;
    end if;
  end if;

  -- Should be unreachable due to filters above
  raise exception 'Unable to call detected period lock function %. Args=% Ret=%', v_name, v_args, v_ret_type;
end;
$$;

revoke all on function public.erp__expense_assert_period_open(uuid, date) from public;
grant execute on function public.erp__expense_assert_period_open(uuid, date) to authenticated;

notify pgrst, 'reload schema';

commit;
