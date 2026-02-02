-- 0358_fix_fin_approve_locking.sql
-- Fix: FOR UPDATE cannot be used with outer joins (approvals approve/reject)

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

  -- Lock ONLY the approval row (no joins!)
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
    return jsonb_build_object('ok', true, 'state', v_state, 'message', 'already reviewed');
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
    return jsonb_build_object('ok', true, 'state', v_state, 'message', 'already reviewed');
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
