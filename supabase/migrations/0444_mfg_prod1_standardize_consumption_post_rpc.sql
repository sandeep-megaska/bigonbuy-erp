-- 0444_mfg_prod1_standardize_consumption_post_rpc.sql
-- Finalize consumption-post RPC naming to avoid:
-- 1) overload ambiguity (PostgREST)
-- 2) missing canonical signature (ERP calling uuid,uuid,text)
--
-- Policy:
-- - public.erp_mfg_stage_consumption_post_v1 = CANONICAL signature (stage_event_id, actor_user_id, reason)
-- - public.erp_mfg_stage_consumption_post_ui_v1 = UI signature (actor_user_id, reason, stage_event_id)
-- - No overloads for the same function name.

-- 1) Ensure CORE exists (used by both canonical + UI aliases)
-- If you already have this, this will just replace with same definition.
-- IMPORTANT: This function contains the real logic.
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
  v_event record;
  v_po_line record;
  v_bom record;

  v_batch_id uuid;
  v_ledger_id uuid;
  v_line record;

  v_shortage jsonb;
  v_count int := 0;
begin
  if p_stage_event_id is null then
    raise exception 'stage_event_id is required';
  end if;

  if to_regclass('public.erp_mfg_po_line_stage_events') is null then
    raise exception 'Missing table public.erp_mfg_po_line_stage_events';
  end if;
  if to_regclass('public.erp_mfg_consumption_batches') is null then
    raise exception 'Missing table public.erp_mfg_consumption_batches';
  end if;
  if to_regclass('public.erp_mfg_consumption_batch_lines') is null then
    raise exception 'Missing table public.erp_mfg_consumption_batch_lines';
  end if;
  if to_regclass('public.erp_mfg_material_ledger') is null then
    raise exception 'Missing table public.erp_mfg_material_ledger';
  end if;

  -- Idempotency: already posted?
  select b.id into v_batch_id
  from public.erp_mfg_consumption_batches b
  where b.stage_event_id = p_stage_event_id
  limit 1;

  if v_batch_id is not null then
    return query
    select
      v_batch_id,
      (select count(*)::int from public.erp_mfg_consumption_batch_lines bl where bl.batch_id = v_batch_id);
    return;
  end if;

  -- Load stage event
  select
    e.id,
    e.company_id,
    e.vendor_id,
    e.po_line_id,
    e.stage_code,
    e.completed_qty_delta
  into v_event
  from public.erp_mfg_po_line_stage_events e
  where e.id = p_stage_event_id
  limit 1;

  if v_event.id is null then
    raise exception 'Stage event not found';
  end if;

  if coalesce(v_event.completed_qty_delta, 0) <= 0 then
    raise exception 'Stage event delta must be > 0';
  end if;

  if upper(coalesce(v_event.stage_code, '')) <> 'CUTTING' then
    raise exception 'UNSUPPORTED_STAGE';
  end if;

  -- Resolve SKU
  select
    pol.id,
    coalesce(nullif(trim(vr.sku), ''), '') as sku
  into v_po_line
  from public.erp_purchase_order_lines pol
  left join public.erp_variants vr
    on vr.id = pol.variant_id
   and vr.company_id = pol.company_id
  where pol.id = v_event.po_line_id
    and pol.company_id = v_event.company_id
  limit 1;

  if v_po_line.id is null or v_po_line.sku = '' then
    raise exception 'SKU not found for stage event PO line';
  end if;

  -- Active BOM
  select b.* into v_bom
  from public.erp_mfg_boms b
  where b.company_id = v_event.company_id
    and b.vendor_id = v_event.vendor_id
    and lower(b.sku) = lower(v_po_line.sku)
    and b.status = 'active'
  order by b.updated_at desc nulls last, b.created_at desc nulls last
  limit 1;

  if v_bom.id is null then
    raise exception 'Active BOM not found for SKU %', v_po_line.sku;
  end if;

  -- Shortage check using preview if available
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname='erp_mfg_stage_consumption_preview_v1'
      and pg_get_function_identity_arguments(p.oid)='p_stage_event_id uuid'
  ) then
    select jsonb_agg(jsonb_build_object(
      'material_id', p.material_id,
      'required_qty', p.required_qty,
      'available_qty', p.available_qty,
      'shortage_qty', p.shortage_qty,
      'uom', p.uom
    ))
    into v_shortage
    from public.erp_mfg_stage_consumption_preview_v1(p_stage_event_id) p
    where p.shortage_qty > 0;

    if v_shortage is not null then
      raise exception 'INSUFFICIENT_STOCK: %', v_shortage::text;
    end if;
  end if;

  -- Create batch
  insert into public.erp_mfg_consumption_batches (
    company_id,
    vendor_id,
    po_line_id,
    stage_event_id,
    stage_code,
    completed_qty_delta,
    status,
    posted_at,
    posted_by_user_id,
    reversal_batch_id,
    reason,
    created_at
  ) values (
    v_event.company_id,
    v_event.vendor_id,
    v_event.po_line_id,
    v_event.id,
    'CUTTING',
    v_event.completed_qty_delta,
    'posted',
    now(),
    p_actor_user_id,
    null,
    nullif(trim(coalesce(p_reason, '')), ''),
    now()
  )
  returning id into v_batch_id;

  -- Ledger OUT per BOM line
  for v_line in
    select
      bl.id as bom_line_id,
      bl.material_id,
      bl.uom,
      (v_event.completed_qty_delta * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric(18,6) as required_qty
    from public.erp_mfg_bom_lines bl
    where bl.company_id = v_event.company_id
      and bl.vendor_id = v_event.vendor_id
      and bl.bom_id = v_bom.id
  loop
    insert into public.erp_mfg_material_ledger (
      company_id,
      vendor_id,
      material_id,
      entry_date,
      entry_ts,
      entry_type,
      qty_in,
      qty_out,
      uom,
      reference_type,
      reference_id,
      reference_key,
      notes,
      created_at,
      created_by_user_id
    ) values (
      v_event.company_id,
      v_event.vendor_id,
      v_line.material_id,
      current_date,
      now(),
      'OUT',
      0,
      v_line.required_qty,
      v_line.uom,
      'MFG_STAGE_CONSUMPTION',
      v_event.id,
      'stage_event:' || v_event.id::text || ':material:' || v_line.material_id::text,
      concat('Stage consumption ', jsonb_build_object('stage_event_id', v_event.id, 'batch_id', v_batch_id)::text),
      now(),
      p_actor_user_id
    )
    on conflict (company_id, reference_key)
    do update set reference_key = excluded.reference_key
    returning id into v_ledger_id;

    insert into public.erp_mfg_consumption_batch_lines (
      batch_id,
      company_id,
      vendor_id,
      material_id,
      bom_id,
      bom_line_id,
      required_qty,
      uom,
      ledger_entry_id,
      created_at
    ) values (
      v_batch_id,
      v_event.company_id,
      v_event.vendor_id,
      v_line.material_id,
      v_bom.id,
      v_line.bom_line_id,
      v_line.required_qty,
      v_line.uom,
      v_ledger_id,
      now()
    );

    v_count := v_count + 1;
  end loop;

  return query select v_batch_id, v_count;

exception
  when unique_violation then
    select b.id into v_batch_id
    from public.erp_mfg_consumption_batches b
    where b.stage_event_id = p_stage_event_id
    limit 1;

    if v_batch_id is not null then
      return query
      select
        v_batch_id,
        (select count(*)::int from public.erp_mfg_consumption_batch_lines bl where bl.batch_id = v_batch_id);
      return;
    end if;

    raise;
end;
$$;

-- 2) DROP any existing overloads that cause ambiguity
drop function if exists public.erp_mfg_stage_consumption_post_v1(uuid, text, uuid);
drop function if exists public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text);

-- 3) Recreate CANONICAL public function name with canonical signature (what ERP backend expects)
create or replace function public.erp_mfg_stage_consumption_post_v1(
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

-- 4) Provide a separate UI-friendly alias (no ambiguity because name is different)
create or replace function public.erp_mfg_stage_consumption_post_ui_v1(
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

-- 5) Grants
revoke all on function public.erp_mfg_stage_consumption_post_core_v1(uuid, uuid, text) from public;
revoke all on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) from public;
revoke all on function public.erp_mfg_stage_consumption_post_ui_v1(uuid, text, uuid) from public;

grant execute on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_post_ui_v1(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_post_core_v1(uuid, uuid, text) to service_role;

select pg_notify('pgrst', 'reload schema');
