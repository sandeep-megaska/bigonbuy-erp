-- 0438_mfg_prod1_create_canonical_stage_post_rpc.sql
-- Create canonical vendor stage event RPC used by wrapper:
--   erp_mfg_po_line_stage_post_v1(p_session_token text, p_po_line_id uuid, p_stage_code text,
--                                p_completed_qty_abs numeric, p_event_note text, p_client_event_id uuid)
-- This is cookie-auth based (vendor portal). Wrapper (uuid,numeric,text,uuid,text,text) delegates to this.

create or replace function public.erp_mfg_po_line_stage_post_v1(
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
  -- auth
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

  -- resolve vendor session (existing RPC)
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  -- idempotency: (vendor_id, client_event_id)
  select ev.id
    into v_existing_id
  from public.erp_mfg_po_line_stage_events ev
  where ev.vendor_id = v_vendor_id
    and ev.client_event_id = p_client_event_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- validate PO line belongs to vendor + company; get ordered qty + po_id
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

  -- monotonic per (vendor, po_line, stage)
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
    -- race-safe: return existing by client_event_id
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

-- Privileges: vendor portal typically calls wrapper, but allow direct execute too (safe).
revoke all on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) from public;
grant execute on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) to anon, service_role;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
