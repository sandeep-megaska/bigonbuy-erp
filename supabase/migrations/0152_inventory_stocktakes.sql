-- Inventory stocktakes

create table if not exists public.erp_stocktakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  status text not null default 'draft',
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  stocktake_date date not null default current_date,
  reference text null,
  notes text null,
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_stocktakes_status_check check (status in ('draft', 'posted'))
);

create index if not exists erp_stocktakes_company_id_idx
  on public.erp_stocktakes (company_id);

create index if not exists erp_stocktakes_warehouse_date_idx
  on public.erp_stocktakes (company_id, warehouse_id, stocktake_date);

create table if not exists public.erp_stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  stocktake_id uuid not null references public.erp_stocktakes (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  counted_qty int not null check (counted_qty >= 0),
  created_at timestamptz not null default now(),
  constraint erp_stocktake_lines_unique unique (company_id, stocktake_id, variant_id)
);

create index if not exists erp_stocktake_lines_company_id_idx
  on public.erp_stocktake_lines (company_id);

create index if not exists erp_stocktake_lines_stocktake_id_idx
  on public.erp_stocktake_lines (stocktake_id);

alter table public.erp_stocktakes enable row level security;
alter table public.erp_stocktakes force row level security;

alter table public.erp_stocktake_lines enable row level security;
alter table public.erp_stocktake_lines force row level security;

do $$
begin
  drop policy if exists erp_stocktakes_select on public.erp_stocktakes;
  drop policy if exists erp_stocktakes_write on public.erp_stocktakes;
  drop policy if exists erp_stocktake_lines_select on public.erp_stocktake_lines;
  drop policy if exists erp_stocktake_lines_write on public.erp_stocktake_lines;

  create policy erp_stocktakes_select
    on public.erp_stocktakes
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

  create policy erp_stocktakes_write
    on public.erp_stocktakes
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

  create policy erp_stocktake_lines_select
    on public.erp_stocktake_lines
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

  create policy erp_stocktake_lines_write
    on public.erp_stocktake_lines
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

create or replace function public.erp_stocktake_create(
  p_warehouse_id uuid,
  p_date date default current_date,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_stocktake_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  insert into public.erp_stocktakes (
    company_id,
    warehouse_id,
    stocktake_date,
    reference,
    notes,
    created_at,
    created_by,
    updated_at
  )
  values (
    v_company_id,
    p_warehouse_id,
    coalesce(p_date, current_date),
    nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid(),
    now()
  )
  returning id into v_stocktake_id;

  return v_stocktake_id;
end;
$$;

revoke all on function public.erp_stocktake_create(uuid, date, text, text) from public;
grant execute on function public.erp_stocktake_create(uuid, date, text, text) to authenticated;

create or replace function public.erp_stocktake_save_lines(
  p_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text;
  v_line jsonb;
  v_variant_id uuid;
  v_counted_qty numeric;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  select status into v_status
    from public.erp_stocktakes
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Stocktake not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft stocktakes can update lines';
  end if;

  delete from public.erp_stocktake_lines
   where stocktake_id = p_id
     and company_id = v_company_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(trim(v_line->>'variant_id'), '')::uuid;
    v_counted_qty := nullif(trim(v_line->>'counted_qty'), '')::numeric;

    if v_variant_id is null then
      raise exception 'variant_id is required';
    end if;

    if v_counted_qty is null or v_counted_qty < 0 then
      raise exception 'counted_qty must be 0 or greater';
    end if;

    if v_counted_qty <> trunc(v_counted_qty) then
      raise exception 'counted_qty must be a whole number';
    end if;

    if not exists (
      select 1
      from public.erp_variants v
      where v.id = v_variant_id
        and v.company_id = v_company_id
    ) then
      raise exception 'Variant not found';
    end if;

    insert into public.erp_stocktake_lines (
      company_id,
      stocktake_id,
      variant_id,
      counted_qty,
      created_at
    )
    values (
      v_company_id,
      p_id,
      v_variant_id,
      v_counted_qty,
      now()
    );
  end loop;

  update public.erp_stocktakes
     set updated_at = now()
   where id = p_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_stocktake_save_lines(uuid, jsonb) from public;
grant execute on function public.erp_stocktake_save_lines(uuid, jsonb) to authenticated;

create or replace function public.erp_stocktake_preview_deltas(p_id uuid)
returns table (
  variant_id uuid,
  sku text,
  product_title text,
  size text,
  color text,
  on_hand int,
  counted_qty int,
  delta int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_stocktake record;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_stocktake
    from public.erp_stocktakes
   where id = p_id
     and company_id = v_company_id;

  if v_stocktake.id is null then
    raise exception 'Stocktake not found';
  end if;

  return query
    with lines as (
      select l.variant_id, l.counted_qty
      from public.erp_stocktake_lines l
      where l.stocktake_id = p_id
        and l.company_id = v_company_id
    ),
    ledger_totals as (
      select l.variant_id, coalesce(sum(l.qty), 0)::int as on_hand
      from public.erp_inventory_ledger l
      where l.company_id = v_company_id
        and l.warehouse_id = v_stocktake.warehouse_id
      group by l.variant_id
    )
    select
      ln.variant_id,
      v.sku,
      p.title as product_title,
      v.size,
      v.color,
      coalesce(lt.on_hand, 0) as on_hand,
      ln.counted_qty,
      ln.counted_qty - coalesce(lt.on_hand, 0) as delta
    from lines ln
    join public.erp_variants v on v.id = ln.variant_id
    join public.erp_products p on p.id = v.product_id
    left join ledger_totals lt on lt.variant_id = ln.variant_id
    where v.company_id = v_company_id
      and p.company_id = v_company_id
    order by v.sku asc;
end;
$$;

revoke all on function public.erp_stocktake_preview_deltas(uuid) from public;
grant execute on function public.erp_stocktake_preview_deltas(uuid) to authenticated;

create or replace function public.erp_stocktake_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_stocktake record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_stocktake
    from public.erp_stocktakes
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_stocktake.id is null then
    raise exception 'Stocktake not found';
  end if;

  if v_stocktake.status <> 'draft' then
    raise exception 'Only draft stocktakes can be posted';
  end if;

  select count(*) into v_total_lines
    from public.erp_stocktake_lines
   where stocktake_id = p_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Stocktake has no lines to post';
  end if;

  v_ref := coalesce(nullif(trim(v_stocktake.reference), ''), 'ST:' || p_id::text);

  select count(*) into v_posted_lines
    from (
      select
        l.variant_id,
        (l.counted_qty - coalesce(sum(il.qty), 0))::int as delta
      from public.erp_stocktake_lines l
      left join public.erp_inventory_ledger il
        on il.company_id = v_company_id
       and il.warehouse_id = v_stocktake.warehouse_id
       and il.variant_id = l.variant_id
      where l.stocktake_id = p_id
        and l.company_id = v_company_id
      group by l.variant_id, l.counted_qty
    ) deltas
   where deltas.delta <> 0;

  with deltas as (
    select
      l.variant_id,
      l.counted_qty,
      coalesce(sum(il.qty), 0)::int as on_hand,
      (l.counted_qty - coalesce(sum(il.qty), 0))::int as delta
    from public.erp_stocktake_lines l
    left join public.erp_inventory_ledger il
      on il.company_id = v_company_id
     and il.warehouse_id = v_stocktake.warehouse_id
     and il.variant_id = l.variant_id
    where l.stocktake_id = p_id
      and l.company_id = v_company_id
    group by l.variant_id, l.counted_qty
  )
  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_stocktake.warehouse_id,
    d.variant_id,
    d.delta,
    case when d.delta > 0 then 'adjust_in' else 'adjust_out' end,
    'Stocktake',
    v_ref,
    auth.uid(),
    now()
  from deltas d
  where d.delta <> 0;

  update public.erp_stocktakes
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_stocktake_post(uuid) from public;
grant execute on function public.erp_stocktake_post(uuid) to authenticated;

notify pgrst, 'reload schema';
