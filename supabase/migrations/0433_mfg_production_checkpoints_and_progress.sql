-- 0433_mfg_production_checkpoints_and_progress.sql
-- MFG-PROD-0: Vendor production checkpoints + PO line checkpoint progress + BOM-based material consumption events.

create table if not exists public.erp_mfg_prod_checkpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  name text not null,
  sort_order integer not null default 10,
  is_active boolean not null default true,
  is_consumption_point boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  constraint erp_mfg_prod_checkpoints_company_vendor_name_uniq unique (company_id, vendor_id, name)
);

create unique index if not exists erp_mfg_prod_checkpoints_one_consumption_point_uniq
  on public.erp_mfg_prod_checkpoints (company_id, vendor_id)
  where is_consumption_point = true;

create index if not exists erp_mfg_prod_checkpoints_company_vendor_active_idx
  on public.erp_mfg_prod_checkpoints (company_id, vendor_id, is_active, sort_order);

create table if not exists public.erp_mfg_po_line_checkpoint_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  sku text not null,
  checkpoint_id uuid not null references public.erp_mfg_prod_checkpoints(id) on delete restrict,
  qty_done numeric not null default 0,
  notes text null,
  updated_at timestamptz not null default now(),
  updated_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  updated_by_vendor_code text null,
  constraint erp_mfg_po_line_checkpoint_progress_qty_done_chk check (qty_done >= 0),
  constraint erp_mfg_po_line_checkpoint_progress_uniq unique (company_id, vendor_id, po_line_id, checkpoint_id)
);

create index if not exists erp_mfg_po_line_checkpoint_progress_company_vendor_po_idx
  on public.erp_mfg_po_line_checkpoint_progress (company_id, vendor_id, po_id);

create index if not exists erp_mfg_po_line_checkpoint_progress_company_vendor_po_line_idx
  on public.erp_mfg_po_line_checkpoint_progress (company_id, vendor_id, po_line_id);

create table if not exists public.erp_mfg_material_consumption_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  sku text not null,
  checkpoint_id uuid not null references public.erp_mfg_prod_checkpoints(id) on delete restrict,
  consumed_qty_units numeric not null default 0,
  last_consumed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mfg_material_consumption_events_qty_chk check (consumed_qty_units >= 0),
  constraint erp_mfg_material_consumption_events_uniq unique (company_id, vendor_id, po_line_id, checkpoint_id)
);

create index if not exists erp_mfg_material_consumption_events_company_vendor_po_line_idx
  on public.erp_mfg_material_consumption_events (company_id, vendor_id, po_line_id, checkpoint_id);

alter table public.erp_mfg_material_ledger
  drop constraint if exists erp_mfg_material_ledger_qty_direction_chk;

alter table public.erp_mfg_material_ledger
  drop constraint if exists erp_mfg_material_ledger_entry_type_check;

alter table public.erp_mfg_material_ledger
  add constraint erp_mfg_material_ledger_entry_type_check
  check (entry_type in ('OPENING', 'PURCHASE_IN', 'ADJUST_IN', 'ADJUST_OUT', 'CONSUME_OUT', 'production_consume'));

alter table public.erp_mfg_material_ledger
  add constraint erp_mfg_material_ledger_qty_direction_chk
  check ((qty_in > 0 and qty_out = 0) or (qty_out > 0 and qty_in = 0));

create or replace function public.erp_mfg_prod_checkpoints_list_v1(
  p_company_id uuid,
  p_vendor_id uuid
) returns table (
  id uuid,
  name text,
  sort_order integer,
  is_active boolean,
  is_consumption_point boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.sort_order,
    c.is_active,
    c.is_consumption_point,
    c.created_at
  from public.erp_mfg_prod_checkpoints c
  where c.company_id = p_company_id
    and c.vendor_id = p_vendor_id
    and c.is_active = true
  order by c.sort_order asc, lower(c.name) asc, c.created_at asc;
$$;

create or replace function public.erp_mfg_prod_checkpoints_upsert_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_checkpoint jsonb
) returns public.erp_mfg_prod_checkpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(trim(coalesce(p_checkpoint->>'id', '')), '')::uuid;
  v_name text := trim(coalesce(p_checkpoint->>'name', ''));
  v_sort_order integer := coalesce((p_checkpoint->>'sort_order')::integer, 10);
  v_is_active boolean := coalesce((p_checkpoint->>'is_active')::boolean, true);
  v_is_consumption_point boolean := coalesce((p_checkpoint->>'is_consumption_point')::boolean, false);
  v_row public.erp_mfg_prod_checkpoints;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_name = '' then
    raise exception 'checkpoint name is required';
  end if;

  if v_sort_order < 0 then
    raise exception 'sort_order cannot be negative';
  end if;

  if v_is_consumption_point then
    if exists (
      select 1
      from public.erp_mfg_prod_checkpoints c
      where c.company_id = p_company_id
        and c.vendor_id = p_vendor_id
        and c.is_consumption_point = true
        and (v_id is null or c.id <> v_id)
    ) then
      raise exception 'Only one consumption checkpoint is allowed per vendor';
    end if;
  end if;

  if v_id is null then
    insert into public.erp_mfg_prod_checkpoints (
      company_id,
      vendor_id,
      name,
      sort_order,
      is_active,
      is_consumption_point
    ) values (
      p_company_id,
      p_vendor_id,
      v_name,
      v_sort_order,
      v_is_active,
      v_is_consumption_point
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.erp_mfg_prod_checkpoints c
     set name = v_name,
         sort_order = v_sort_order,
         is_active = v_is_active,
         is_consumption_point = v_is_consumption_point
   where c.id = v_id
     and c.company_id = p_company_id
     and c.vendor_id = p_vendor_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Checkpoint not found for vendor';
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'Checkpoint with this name already exists for this vendor';
end;
$$;

create or replace function public.erp_mfg_prod_checkpoints_seed_defaults_v1(
  p_company_id uuid,
  p_vendor_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if exists (
    select 1
    from public.erp_mfg_prod_checkpoints c
    where c.company_id = p_company_id
      and c.vendor_id = p_vendor_id
  ) then
    return 0;
  end if;

  insert into public.erp_mfg_prod_checkpoints (company_id, vendor_id, name, sort_order, is_active, is_consumption_point)
  values
    (p_company_id, p_vendor_id, 'Cutting', 10, true, true),
    (p_company_id, p_vendor_id, 'Stitching', 20, true, false),
    (p_company_id, p_vendor_id, 'Pressing', 30, true, false),
    (p_company_id, p_vendor_id, 'Packing', 40, true, false),
    (p_company_id, p_vendor_id, 'Ready to Dispatch', 50, true, false);

  get diagnostics v_created = row_count;
  return v_created;
exception
  when unique_violation then
    return 0;
end;
$$;

create or replace function public.erp_mfg_po_lines_for_production_list_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_status text default null,
  p_from date default null,
  p_to date default null
) returns table (
  po_id uuid,
  po_line_id uuid,
  po_number text,
  po_date date,
  due_date date,
  po_status text,
  sku text,
  variant_id uuid,
  qty_ordered numeric,
  qty_received numeric
)
language sql
security definer
set search_path = public
as $$
  select
    po.id as po_id,
    pol.id as po_line_id,
    coalesce(nullif(trim(po.doc_no), ''), nullif(trim(po.po_no), '')) as po_number,
    po.order_date as po_date,
    po.expected_delivery_date as due_date,
    po.status as po_status,
    coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
    pol.variant_id,
    pol.ordered_qty::numeric as qty_ordered,
    coalesce(pol.received_qty, 0)::numeric as qty_received
  from public.erp_purchase_orders po
  join public.erp_purchase_order_lines pol
    on pol.purchase_order_id = po.id
   and pol.company_id = po.company_id
  left join public.erp_variants vr
    on vr.id = pol.variant_id
   and vr.company_id = po.company_id
  where po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void')
    and (
      p_status is null
      or trim(p_status) = ''
      or lower(po.status) = lower(trim(p_status))
      or (lower(trim(p_status)) = 'open' and lower(po.status) in ('approved', 'partially_received'))
    )
    and (p_from is null or po.order_date >= p_from)
    and (p_to is null or po.order_date <= p_to)
  order by po.order_date desc, po.created_at desc, pol.created_at asc;
$$;

create or replace function public.erp_mfg_po_line_progress_get_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_po_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_lines jsonb;
begin
  if p_company_id is null or p_vendor_id is null or p_po_id is null then
    raise exception 'company_id, vendor_id and po_id are required';
  end if;

  select
    po.id,
    po.company_id,
    po.vendor_id,
    coalesce(nullif(trim(po.doc_no), ''), nullif(trim(po.po_no), '')) as po_number,
    po.order_date,
    po.expected_delivery_date,
    po.status
  into v_po
  from public.erp_purchase_orders po
  where po.id = p_po_id
    and po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void')
  limit 1;

  if v_po.id is null then
    raise exception 'PO not found for vendor';
  end if;

  with active_checkpoints as (
    select
      c.id,
      c.name,
      c.sort_order,
      c.is_consumption_point
    from public.erp_mfg_prod_checkpoints c
    where c.company_id = p_company_id
      and c.vendor_id = p_vendor_id
      and c.is_active = true
  ),
  line_rows as (
    select
      pol.id as po_line_id,
      coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
      pol.variant_id,
      pol.ordered_qty::numeric as qty_ordered,
      coalesce(pol.received_qty, 0)::numeric as qty_received,
      exists (
        select 1
        from public.erp_mfg_boms b
        where b.company_id = p_company_id
          and b.vendor_id = p_vendor_id
          and lower(b.sku) = lower(coalesce(nullif(trim(vr.sku), ''), ''))
          and b.status = 'active'
      ) as has_active_bom
    from public.erp_purchase_order_lines pol
    left join public.erp_variants vr
      on vr.id = pol.variant_id
     and vr.company_id = pol.company_id
    where pol.company_id = p_company_id
      and pol.purchase_order_id = p_po_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'po_line_id', lr.po_line_id,
      'sku', lr.sku,
      'variant_id', lr.variant_id,
      'qty_ordered', lr.qty_ordered,
      'qty_received', lr.qty_received,
      'has_active_bom', lr.has_active_bom,
      'checkpoint_progress', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'checkpoint_id', ac.id,
            'checkpoint_name', ac.name,
            'sort_order', ac.sort_order,
            'is_consumption_point', ac.is_consumption_point,
            'qty_done', coalesce(p.qty_done, 0),
            'notes', p.notes,
            'updated_at', p.updated_at
          )
          order by ac.sort_order asc, lower(ac.name) asc
        ), '[]'::jsonb)
        from active_checkpoints ac
        left join public.erp_mfg_po_line_checkpoint_progress p
          on p.company_id = p_company_id
         and p.vendor_id = p_vendor_id
         and p.po_id = p_po_id
         and p.po_line_id = lr.po_line_id
         and p.checkpoint_id = ac.id
      )
    )
    order by lr.po_line_id
  ), '[]'::jsonb)
  into v_lines
  from line_rows lr;

  return jsonb_build_object(
    'po', jsonb_build_object(
      'po_id', v_po.id,
      'po_number', v_po.po_number,
      'po_date', v_po.order_date,
      'due_date', v_po.expected_delivery_date,
      'status', v_po.status
    ),
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
end;
$$;

create or replace function public.erp_mfg_po_line_checkpoint_progress_set_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_po_id uuid,
  p_po_line_id uuid,
  p_checkpoint_id uuid,
  p_qty_done numeric,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_po_line record;
  v_checkpoint public.erp_mfg_prod_checkpoints;
  v_vendor_code text;
  v_progress public.erp_mfg_po_line_checkpoint_progress;
  v_existing_progress public.erp_mfg_po_line_checkpoint_progress;
  v_event public.erp_mfg_material_consumption_events;
  v_prev_consumed numeric := 0;
  v_delta_units numeric := 0;
  v_ledger_entries_count integer := 0;
  v_warn text := null;
begin
  if p_company_id is null or p_vendor_id is null or p_po_id is null or p_po_line_id is null or p_checkpoint_id is null then
    raise exception 'company_id, vendor_id, po_id, po_line_id and checkpoint_id are required';
  end if;

  if coalesce(p_qty_done, 0) < 0 then
    raise exception 'qty_done cannot be negative';
  end if;

  select
    po.id,
    po.status
  into v_po
  from public.erp_purchase_orders po
  where po.id = p_po_id
    and po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void')
  limit 1;

  if v_po.id is null then
    raise exception 'PO not found for vendor';
  end if;

  select
    pol.id,
    pol.ordered_qty::numeric as ordered_qty,
    coalesce(nullif(trim(vr.sku), ''), 'UNKNOWN-SKU') as sku,
    pol.variant_id
  into v_po_line
  from public.erp_purchase_order_lines pol
  left join public.erp_variants vr
    on vr.id = pol.variant_id
   and vr.company_id = pol.company_id
  where pol.id = p_po_line_id
    and pol.company_id = p_company_id
    and pol.purchase_order_id = p_po_id
  limit 1;

  if v_po_line.id is null then
    raise exception 'PO line not found for vendor PO';
  end if;

  if p_qty_done > v_po_line.ordered_qty then
    raise exception 'qty_done cannot exceed qty_ordered (%).', v_po_line.ordered_qty;
  end if;

  select *
    into v_checkpoint
  from public.erp_mfg_prod_checkpoints c
  where c.id = p_checkpoint_id
    and c.company_id = p_company_id
    and c.vendor_id = p_vendor_id
  limit 1;

  if v_checkpoint.id is null then
    raise exception 'Checkpoint not found for vendor';
  end if;

  select v.vendor_code
    into v_vendor_code
  from public.erp_vendors v
  where v.id = p_vendor_id
    and v.company_id = p_company_id
  limit 1;

  select *
    into v_existing_progress
  from public.erp_mfg_po_line_checkpoint_progress p
  where p.company_id = p_company_id
    and p.vendor_id = p_vendor_id
    and p.po_id = p_po_id
    and p.po_line_id = p_po_line_id
    and p.checkpoint_id = p_checkpoint_id
  limit 1;

  insert into public.erp_mfg_po_line_checkpoint_progress (
    company_id,
    vendor_id,
    po_id,
    po_line_id,
    sku,
    checkpoint_id,
    qty_done,
    notes,
    updated_at,
    updated_by_vendor_code
  ) values (
    p_company_id,
    p_vendor_id,
    p_po_id,
    p_po_line_id,
    v_po_line.sku,
    p_checkpoint_id,
    p_qty_done,
    nullif(trim(coalesce(p_notes, '')), ''),
    now(),
    nullif(trim(coalesce(v_vendor_code, '')), '')
  )
  on conflict (company_id, vendor_id, po_line_id, checkpoint_id)
  do update
     set qty_done = excluded.qty_done,
         notes = excluded.notes,
         updated_at = now(),
         updated_by_vendor_code = excluded.updated_by_vendor_code
  returning * into v_progress;

  if v_checkpoint.is_consumption_point then
    if not exists (
      select 1
      from public.erp_mfg_boms b
      where b.company_id = p_company_id
        and b.vendor_id = p_vendor_id
        and lower(b.sku) = lower(v_po_line.sku)
        and b.status = 'active'
    ) then
      raise exception 'BOM not defined for SKU; cannot consume materials.';
    end if;

    select *
      into v_event
    from public.erp_mfg_material_consumption_events e
    where e.company_id = p_company_id
      and e.vendor_id = p_vendor_id
      and e.po_id = p_po_id
      and e.po_line_id = p_po_line_id
      and e.checkpoint_id = p_checkpoint_id
    limit 1;

    v_prev_consumed := coalesce(v_event.consumed_qty_units, 0);
    v_delta_units := coalesce(p_qty_done, 0) - v_prev_consumed;

    if v_delta_units > 0 then
      insert into public.erp_mfg_material_ledger (
        company_id,
        vendor_id,
        material_id,
        entry_date,
        entry_type,
        qty_in,
        qty_out,
        uom,
        reference_type,
        reference_id,
        notes
      )
      select
        p_company_id,
        p_vendor_id,
        bl.material_id,
        current_date,
        'production_consume',
        0,
        (v_delta_units * bl.qty_per_unit * (1 + coalesce(bl.waste_pct, 0) / 100.0))::numeric,
        bl.uom,
        'po_line_checkpoint',
        p_po_line_id,
        concat(
          'Auto consumption at checkpoint; ',
          jsonb_build_object(
            'po_id', p_po_id,
            'po_line_id', p_po_line_id,
            'checkpoint_id', p_checkpoint_id,
            'sku', v_po_line.sku,
            'delta_units', v_delta_units,
            'qty_done', p_qty_done
          )::text
        )
      from public.erp_mfg_boms b
      join public.erp_mfg_bom_lines bl
        on bl.bom_id = b.id
       and bl.company_id = b.company_id
       and bl.vendor_id = b.vendor_id
      where b.company_id = p_company_id
        and b.vendor_id = p_vendor_id
        and lower(b.sku) = lower(v_po_line.sku)
        and b.status = 'active';

      get diagnostics v_ledger_entries_count = row_count;

      insert into public.erp_mfg_material_consumption_events (
        company_id,
        vendor_id,
        po_id,
        po_line_id,
        sku,
        checkpoint_id,
        consumed_qty_units,
        last_consumed_at,
        updated_at
      ) values (
        p_company_id,
        p_vendor_id,
        p_po_id,
        p_po_line_id,
        v_po_line.sku,
        p_checkpoint_id,
        p_qty_done,
        now(),
        now()
      )
      on conflict (company_id, vendor_id, po_line_id, checkpoint_id)
      do update
         set consumed_qty_units = excluded.consumed_qty_units,
             sku = excluded.sku,
             last_consumed_at = now(),
             updated_at = now();
    elsif v_delta_units < 0 then
      v_warn := 'Consumption already posted; decreasing progress does not reverse stock.';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'progress_row', to_jsonb(v_progress),
    'consumed', jsonb_build_object(
      'delta_units', coalesce(v_delta_units, 0),
      'ledger_entries_count', coalesce(v_ledger_entries_count, 0)
    ),
    'warning', v_warn
  );
end;
$$;

revoke all on function public.erp_mfg_prod_checkpoints_list_v1(uuid, uuid) from public;
revoke all on function public.erp_mfg_prod_checkpoints_upsert_v1(uuid, uuid, jsonb) from public;
revoke all on function public.erp_mfg_prod_checkpoints_seed_defaults_v1(uuid, uuid) from public;
revoke all on function public.erp_mfg_po_lines_for_production_list_v1(uuid, uuid, text, date, date) from public;
revoke all on function public.erp_mfg_po_line_progress_get_v1(uuid, uuid, uuid) from public;
revoke all on function public.erp_mfg_po_line_checkpoint_progress_set_v1(uuid, uuid, uuid, uuid, uuid, numeric, text) from public;

grant execute on function public.erp_mfg_prod_checkpoints_list_v1(uuid, uuid) to service_role;
grant execute on function public.erp_mfg_prod_checkpoints_upsert_v1(uuid, uuid, jsonb) to service_role;
grant execute on function public.erp_mfg_prod_checkpoints_seed_defaults_v1(uuid, uuid) to service_role;
grant execute on function public.erp_mfg_po_lines_for_production_list_v1(uuid, uuid, text, date, date) to service_role;
grant execute on function public.erp_mfg_po_line_progress_get_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.erp_mfg_po_line_checkpoint_progress_set_v1(uuid, uuid, uuid, uuid, uuid, numeric, text) to service_role;
