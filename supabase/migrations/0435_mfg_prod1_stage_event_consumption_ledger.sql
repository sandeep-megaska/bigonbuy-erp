-- 0435_mfg_prod1_stage_event_consumption_ledger.sql
-- MFG-PROD-1: append-only stage events + internal checkpoint consumption posting/reversal.

create table if not exists public.erp_mfg_po_line_stage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid null references public.erp_purchase_orders(id) on delete set null,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  stage_code text not null,
  completed_qty_abs numeric(18,6) not null,
  completed_qty_delta numeric(18,6) not null,
  event_note text null,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  created_by_vendor_user_id uuid null,
  constraint erp_mfg_po_line_stage_events_abs_nonneg_chk check (completed_qty_abs >= 0),
  constraint erp_mfg_po_line_stage_events_delta_nonneg_chk check (completed_qty_delta >= 0),
  constraint erp_mfg_po_line_stage_events_vendor_client_event_uniq unique (vendor_id, client_event_id)
);

create index if not exists erp_mfg_po_line_stage_events_lookup_idx
  on public.erp_mfg_po_line_stage_events (company_id, vendor_id, po_line_id, stage_code, created_at desc);

create table if not exists public.erp_mfg_consumption_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  stage_event_id uuid not null references public.erp_mfg_po_line_stage_events(id) on delete restrict,
  stage_code text not null,
  completed_qty_delta numeric(18,6) not null,
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null references auth.users(id) on delete set null,
  reversal_batch_id uuid null,
  reason text null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_batches_stage_event_uniq unique (stage_event_id),
  constraint erp_mfg_consumption_batches_status_chk check (status in ('posted', 'reversed', 'voided')),
  constraint erp_mfg_consumption_batches_delta_nonneg_chk check (completed_qty_delta >= 0)
);

create index if not exists erp_mfg_consumption_batches_lookup_idx
  on public.erp_mfg_consumption_batches (company_id, vendor_id, po_line_id, stage_code, posted_at desc);

create table if not exists public.erp_mfg_consumption_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.erp_mfg_consumption_batches(id) on delete cascade,
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  material_id uuid not null references public.erp_mfg_materials(id) on delete restrict,
  bom_id uuid null references public.erp_mfg_boms(id) on delete set null,
  bom_line_id uuid null references public.erp_mfg_bom_lines(id) on delete set null,
  required_qty numeric(18,6) not null,
  uom text not null,
  ledger_entry_id uuid null references public.erp_mfg_material_ledger(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_batch_lines_required_qty_nonneg_chk check (required_qty >= 0)
);

create index if not exists erp_mfg_consumption_batch_lines_batch_idx
  on public.erp_mfg_consumption_batch_lines (batch_id);

create index if not exists erp_mfg_consumption_batch_lines_material_idx
  on public.erp_mfg_consumption_batch_lines (company_id, vendor_id, material_id);

create table if not exists public.erp_mfg_consumption_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  original_batch_id uuid not null references public.erp_mfg_consumption_batches(id) on delete restrict,
  client_reverse_id uuid not null,
  reason text null,
  reversed_at timestamptz not null default now(),
  reversed_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_reversals_original_batch_uniq unique (original_batch_id),
  constraint erp_mfg_consumption_reversals_client_reverse_uniq unique (client_reverse_id)
);

alter table public.erp_mfg_material_ledger
  add column if not exists entry_ts timestamptz;

update public.erp_mfg_material_ledger
set entry_ts = coalesce(entry_ts, created_at, (entry_date::timestamptz))
where entry_ts is null;

alter table public.erp_mfg_material_ledger
  alter column entry_ts set default now();

alter table public.erp_mfg_material_ledger
  alter column entry_ts set not null;

alter table public.erp_mfg_material_ledger
  add column if not exists reference_key text;

alter table public.erp_mfg_material_ledger
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

alter table public.erp_mfg_material_ledger
  drop constraint if exists erp_mfg_material_ledger_entry_type_check;

alter table public.erp_mfg_material_ledger
  add constraint erp_mfg_material_ledger_entry_type_check
  check (
    entry_type in (
      'OPENING',
      'PURCHASE_IN',
      'ADJUST_IN',
      'ADJUST_OUT',
      'CONSUME_OUT',
      'production_consume',
      'OUT',
      'IN',
      'ADJUST',
      'REVERSAL'
    )
  );

create unique index if not exists erp_mfg_material_ledger_company_reference_key_uniq
  on public.erp_mfg_material_ledger (company_id, reference_key)
  where reference_key is not null;

create index if not exists erp_mfg_material_ledger_company_vendor_material_ts_idx
  on public.erp_mfg_material_ledger (company_id, vendor_id, material_id, entry_ts desc);

create index if not exists erp_mfg_material_ledger_reference_idx
  on public.erp_mfg_material_ledger (reference_type, reference_id);

alter table public.erp_mfg_po_line_stage_events enable row level security;
alter table public.erp_mfg_consumption_batches enable row level security;
alter table public.erp_mfg_consumption_batch_lines enable row level security;
alter table public.erp_mfg_consumption_reversals enable row level security;

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
  v_po_line record;
  v_stage_code text := upper(trim(coalesce(p_stage_code, '')));
  v_last_abs numeric(18,6) := 0;
  v_delta numeric(18,6);
  v_existing_id uuid;
  v_stage_event_id uuid;
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

  select ev.id
    into v_existing_id
  from public.erp_mfg_po_line_stage_events ev
  where ev.vendor_id = v_vendor_id
    and ev.client_event_id = p_client_event_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select
    po.id as po_id,
    pol.id as po_line_id,
    pol.ordered_qty::numeric(18,6) as ordered_qty
  into v_po_line
  from public.erp_purchase_order_lines pol
  join public.erp_purchase_orders po
    on po.id = pol.purchase_order_id
   and po.company_id = pol.company_id
  where pol.id = p_po_line_id
    and po.company_id = v_company_id
    and po.vendor_id = v_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void')
  limit 1;

  if v_po_line.po_line_id is null then
    raise exception 'PO line not found for vendor';
  end if;

  if p_completed_qty_abs > v_po_line.ordered_qty then
    raise exception 'completed_qty_abs cannot exceed qty_ordered (%)', v_po_line.ordered_qty;
  end if;

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

  if p_completed_qty_abs < v_last_abs then
    raise exception 'Stage quantity must be monotonic. last_abs=% new_abs=%', v_last_abs, p_completed_qty_abs;
  end if;

  v_delta := (p_completed_qty_abs - v_last_abs)::numeric(18,6);

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
    v_po_line.po_id,
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

create or replace function public.erp_mfg_stage_consumption_preview_v1(
  p_stage_event_id uuid
) returns table(
  material_id uuid,
  uom text,
  required_qty numeric(18,6),
  available_qty numeric(18,6),
  shortage_qty numeric(18,6)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_po_line record;
  v_bom_id uuid;
begin
  if p_stage_event_id is null then
    raise exception 'stage_event_id is required';
  end if;

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

  select b.id
    into v_bom_id
  from public.erp_mfg_boms b
  where b.company_id = v_event.company_id
    and b.vendor_id = v_event.vendor_id
    and lower(b.sku) = lower(v_po_line.sku)
    and b.status = 'active'
  order by b.updated_at desc nulls last, b.created_at desc nulls last
  limit 1;

  if v_bom_id is null then
    raise exception 'Active BOM not found for SKU %', v_po_line.sku;
  end if;

  return query
  with required as (
    select
      bl.material_id,
      bl.uom,
      (v_event.completed_qty_delta * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric(18,6) as required_qty
    from public.erp_mfg_bom_lines bl
    where bl.company_id = v_event.company_id
      and bl.vendor_id = v_event.vendor_id
      and bl.bom_id = v_bom_id
  ), available as (
    select
      ml.material_id,
      coalesce(sum(ml.qty_in - ml.qty_out), 0)::numeric(18,6) as available_qty
    from public.erp_mfg_material_ledger ml
    where ml.company_id = v_event.company_id
      and ml.vendor_id = v_event.vendor_id
    group by ml.material_id
  )
  select
    r.material_id,
    r.uom,
    r.required_qty,
    coalesce(a.available_qty, 0)::numeric(18,6) as available_qty,
    greatest(r.required_qty - coalesce(a.available_qty, 0), 0)::numeric(18,6) as shortage_qty
  from required r
  left join available a
    on a.material_id = r.material_id
  order by r.material_id;
end;
$$;

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
declare
  v_event record;
  v_po_line record;
  v_bom record;
  v_batch_id uuid;
  v_line record;
  v_ledger_id uuid;
  v_shortage jsonb;
  v_count int := 0;
begin
  if p_stage_event_id is null then
    raise exception 'stage_event_id is required';
  end if;

  select b.id
    into v_batch_id
  from public.erp_mfg_consumption_batches b
  where b.stage_event_id = p_stage_event_id
  limit 1;

  if v_batch_id is not null then
    return query
    select
      v_batch_id,
      count(*)::int
    from public.erp_mfg_consumption_batch_lines bl
    where bl.batch_id = v_batch_id;
    return;
  end if;

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
    raise exception 'Stage event delta must be greater than zero';
  end if;

  if upper(coalesce(v_event.stage_code, '')) <> 'CUTTING' then
    raise exception 'UNSUPPORTED_STAGE';
  end if;

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

  select b.*
    into v_bom
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
    upper(v_event.stage_code),
    v_event.completed_qty_delta,
    'posted',
    now(),
    p_actor_user_id,
    null,
    nullif(trim(coalesce(p_reason, '')), ''),
    now()
  )
  returning id into v_batch_id;

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
      concat(
        'Stage consumption ',
        jsonb_build_object(
          'stage_code', upper(v_event.stage_code),
          'po_line_id', v_event.po_line_id,
          'batch_id', v_batch_id
        )::text
      ),
      now(),
      p_actor_user_id
    )
    on conflict (company_id, reference_key)
    do update
      set reference_key = excluded.reference_key
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
    select b.id
      into v_batch_id
    from public.erp_mfg_consumption_batches b
    where b.stage_event_id = p_stage_event_id
    limit 1;

    if v_batch_id is not null then
      return query
      select v_batch_id, count(*)::int
      from public.erp_mfg_consumption_batch_lines bl
      where bl.batch_id = v_batch_id;
      return;
    end if;
    raise;
end;
$$;

create or replace function public.erp_mfg_stage_consumption_reverse_v1(
  p_consumption_batch_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_reverse_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.erp_mfg_consumption_batches;
  v_reversal public.erp_mfg_consumption_reversals;
  v_line record;
begin
  if p_consumption_batch_id is null or p_client_reverse_id is null then
    raise exception 'consumption_batch_id and client_reverse_id are required';
  end if;

  select *
    into v_batch
  from public.erp_mfg_consumption_batches b
  where b.id = p_consumption_batch_id
  limit 1;

  if v_batch.id is null then
    raise exception 'Consumption batch not found';
  end if;

  if v_batch.status = 'reversed' and v_batch.reversal_batch_id is not null then
    return v_batch.reversal_batch_id;
  end if;

  if v_batch.status <> 'posted' then
    raise exception 'Only posted batches can be reversed';
  end if;

  select *
    into v_reversal
  from public.erp_mfg_consumption_reversals r
  where r.original_batch_id = p_consumption_batch_id
     or r.client_reverse_id = p_client_reverse_id
  limit 1;

  if v_reversal.id is not null then
    update public.erp_mfg_consumption_batches
       set status = 'reversed',
           reversal_batch_id = v_reversal.id
     where id = p_consumption_batch_id
       and status <> 'reversed';

    return v_reversal.id;
  end if;

  insert into public.erp_mfg_consumption_reversals (
    company_id,
    vendor_id,
    original_batch_id,
    client_reverse_id,
    reason,
    reversed_at,
    reversed_by_user_id,
    created_at
  ) values (
    v_batch.company_id,
    v_batch.vendor_id,
    v_batch.id,
    p_client_reverse_id,
    nullif(trim(coalesce(p_reason, '')), ''),
    now(),
    p_actor_user_id,
    now()
  )
  returning * into v_reversal;

  for v_line in
    select
      bl.material_id,
      bl.required_qty,
      bl.uom
    from public.erp_mfg_consumption_batch_lines bl
    where bl.batch_id = v_batch.id
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
      v_batch.company_id,
      v_batch.vendor_id,
      v_line.material_id,
      current_date,
      now(),
      'REVERSAL',
      v_line.required_qty,
      0,
      v_line.uom,
      'MFG_STAGE_CONSUMPTION_REVERSAL',
      v_batch.id,
      'reverse_batch:' || v_reversal.id::text || ':material:' || v_line.material_id::text,
      concat(
        'Reversal for stage consumption batch ',
        jsonb_build_object(
          'batch_id', v_batch.id,
          'reversal_id', v_reversal.id,
          'reason', nullif(trim(coalesce(p_reason, '')), '')
        )::text
      ),
      now(),
      p_actor_user_id
    )
    on conflict (company_id, reference_key)
    do nothing;
  end loop;

  update public.erp_mfg_consumption_batches
     set status = 'reversed',
         reversal_batch_id = v_reversal.id
   where id = v_batch.id;

  return v_reversal.id;
end;
$$;

create or replace function public.erp_mfg_cutting_stage_events_pending_list_v1(
  p_company_id uuid,
  p_vendor_id uuid default null,
  p_limit integer default 100
) returns table(
  stage_event_id uuid,
  vendor_id uuid,
  vendor_name text,
  po_line_id uuid,
  po_id uuid,
  po_number text,
  sku text,
  completed_qty_delta numeric(18,6),
  created_at timestamptz,
  consumption_status text,
  consumption_batch_id uuid
)
language sql
security definer
set search_path = public
as $$
  with events as (
    select
      e.id as stage_event_id,
      e.company_id,
      e.vendor_id,
      e.po_line_id,
      e.po_id,
      e.completed_qty_delta,
      e.created_at,
      b.id as consumption_batch_id,
      b.status as batch_status
    from public.erp_mfg_po_line_stage_events e
    left join public.erp_mfg_consumption_batches b
      on b.stage_event_id = e.id
    where e.company_id = p_company_id
      and upper(e.stage_code) = 'CUTTING'
      and e.completed_qty_delta > 0
      and (p_vendor_id is null or e.vendor_id = p_vendor_id)
  )
  select
    e.stage_event_id,
    e.vendor_id,
    v.legal_name as vendor_name,
    e.po_line_id,
    e.po_id,
    coalesce(nullif(trim(po.doc_no), ''), nullif(trim(po.po_no), '')) as po_number,
    coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
    e.completed_qty_delta,
    e.created_at,
    coalesce(e.batch_status, 'pending') as consumption_status,
    e.consumption_batch_id
  from events e
  left join public.erp_vendors v
    on v.id = e.vendor_id
   and v.company_id = e.company_id
  left join public.erp_purchase_orders po
    on po.id = e.po_id
   and po.company_id = e.company_id
  left join public.erp_purchase_order_lines pol
    on pol.id = e.po_line_id
   and pol.company_id = e.company_id
  left join public.erp_variants vr
    on vr.id = pol.variant_id
   and vr.company_id = e.company_id
  order by e.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

create or replace function public.erp_vendor_readiness_list_v1(
  p_company_id uuid,
  p_from date default null,
  p_to date default null
) returns table (
  vendor_id uuid,
  vendor_name text,
  vendor_code text,
  readiness_status text,
  reasons text[],
  open_po_lines integer,
  bom_missing_skus integer,
  shortage_materials integer,
  cutting_events_pending_consumption integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Not authorized for this company';
  end if;

  return query
  with vendor_base as (
    select
      v.id as vendor_id,
      v.legal_name as vendor_name,
      v.vendor_code,
      coalesce(v.is_active, false) as vendor_is_active,
      coalesce(v.portal_enabled, false) as portal_enabled,
      lower(coalesce(v.portal_status, '')) as portal_status
    from public.erp_vendors v
    where v.company_id = p_company_id
  ), open_line_sku as (
    select
      po.vendor_id,
      pol.id as po_line_id,
      coalesce(nullif(trim(vr.sku), ''), '') as sku,
      greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) as open_qty
    from public.erp_purchase_orders po
    join public.erp_purchase_order_lines pol
      on pol.company_id = po.company_id
     and pol.purchase_order_id = po.id
    left join public.erp_variants vr
      on vr.company_id = po.company_id
     and vr.id = pol.variant_id
    where po.company_id = p_company_id
      and coalesce(lower(po.status), '') in ('open', 'issued', 'approved', 'partially_received')
      and greatest(pol.ordered_qty::numeric - coalesce(pol.received_qty, 0)::numeric, 0::numeric) > 0
      and (p_from is null or po.order_date >= p_from)
      and (p_to is null or po.order_date <= p_to)
      and nullif(trim(vr.sku), '') is not null
  ), open_line_counts as (
    select
      o.vendor_id,
      count(*)::integer as open_po_lines,
      count(distinct lower(o.sku))::integer as open_sku_count
    from open_line_sku o
    group by o.vendor_id
  ), bom_missing as (
    select
      o.vendor_id,
      count(distinct lower(o.sku))::integer as bom_missing_skus
    from open_line_sku o
    left join public.erp_mfg_boms b
      on b.company_id = p_company_id
     and b.vendor_id = o.vendor_id
     and lower(b.sku) = lower(o.sku)
     and b.status = 'active'
    where b.id is null
    group by o.vendor_id
  ), demand_by_material as (
    select
      o.vendor_id,
      bl.material_id,
      sum(o.open_qty * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric as demand_qty_next
    from open_line_sku o
    join public.erp_mfg_boms b
      on b.company_id = p_company_id
     and b.vendor_id = o.vendor_id
     and lower(b.sku) = lower(o.sku)
     and b.status = 'active'
    join public.erp_mfg_bom_lines bl
      on bl.company_id = b.company_id
     and bl.vendor_id = b.vendor_id
     and bl.bom_id = b.id
    group by o.vendor_id, bl.material_id
  ), shortage_rollup as (
    select
      mb.vendor_id,
      count(*) filter (
        where (coalesce(mb.on_hand_qty, 0) - coalesce(dm.demand_qty_next, 0)) < 0
      )::integer as shortage_materials,
      count(*) filter (
        where (coalesce(mb.on_hand_qty, 0) - coalesce(dm.demand_qty_next, 0)) <= coalesce(mb.reorder_point, 0)
      )::integer as near_reorder_materials
    from public.erp_mfg_material_balances_v mb
    left join demand_by_material dm
      on dm.vendor_id = mb.vendor_id
     and dm.material_id = mb.material_id
    where mb.company_id = p_company_id
      and mb.is_active = true
    group by mb.vendor_id
  ), pending_cutting as (
    select
      e.vendor_id,
      count(*)::integer as cutting_events_pending_consumption
    from public.erp_mfg_po_line_stage_events e
    left join public.erp_mfg_consumption_batches b
      on b.stage_event_id = e.id
    where e.company_id = p_company_id
      and upper(e.stage_code) = 'CUTTING'
      and e.completed_qty_delta > 0
      and b.id is null
    group by e.vendor_id
  ), merged as (
    select
      vb.vendor_id,
      vb.vendor_name,
      vb.vendor_code,
      vb.vendor_is_active,
      vb.portal_enabled,
      vb.portal_status,
      coalesce(olc.open_po_lines, 0) as open_po_lines,
      coalesce(bm.bom_missing_skus, 0) as bom_missing_skus,
      coalesce(sr.shortage_materials, 0) as shortage_materials,
      coalesce(sr.near_reorder_materials, 0) as near_reorder_materials,
      coalesce(pc.cutting_events_pending_consumption, 0) as cutting_events_pending_consumption
    from vendor_base vb
    left join open_line_counts olc
      on olc.vendor_id = vb.vendor_id
    left join bom_missing bm
      on bm.vendor_id = vb.vendor_id
    left join shortage_rollup sr
      on sr.vendor_id = vb.vendor_id
    left join pending_cutting pc
      on pc.vendor_id = vb.vendor_id
  )
  select
    m.vendor_id,
    m.vendor_name,
    m.vendor_code,
    case
      when not m.vendor_is_active
        or not m.portal_enabled
        or m.portal_status not in ('active', 'enabled')
      then 'red'
      when m.shortage_materials > 2 then 'red'
      when m.bom_missing_skus > 0
        or m.shortage_materials > 0
        or m.near_reorder_materials > 0
        or m.cutting_events_pending_consumption > 0
      then 'amber'
      else 'green'
    end as readiness_status,
    array_remove(array[
      case when not m.vendor_is_active then 'Vendor is inactive' end,
      case when not m.portal_enabled then 'Vendor portal is disabled' end,
      case when m.portal_enabled and m.portal_status not in ('active', 'enabled') then 'Vendor portal status is not active' end,
      case when m.bom_missing_skus > 0 then format('Missing active BOM for %s open PO SKU(s)', m.bom_missing_skus) end,
      case when m.shortage_materials > 2 then format('Severe shortages across %s materials', m.shortage_materials) end,
      case when m.shortage_materials between 1 and 2 then format('Shortages across %s materials', m.shortage_materials) end,
      case when m.shortage_materials = 0 and m.near_reorder_materials > 0 then format('%s materials are at or below reorder point', m.near_reorder_materials) end,
      case when m.cutting_events_pending_consumption > 0 then format('%s cutting stage event(s) pending consumption posting', m.cutting_events_pending_consumption) end
    ], null)::text[] as reasons,
    m.open_po_lines,
    m.bom_missing_skus,
    m.shortage_materials,
    m.cutting_events_pending_consumption
  from merged m
  order by
    case
      when not m.vendor_is_active
        or not m.portal_enabled
        or m.portal_status not in ('active', 'enabled')
      then 1
      when m.shortage_materials > 2 then 1
      when m.bom_missing_skus > 0 or m.shortage_materials > 0 or m.near_reorder_materials > 0 or m.cutting_events_pending_consumption > 0 then 2
      else 3
    end,
    lower(m.vendor_name);
end;
$$;

revoke all on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) from public;
revoke all on function public.erp_mfg_stage_consumption_preview_v1(uuid) from public;
revoke all on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) from public;
revoke all on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid) from public;
revoke all on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, uuid, integer) from public;
revoke all on function public.erp_vendor_readiness_list_v1(uuid, date, date) from public;

grant execute on function public.erp_mfg_po_line_stage_post_v1(text, uuid, text, numeric, text, uuid) to anon;
grant execute on function public.erp_mfg_stage_consumption_preview_v1(uuid) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_post_v1(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.erp_mfg_stage_consumption_reverse_v1(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.erp_mfg_cutting_stage_events_pending_list_v1(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.erp_vendor_readiness_list_v1(uuid, date, date) to authenticated;
