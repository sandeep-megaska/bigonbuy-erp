-- 0449_mfg_prod1_standardize_reverse_rpc.sql
-- Make erp_mfg_stage_consumption_reverse_v1 match ERP UI signature:
--   (actor_user_id, client_reverse_id, consumption_batch_id, reason)
-- Move canonical to ..._core_v1 and remove conflicting overloads.

-- 1) Create core function (canonical execution order)
create or replace function public.erp_mfg_stage_consumption_reverse_core_v1(
  p_consumption_batch_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_reverse_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_mfg_stage_consumption_reverse_v1(
    p_consumption_batch_id,
    p_actor_user_id,
    p_reason,
    p_client_reverse_id
  );
end;
$$;

-- 2) Drop any existing reverse_v1 overloads that can conflict
drop function if exists public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid);

-- 3) Recreate reverse_v1 with UI signature (the name ERP already calls)
create or replace function public.erp_mfg_stage_consumption_reverse_v1(
  p_actor_user_id uuid,
  p_client_reverse_id uuid,
  p_consumption_batch_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_mfg_stage_consumption_reverse_core_v1(
    p_consumption_batch_id,
    p_actor_user_id,
    p_reason,
    p_client_reverse_id
  );
end;
$$;

-- 4) Grants
revoke all on function public.erp_mfg_stage_consumption_reverse_core_v1(uuid, uuid, text, uuid) from public;
revoke all on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, uuid, text) from public;

grant execute on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_reverse_core_v1(uuid, uuid, text, uuid) to service_role;

select pg_notify('pgrst', 'reload schema');
