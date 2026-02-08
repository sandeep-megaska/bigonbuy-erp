-- 20260208093000_mfg_prod_checkpoints_and_progress.sql
-- MFG-PROD-0: vendor-defined production checkpoints, PO line progress, and BOM-based material consumption.

create table if not exists public.erp_mfg_prod_checkpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  name text not null,
  sort_order integer not null default 10,
  is_active boolean not null default true,
  is_consumption_point boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid null,
  constraint erp_mfg_prod_checkpoints_company_vendor_name_uniq unique (company_id, vendor_id, name)
);

create unique index if not exists erp_mfg_prod_checkpoints_single_consumption_point_uniq
  on public.erp_mfg_prod_checkpoints (company_id, vendor_id)
  where is_consumption_point = true;

create index if not exists erp_mfg_prod_checkpoints_company_vendor_sort_idx
  on public.erp_mfg_prod_checkpoints (company_id, vendor_id, sort_order, name);

create table if not exists public.erp_mfg_po_line_checkpoint_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  sku text not null,
  checkpoint_id uuid not null references public.erp_mfg_prod_checkpoints(id) on delete cascade,
  qty_done numeric not null default 0,
  notes text null,
  updated_at timestamptz not null default now(),
  updated_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  updated_by_vendor_code text null,
  constraint erp_mfg_po_line_checkpoint_progress_qty_done_chk check (qty_done >= 0),
  constraint erp_mfg_po_line_checkpoint_progress_company_vendor_line_checkpoint_uniq
    unique (company_id, vendor_id, po_line_id, checkpoint_id)
);

create index if not exists erp_mfg_po_line_checkpoint_progress_company_vendor_po_idx
  on public.erp_mfg_po_line_checkpoint_progress (company_id, vendor_id, po_id);

create index if not exists erp_mfg_po_line_checkpoint_progress_company_vendor_line_idx
  on public.erp_mfg_po_line_checkpoint_progress (company_id, vendor_id, po_line_id);

create table if not exists public.erp_mfg_material_consumption_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid not null references public.erp_purchase_orders(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  sku text not null,
  checkpoint_id uuid not null references public.erp_mfg_prod_checkpoints(id) on delete cascade,
  consumed_qty_units numeric not null default 0,
  last_consumed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mfg_material_consumption_events_consumed_qty_chk check (consumed_qty_units >= 0),
  constraint erp_mfg_material_consumption_events_company_vendor_line_checkpoint_uniq
    unique (company_id, vendor_id, po_line_id, checkpoint_id)
);

alter table public.erp_mfg_material_ledger
  drop constraint if exists erp_mfg_material_ledger_entry_type_check;

alter table public.erp_mfg_material_ledger
  add constraint erp_mfg_material_ledger_entry_type_check
  check (entry_type in ('OPENING', 'PURCHASE_IN', 'ADJUST_IN', 'ADJUST_OUT', 'CONSUME_OUT', 'PRODUCTION_CONSUME'));

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
  select c.id, c.name, c.sort_order, c.is_active, c.is_consumption_point, c.created_at
  from public.erp_mfg_prod_checkpoints c
  where c.company_id = p_company_id
    and c.vendor_id = p_vendor_id
    and c.is_active = true
  order by c.sort_order asc, c.name asc;
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
  v_id uuid := nullif(coalesce(p_checkpoint->>'id', ''), '')::uuid;
  v_name text := trim(coalesce(p_checkpoint->>'name', ''));
  v_sort_order integer := coalesce((p_checkpoint->>'sort_order')::integer, 10);
  v_is_active boolean := coalesce((p_checkpoint->>'is_active')::boolean, true);
  v_is_consumption boolean := coalesce((p_checkpoint->>'is_consumption_point')::boolean, false);
  v_row public.erp_mfg_prod_checkpoints;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_name = '' then
    raise exception 'Checkpoint name is required';
  end if;

  if v_is_consumption and exists (
    select 1
    from public.erp_mfg_prod_checkpoints c
    where c.company_id = p_company_id
      and c.vendor_id = p_vendor_id
      and c.is_consumption_point = true
      and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'Only one consumption checkpoint is allowed';
  end if;

  if v_id is null then
    insert into public.erp_mfg_prod_checkpoints (
      company_id, vendor_id, name, sort_order, is_active, is_consumption_point
    ) values (
      p_company_id, p_vendor_id, v_name, v_sort_order, v_is_active, v_is_consumption
    )
    returning * into v_row;

    return v_row;
  end if;

  update public.erp_mfg_prod_checkpoints c
     set name = v_name,
         sort_order = v_sort_order,
         is_active = v_is_active,
         is_consumption_point = v_is_consumption
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
    raise exception 'Checkpoint name already exists for this vendor';
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
  v_count integer := 0;
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

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
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
    coalesce(po.doc_no, po.po_no, po.id::text) as po_number,
    po.order_date as po_date,
    po.expected_delivery_date as due_date,
    po.status as po_status,
    coalesce(v.sku, '') as sku,
    coalesce(pol.ordered_qty, 0)::numeric as qty_ordered,
    coalesce(pol.received_qty, 0)::numeric as qty_received
  from public.erp_purchase_orders po
  join public.erp_purchase_order_lines pol
    on pol.purchase_order_id = po.id
   and pol.company_id = po.company_id
  left join public.erp_variants v
    on v.id = pol.variant_id
   and v.company_id = pol.company_id
  where po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and po.status not in ('cancelled', 'void')
    and (p_status is null or lower(po.status) = lower(p_status))
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
  v_po public.erp_purchase_orders;
  v_checkpoints jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
begin
  select *
    into v_po
  from public.erp_purchase_orders po
  where po.id = p_po_id
    and po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and po.status not in ('cancelled', 'void')
  limit 1;

  if v_po.id is null then
    raise exception 'PO not found for vendor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'sort_order', c.sort_order,
      'is_consumption_point', c.is_consumption_point
    ) order by c.sort_order, c.name), '[]'::jsonb)
    into v_checkpoints
  from public.erp_mfg_prod_checkpoints c
  where c.company_id = p_company_id
    and c.vendor_id = p_vendor_id
    and c.is_active = true;

  select coalesce(jsonb_agg(jsonb_build_object(
      'po_line_id', pol.id,
      'sku', coalesce(v.sku, ''),
      'qty_ordered', coalesce(pol.ordered_qty, 0),
      'qty_received', coalesce(pol.received_qty, 0),
      'progress', coalesce(p.progress_map, '{}'::jsonb)
    ) order by pol.created_at, pol.id), '[]'::jsonb)
    into v_lines
  from public.erp_purchase_order_lines pol
  left join public.erp_variants v
    on v.id = pol.variant_id
   and v.company_id = pol.company_id
  left join lateral (
    select jsonb_object_agg(pr.checkpoint_id::text, pr.qty_done) as progress_map
    from public.erp_mfg_po_line_checkpoint_progress pr
    where pr.company_id = p_company_id
      and pr.vendor_id = p_vendor_id
      and pr.po_id = p_po_id
      and pr.po_line_id = pol.id
  ) p on true
  where pol.company_id = p_company_id
    and pol.purchase_order_id = p_po_id;

  return jsonb_build_object(
    'po', jsonb_build_object(
      'po_id', v_po.id,
      'po_number', coalesce(v_po.doc_no, v_po.po_no, v_po.id::text),
      'po_date', v_po.order_date,
      'due_date', v_po.expected_delivery_date,
      'status', v_po.status
    ),
    'checkpoints', coalesce(v_checkpoints, '[]'::jsonb),
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
  v_po public.erp_purchase_orders;
  v_line public.erp_purchase_order_lines;
  v_checkpoint public.erp_mfg_prod_checkpoints;
  v_progress public.erp_mfg_po_line_checkpoint_progress;
  v_consumed public.erp_mfg_material_consumption_events;
  v_sku text;
  v_delta_units numeric := 0;
  v_inserted_count integer := 0;
  v_bom public.erp_mfg_boms;
  v_bom_line record;
  v_qty_to_consume numeric;
  v_ref text;
begin
  if p_qty_done is null or p_qty_done < 0 then
    raise exception 'qty_done must be >= 0';
  end if;

  select *
    into v_po
  from public.erp_purchase_orders po
  where po.id = p_po_id
    and po.company_id = p_company_id
    and po.vendor_id = p_vendor_id
    and po.status not in ('cancelled', 'void')
  limit 1;

  if v_po.id is null then
    raise exception 'PO not found for vendor';
  end if;

  select *
    into v_line
  from public.erp_purchase_order_lines pol
  where pol.id = p_po_line_id
    and pol.company_id = p_company_id
    and pol.purchase_order_id = p_po_id
  limit 1;

  if v_line.id is null then
    raise exception 'PO line not found for vendor';
  end if;

  if p_qty_done > coalesce(v_line.ordered_qty, 0)::numeric then
    raise exception 'qty_done cannot exceed qty_ordered';
  end if;

  select *
    into v_checkpoint
  from public.erp_mfg_prod_checkpoints c
  where c.id = p_checkpoint_id
    and c.company_id = p_company_id
    and c.vendor_id = p_vendor_id
    and c.is_active = true
  limit 1;

  if v_checkpoint.id is null then
    raise exception 'Checkpoint not found for vendor';
  end if;

  select coalesce(v.sku, '')
    into v_sku
  from public.erp_variants v
  where v.id = v_line.variant_id
    and v.company_id = p_company_id
  limit 1;

  if coalesce(v_sku, '') = '' then
    raise exception 'SKU not found on PO line';
  end if;

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
    v_sku,
    p_checkpoint_id,
    p_qty_done,
    nullif(trim(coalesce(p_notes, '')), ''),
    now(),
    null
  )
  on conflict (company_id, vendor_id, po_line_id, checkpoint_id)
  do update
     set qty_done = excluded.qty_done,
         notes = excluded.notes,
         updated_at = now()
  returning * into v_progress;

  if v_checkpoint.is_consumption_point then
    select *
      into v_consumed
    from public.erp_mfg_material_consumption_events e
    where e.company_id = p_company_id
      and e.vendor_id = p_vendor_id
      and e.po_line_id = p_po_line_id
      and e.checkpoint_id = p_checkpoint_id
    limit 1;

    v_delta_units := p_qty_done - coalesce(v_consumed.consumed_qty_units, 0);

    if v_delta_units > 0 then
      select *
        into v_bom
      from public.erp_mfg_boms b
      where b.company_id = p_company_id
        and b.vendor_id = p_vendor_id
        and lower(b.sku) = lower(v_sku)
      limit 1;

      if v_bom.id is null then
        raise exception 'BOM not defined for SKU; cannot consume materials.';
      end if;

      if not exists (
        select 1
        from public.erp_mfg_bom_lines bl
        where bl.company_id = p_company_id
          and bl.vendor_id = p_vendor_id
          and bl.bom_id = v_bom.id
      ) then
        raise exception 'BOM has no lines for SKU; cannot consume materials.';
      end if;

      for v_bom_line in
        select
          bl.material_id,
          bl.qty_per_unit,
          coalesce(bl.waste_pct, 0) as waste_pct,
          bl.uom,
          m.default_uom
        from public.erp_mfg_bom_lines bl
        join public.erp_mfg_materials m
          on m.id = bl.material_id
         and m.company_id = bl.company_id
         and m.vendor_id = bl.vendor_id
        where bl.company_id = p_company_id
          and bl.vendor_id = p_vendor_id
          and bl.bom_id = v_bom.id
      loop
        v_qty_to_consume := v_delta_units * coalesce(v_bom_line.qty_per_unit, 0) * (1 + (coalesce(v_bom_line.waste_pct, 0) / 100.0));

        if v_qty_to_consume > 0 then
          if coalesce(v_bom_line.default_uom, '') <> coalesce(v_bom_line.uom, '') then
            raise exception 'BOM line UOM must match material default UOM for consumption';
          end if;

          v_ref := jsonb_build_object(
            'po_id', p_po_id,
            'po_line_id', p_po_line_id,
            'checkpoint_id', p_checkpoint_id,
            'sku', v_sku
          )::text;

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
          ) values (
            p_company_id,
            p_vendor_id,
            v_bom_line.material_id,
            current_date,
            'PRODUCTION_CONSUME',
            0,
            v_qty_to_consume,
            v_bom_line.default_uom,
            'po_line_checkpoint',
            p_po_line_id,
            'Auto consumption at checkpoint ' || v_ref
          );

          v_inserted_count := v_inserted_count + 1;
        end if;
      end loop;

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
        v_sku,
        p_checkpoint_id,
        p_qty_done,
        now(),
        now()
      )
      on conflict (company_id, vendor_id, po_line_id, checkpoint_id)
      do update
         set consumed_qty_units = excluded.consumed_qty_units,
             sku = excluded.sku,
             po_id = excluded.po_id,
             last_consumed_at = now(),
             updated_at = now();
    end if;
  end if;

  return jsonb_build_object(
    'progress', to_jsonb(v_progress),
    'delta_units', coalesce(v_delta_units, 0),
    'ledger_entries_created', v_inserted_count
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
