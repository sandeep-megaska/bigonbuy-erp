-- 0439_mfg_prod1_fix_stage_post_rpc_ambiguity.sql
-- Resolve ambiguous overloaded RPC erp_mfg_po_line_stage_post_v1.
-- Strategy:
-- 1) Move canonical implementation to a new name: erp_mfg_po_line_stage_post_core_v1
-- 2) Keep a single public RPC name (erp_mfg_po_line_stage_post_v1) with ONE signature (the UI signature)
-- 3) UI signature delegates to core.
-- 4) Drop the other overload to remove ambiguity.

-- 1) Create/replace the CORE implementation (single canonical signature, not called directly by vendor UI)
create or replace function public.erp_mfg_po_line_stage_post_core_v1(
  p_session_token text,
  p_po_line_id uuid,
  p_stage_code text,
  p_completed_qty_abs numeric,
  p_event_note text,
  p_client_event_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_vendor_id uuid;
  v_company_id uuid;

  v_stage_code text := upper(trim(coalesce(p_stage_code, '')));
  v_last_abs numeric(18,6) := 0;
  v_delta numeric(18,6);

  v_existing_id uuid;
  v_stage_event_id uuid;

  v_po_id uuid;
  v_ordered_qty numeric(18,6);
begin
  if coalesce(trim(p_session_token), '') = '' then
    raise exception 'Not authenticated';
  end if;

  if p_po_line_id is null or p_client_event_id is null then
    raise exception 'po_line_id and client_event_id are required';
  end if;

  if v_stage_code = '' then
    raise exception 'stage_code is required';
  end if;

  if coalesce(p_completed_qty_abs, -1) < 0 then
    raise exception 'completed_qty_abs must be >= 0';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  -- idempotency
  select ev.id
    into v_existing_id
  from public.erp_mfg_po_line_stage_events ev
  where ev.vendor_id = v_vendor_id
    and ev.client_event_id = p_client_event_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- validate PO line belongs to vendor
  select
    po.id as po_id,
    pol.ordered_qty::numeric(18,6) as ordered_qty
  into v_po_id, v_ordered_qty
  from public.erp_purchase_order_lines pol
  join public.erp_purchase_orders po
    on po.id = pol.purchase_order_id
   and po.company_id = pol.company_id
  where pol.id = p_po_line_id
    and po.company_id = v_company_id
    and po.vendor_id = v_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void')
  limit 1;

  if v_po_id is null then
    raise exception 'PO line not found for vendor';
  end if;

  if p_completed_qty_abs::numeric(18,6) > coalesce(v_ordered_qty, 0) then
    raise exception 'completed_qty_abs cannot exceed qty_ordered (%)', v_ordered_qty;
  end if;

  -- monotonic
  select ev.completed_qty_abs
    into v_last_abs
  from public.erp_mfg_po_line_stage_events ev
  where ev.company_id = v_company_id
    and ev.vendor_id = v_vendor_id
    and ev.po_line_id = p_po_line_id
    and upper(ev.stage_code) = v_stage_code
  order by ev.created_at desc, ev.id desc
  limit 1;

  v_last_abs := coalesce(v_last_abs, 0);

  if p_completed_qty_abs::numeric(18,6) < v_last_abs then
    raise exception 'Stage quantity must be monotonic. last_abs=% new_abs=%', v_last_abs, p_completed_qty_abs;
  end if;

  v_delta := (p_completed_qty_abs::numeric(18,6) - v_last_abs)::numeric(18,6);

  insert into public.erp_mfg_po_line_stage_events (
    company_id,
    vendor_id,
    po_id,
    po_line_id,
    stage_code,
    completed_qty_abs,
    completed_qty_delta,
    event_note,
    client_event_id,
    created_at,
    created_by_vendor_user_id
  ) values (
    v_company_id,
    v_vendor_id,
    v_po_id,
    p_po_line_id,
    v_stage_code,
    p_completed_qty_abs::numeric(18,6),
    v_delta,
    nullif(trim(coalesce(p_event_note, '')), ''),
    p_client_event_id,
    now(),
    null
  )
  returning id into v_stage_event_id;

  return v_stage_event_id;

exception
  when unique_violation then
    select ev.id
      into v_existing_id
    from public.erp_mfg_po_line_stage_events ev
    where ev.vendor_id = v_vendor_id
      and ev.client_event_id = p_client_event_id
    limit 1;

    if v_existing_id is not null then
      return v_existing_id;
    end if;

    raise;
end;
$$;

-- 2) Ensure ONLY ONE public RPC name exists: keep the UI signature and delegate to core
create or replace function public.erp_mfg_po_line_stage_post_v1(
  p_client_event_id uuid,
  p_completed_qty_abs numeric,
  p_event_note text,
  p_po_line_id uuid,
  p_session_token text,
  p_stage_code text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.erp_mfg_po_line_stage_post_core_v1(
    p_session_token,
    p_po_line_id,
    p_stage_code,
    p_completed_qty_abs,
    p_event_note,
    p_client_event_id
  );
end;
$$;

-- 3) Drop the ambiguous overload (the canonical signature under the SAME name)
-- This removes PostgREST ambiguity permanently.
drop function if exists public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid);

-- 4) Grants
revoke all on function public.erp_mfg_po_line_stage_post_core_v1(text, uuid, text, numeric, text, uuid) from public;
revoke all on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) from public;

-- Vendor portal uses anon for cookie auth
grant execute on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) to anon;

-- (Optional) allow service_role for ops/testing
grant execute on function public.erp_mfg_po_line_stage_post_v1(uuid, numeric, text, uuid, text, text) to service_role;
grant execute on function public.erp_mfg_po_line_stage_post_core_v1(text, uuid, text, numeric, text, uuid) to service_role;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
