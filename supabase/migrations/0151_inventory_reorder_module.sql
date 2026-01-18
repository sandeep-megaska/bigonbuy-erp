-- Inventory reorder rules and suggestions
create table if not exists public.erp_inventory_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  min_qty int not null default 0,
  target_qty int null,
  reorder_qty int null,
  preferred_vendor_id uuid null references public.erp_vendors (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create unique index if not exists erp_inventory_reorder_rules_company_warehouse_variant_key
  on public.erp_inventory_reorder_rules (company_id, warehouse_id, variant_id);

create index if not exists erp_inventory_reorder_rules_company_warehouse_idx
  on public.erp_inventory_reorder_rules (company_id, warehouse_id);

alter table public.erp_inventory_reorder_rules enable row level security;
alter table public.erp_inventory_reorder_rules force row level security;

do $$
begin
  drop policy if exists erp_inventory_reorder_rules_select on public.erp_inventory_reorder_rules;
  drop policy if exists erp_inventory_reorder_rules_write on public.erp_inventory_reorder_rules;

  create policy erp_inventory_reorder_rules_select
    on public.erp_inventory_reorder_rules
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_inventory_reorder_rules_write
    on public.erp_inventory_reorder_rules
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'inventory')
        )
      )
    );
end;
$$;

create or replace function public.erp_reorder_rules_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows payload must be a JSON array';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  with input_rows as (
    select
      r.warehouse_id,
      r.variant_id,
      greatest(coalesce(r.min_qty, 0), 0) as min_qty,
      r.target_qty,
      r.reorder_qty,
      r.preferred_vendor_id,
      coalesce(r.is_active, true) as is_active
    from jsonb_to_recordset(p_rows) as r(
      warehouse_id uuid,
      variant_id uuid,
      min_qty int,
      target_qty int,
      reorder_qty int,
      preferred_vendor_id uuid,
      is_active boolean
    )
  ),
  filtered as (
    select i.*
    from input_rows i
    join public.erp_warehouses w
      on w.id = i.warehouse_id
     and w.company_id = v_company_id
    join public.erp_variants v
      on v.id = i.variant_id
     and v.company_id = v_company_id
  )
  insert into public.erp_inventory_reorder_rules (
    company_id,
    warehouse_id,
    variant_id,
    min_qty,
    target_qty,
    reorder_qty,
    preferred_vendor_id,
    is_active
  )
  select
    v_company_id,
    f.warehouse_id,
    f.variant_id,
    f.min_qty,
    f.target_qty,
    f.reorder_qty,
    f.preferred_vendor_id,
    f.is_active
  from filtered f
  on conflict (company_id, warehouse_id, variant_id)
  do update set
    min_qty = excluded.min_qty,
    target_qty = excluded.target_qty,
    reorder_qty = excluded.reorder_qty,
    preferred_vendor_id = excluded.preferred_vendor_id,
    is_active = excluded.is_active;

  get diagnostics v_count = row_count;

  return jsonb_build_object('saved', v_count);
end;
$$;

create or replace function public.erp_reorder_suggestions(
  p_warehouse_id uuid,
  p_query text default null,
  p_only_below_min boolean default true,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  warehouse_id uuid,
  variant_id uuid,
  sku text,
  style_code text,
  product_title text,
  size text,
  color text,
  hsn text,
  on_hand int,
  min_qty int,
  target_qty int,
  suggested_qty int,
  preferred_vendor_id uuid,
  preferred_vendor_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  with normalized as (
    select nullif(trim(p_query), '') as q
  ),
  ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(l.qty)::int as qty
    from public.erp_inventory_ledger l
    where l.company_id = v_company_id
      and l.warehouse_id = p_warehouse_id
    group by l.warehouse_id, l.variant_id
  )
  select
    r.warehouse_id,
    r.variant_id,
    v.sku,
    p.style_code,
    p.title as product_title,
    v.size,
    v.color,
    p.hsn_code as hsn,
    coalesce(lt.qty, 0) as on_hand,
    r.min_qty,
    r.target_qty,
    case
      when r.reorder_qty is not null then r.reorder_qty
      when r.target_qty is not null then greatest(0, r.target_qty - coalesce(lt.qty, 0))
      else greatest(0, r.min_qty - coalesce(lt.qty, 0))
    end as suggested_qty,
    r.preferred_vendor_id,
    vnd.legal_name as preferred_vendor_name
  from public.erp_inventory_reorder_rules r
  join public.erp_variants v
    on v.id = r.variant_id
   and v.company_id = v_company_id
  join public.erp_products p
    on p.id = v.product_id
   and p.company_id = v_company_id
  left join ledger_totals lt
    on lt.warehouse_id = r.warehouse_id
   and lt.variant_id = r.variant_id
  left join public.erp_vendors vnd
    on vnd.id = r.preferred_vendor_id
   and vnd.company_id = v_company_id
  where r.company_id = v_company_id
    and r.warehouse_id = p_warehouse_id
    and r.is_active
    and (
      (select q from normalized) is null
      or v.sku ilike '%' || (select q from normalized) || '%'
      or coalesce(p.style_code, '') ilike '%' || (select q from normalized) || '%'
      or p.title ilike '%' || (select q from normalized) || '%'
    )
    and (not p_only_below_min or coalesce(lt.qty, 0) < r.min_qty)
  order by v.sku asc
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.erp_po_create_from_reorder(
  p_vendor_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_po_id uuid;
  v_notes text;
  v_line_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items payload must be a JSON array';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_vendors v
    where v.id = p_vendor_id
      and v.company_id = v_company_id
  ) then
    raise exception 'Vendor not found';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  v_notes := null;
  if p_reference is not null and trim(p_reference) <> '' then
    v_notes := 'Reference: ' || trim(p_reference);
  end if;
  if p_notes is not null and trim(p_notes) <> '' then
    if v_notes is null then
      v_notes := trim(p_notes);
    else
      v_notes := v_notes || E'\n' || trim(p_notes);
    end if;
  end if;

  insert into public.erp_purchase_orders (
    company_id,
    vendor_id,
    status,
    order_date,
    expected_delivery_date,
    notes,
    deliver_to_warehouse_id
  )
  values (
    v_company_id,
    p_vendor_id,
    'draft',
    current_date,
    null,
    v_notes,
    p_warehouse_id
  )
  returning id into v_po_id;

  with input_rows as (
    select
      i.variant_id,
      greatest(coalesce(i.qty, 0), 0) as qty
    from jsonb_to_recordset(p_items) as i(
      variant_id uuid,
      qty int
    )
  ),
  filtered as (
    select i.variant_id, i.qty
    from input_rows i
    join public.erp_variants v
      on v.id = i.variant_id
     and v.company_id = v_company_id
    where i.qty > 0
  )
  insert into public.erp_purchase_order_lines (
    company_id,
    purchase_order_id,
    variant_id,
    ordered_qty,
    unit_cost
  )
  select
    v_company_id,
    v_po_id,
    f.variant_id,
    f.qty,
    null
  from filtered f;

  get diagnostics v_line_count = row_count;

  if v_line_count = 0 then
    raise exception 'No valid items to add';
  end if;

  return v_po_id;
end;
$$;

revoke all on function public.erp_reorder_rules_upsert(jsonb) from public;
grant execute on function public.erp_reorder_rules_upsert(jsonb) to authenticated;

revoke all on function public.erp_reorder_suggestions(uuid, text, boolean, int, int) from public;
grant execute on function public.erp_reorder_suggestions(uuid, text, boolean, int, int) to authenticated;

revoke all on function public.erp_po_create_from_reorder(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.erp_po_create_from_reorder(uuid, uuid, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
