-- 0443_mfg_prod1_fix_consumption_post_rpc_ambiguity.sql
-- Resolve ambiguous overloaded RPC erp_mfg_stage_consumption_post_v1.
-- Keep ONLY the UI-facing signature under that name:
--   (p_actor_user_id uuid, p_reason text, p_stage_event_id uuid)
-- Move canonical implementation to erp_mfg_stage_consumption_post_core_v1 and delegate.

-- 1) Core canonical implementation (stable internal signature)
create or replace function public.erp_mfg_stage_consumption_post_core_v1(
  p_stage_event_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns table(
  consumption_batch_id uuid,
  posted_lines_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  -- Delegate to your existing canonical implementation if it exists under v1 signature.
  -- If you already created canonical v1 in 0442, this core simply calls it.
  return query
  select *
  from public.erp_mfg_stage_consumption_post_v1(
    p_stage_event_id,
    p_actor_user_id,
    p_reason
  );
end;
$$;

-- 2) UI-facing signature (what ERP calls): (actor_user_id, reason, stage_event_id)
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
  from public.erp_mfg_stage_consumption_post_core_v1(
    p_stage_event_id,
    p_actor_user_id,
    p_reason
  );
end;
$$;

-- 3) Drop the conflicting overload under the same name (canonical signature)
drop function if exists public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text);

-- 4) Grants
revoke all on function public.erp_mfg_stage_consumption_post_core_v1(uuid, uuid, text) from public;
revoke all on function public.erp_mfg_stage_consumption_post_v1(uuid, text, uuid) from public;

grant execute on function public.erp_mfg_stage_consumption_post_v1(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_post_core_v1(uuid, uuid, text) to service_role;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
