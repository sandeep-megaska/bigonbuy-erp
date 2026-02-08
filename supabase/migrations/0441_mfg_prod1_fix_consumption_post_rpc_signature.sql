-- 0441_mfg_prod1_fix_consumption_post_rpc_signature.sql
-- Fix ERP UI RPC resolution: UI calls erp_mfg_stage_consumption_post_v1(actor_user_id, reason, stage_event_id)
-- Canonical function is expected to be (stage_event_id, actor_user_id, reason).
-- Add overload wrapper (uuid, text, uuid) -> delegates to canonical.

create or replace function public.erp_mfg_stage_consumption_post_v1(
  p_actor_user_id uuid,
  p_reason text,
  p_stage_event_id uuid
) returns table(
  consumption_batch_id uuid,
  posted_lines_count int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select *
  from public.erp_mfg_stage_consumption_post_v1(
    p_stage_event_id,
    p_actor_user_id,
    p_reason
  );
end;
$$;

-- Privileges (match your existing pattern)
revoke all on function public.erp_mfg_stage_consumption_post_v1(uuid, text, uuid) from public;
grant execute on function public.erp_mfg_stage_consumption_post_v1(uuid, text, uuid) to authenticated, service_role;

-- Reload PostgREST schema cache (Supabase)
select pg_notify('pgrst', 'reload schema');
