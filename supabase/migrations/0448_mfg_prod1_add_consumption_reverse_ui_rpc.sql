-- 0448_mfg_prod1_add_consumption_reverse_ui_rpc.sql
-- ERP UI expects params in order: actor_user_id, client_reverse_id, consumption_batch_id, reason
-- We provide a separate UI RPC name to avoid overload ambiguity.

create or replace function public.erp_mfg_stage_consumption_reverse_ui_v1(
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
  return public.erp_mfg_stage_consumption_reverse_v1(
    p_consumption_batch_id,
    p_actor_user_id,
    p_reason,
    p_client_reverse_id
  );
end;
$$;

revoke all on function public.erp_mfg_stage_consumption_reverse_ui_v1(uuid, uuid, uuid, text) from public;
grant execute on function public.erp_mfg_stage_consumption_reverse_ui_v1(uuid, uuid, uuid, text) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
