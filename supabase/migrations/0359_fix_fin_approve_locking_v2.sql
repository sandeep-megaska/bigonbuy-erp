-- 0359_fix_fin_approve_locking_v2.sql
-- Fix: FOR UPDATE cannot be applied to the nullable side of an outer join.
-- Root cause: erp_fin_approve / erp_fin_reject used LEFT JOIN ... FOR UPDATE.
-- Fix: lock ONLY erp_fin_approvals row (single-table) then update.

-- Drop with exact signature (adjust if your DB signature differs)
drop function if exists public.erp_fin_approve(uuid, uuid, text);
drop function if exists public.erp_fin_reject(uuid, uuid, text);

create function public.erp_fin_approve(
  p_company_id uuid,
  p_approval_id uuid,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  -- Lock ONLY approvals row (NO joins, NO views)
  select a.state
    into v_state
  from public.erp_fin_approvals a
  where a.company_id = p_company_id
    and a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval not found';
  end if;

  -- Idempotent: if already reviewed, return current state
  if v_state <> 'submitted' then
    return jsonb_build_object('ok', true, 'state', v_state);
  end if;

  update public.erp_fin_approvals
     set state = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_comment = p_comment
   where company_id = p_company_id
     and id = p_approval_id;

  return jsonb_build_object('ok', true, 'state', 'approved');
end;
$$;

create function public.erp_fin_reject(
  p_company_id uuid,
  p_approval_id uuid,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  -- Lock ONLY approvals row (NO joins, NO views)
  select a.state
    into v_state
  from public.erp_fin_approvals a
  where a.company_id = p_company_id
    and a.id = p_approval_id
  for update;

  if not found then
    raise exception 'approval not found';
  end if;

  if v_state <> 'submitted' then
    return jsonb_build_object('ok', true, 'state', v_state);
  end if;

  update public.erp_fin_approvals
     set state = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_comment = p_comment
   where company_id = p_company_id
     and id = p_approval_id;

  return jsonb_build_object('ok', true, 'state', 'rejected');
end;
$$;

grant execute on function public.erp_fin_approve(uuid, uuid, text) to authenticated;
grant execute on function public.erp_fin_reject(uuid, uuid, text) to authenticated;
