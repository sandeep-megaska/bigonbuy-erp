-- Inventory write-offs / damage

create table if not exists public.erp_inventory_writeoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  status text not null default 'draft',
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  writeoff_date date not null default current_date,
  reason text null,
  ref text null,
  notes text null,
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_inventory_writeoffs_status_check check (status in ('draft', 'posted'))
);

create index if not exists erp_inventory_writeoffs_company_id_idx
  on public.erp_inventory_writeoffs (company_id);

create index if not exists erp_inventory_writeoffs_warehouse_id_idx
  on public.erp_inventory_writeoffs (company_id, warehouse_id);

create table if not exists public.erp_inventory_writeoff_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  writeoff_id uuid not null references public.erp_inventory_writeoffs (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty int not null check (qty > 0),
  created_at timestamptz not null default now()
);

create index if not exists erp_inventory_writeoff_lines_company_id_idx
  on public.erp_inventory_writeoff_lines (company_id);

create index if not exists erp_inventory_writeoff_lines_writeoff_id_idx
  on public.erp_inventory_writeoff_lines (writeoff_id);

alter table public.erp_inventory_writeoffs enable row level security;
alter table public.erp_inventory_writeoffs force row level security;
alter table public.erp_inventory_writeoff_lines enable row level security;
alter table public.erp_inventory_writeoff_lines force row level security;

do $$
begin
  drop policy if exists erp_inventory_writeoffs_select on public.erp_inventory_writeoffs;
  drop policy if exists erp_inventory_writeoffs_write on public.erp_inventory_writeoffs;
  drop policy if exists erp_inventory_writeoff_lines_select on public.erp_inventory_writeoff_lines;
  drop policy if exists erp_inventory_writeoff_lines_write on public.erp_inventory_writeoff_lines;

  create policy erp_inventory_writeoffs_select
    on public.erp_inventory_writeoffs
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

  create policy erp_inventory_writeoffs_write
    on public.erp_inventory_writeoffs
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

  create policy erp_inventory_writeoff_lines_select
    on public.erp_inventory_writeoff_lines
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

  create policy erp_inventory_writeoff_lines_write
    on public.erp_inventory_writeoff_lines
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

create or replace function public.erp_inventory_writeoff_create(
  p_warehouse_id uuid,
  p_date date default current_date,
  p_reason text default null,
  p_ref text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_writeoff_id uuid;
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

  insert into public.erp_inventory_writeoffs (
    company_id,
    warehouse_id,
    writeoff_date,
    reason,
    ref,
    notes,
    created_at,
    created_by,
    updated_at
  )
  values (
    v_company_id,
    p_warehouse_id,
    coalesce(p_date, current_date),
    nullif(trim(p_reason), ''),
    nullif(trim(p_ref), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid(),
    now()
  )
  returning id into v_writeoff_id;

  return v_writeoff_id;
end;
$$;

revoke all on function public.erp_inventory_writeoff_create(uuid, date, text, text, text) from public;
grant execute on function public.erp_inventory_writeoff_create(uuid, date, text, text, text) to authenticated;

create or replace function public.erp_inventory_writeoff_update_header(
  p_id uuid,
  p_warehouse_id uuid,
  p_date date,
  p_reason text,
  p_ref text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select status into v_status
    from public.erp_inventory_writeoffs
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Write-off not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft write-offs can be updated';
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

  update public.erp_inventory_writeoffs
     set warehouse_id = p_warehouse_id,
         writeoff_date = coalesce(p_date, writeoff_date),
         reason = nullif(trim(p_reason), ''),
         ref = nullif(trim(p_ref), ''),
         notes = nullif(trim(p_notes), ''),
         updated_at = now()
   where id = p_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_inventory_writeoff_update_header(uuid, uuid, date, text, text, text) from public;
grant execute on function public.erp_inventory_writeoff_update_header(uuid, uuid, date, text, text, text) to authenticated;

create or replace function public.erp_inventory_writeoff_save_lines(
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
  v_qty numeric;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  select status into v_status
    from public.erp_inventory_writeoffs
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Write-off not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft write-offs can update lines';
  end if;

  delete from public.erp_inventory_writeoff_lines
   where writeoff_id = p_id
     and company_id = v_company_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(trim(v_line->>'variant_id'), '')::uuid;
    v_qty := nullif(trim(v_line->>'qty'), '')::numeric;

    if v_variant_id is null then
      raise exception 'variant_id is required';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'qty must be greater than 0';
    end if;

    if v_qty <> trunc(v_qty) then
      raise exception 'qty must be a whole number';
    end if;

    insert into public.erp_inventory_writeoff_lines (
      company_id,
      writeoff_id,
      variant_id,
      qty,
      created_at
    )
    values (
      v_company_id,
      p_id,
      v_variant_id,
      v_qty::int,
      now()
    );
  end loop;
end;
$$;

revoke all on function public.erp_inventory_writeoff_save_lines(uuid, jsonb) from public;
grant execute on function public.erp_inventory_writeoff_save_lines(uuid, jsonb) to authenticated;

create or replace function public.erp_inventory_writeoff_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_writeoff record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_reason text;
  v_ref text;
  v_insufficient record;
  v_sku text;
  v_warehouse_name text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_writeoff
    from public.erp_inventory_writeoffs
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_writeoff.id is null then
    raise exception 'Write-off not found';
  end if;

  if v_writeoff.status <> 'draft' then
    raise exception 'Only draft write-offs can be posted';
  end if;

  select count(*) into v_total_lines
    from public.erp_inventory_writeoff_lines
   where writeoff_id = p_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Write-off has no lines to post';
  end if;

  for v_insufficient in
    select
      l.variant_id,
      sum(l.qty) as writeoff_qty,
      coalesce(sum(il.qty), 0) as on_hand
    from public.erp_inventory_writeoff_lines l
    left join public.erp_inventory_ledger il
      on il.company_id = v_company_id
     and il.warehouse_id = v_writeoff.warehouse_id
     and il.variant_id = l.variant_id
    where l.writeoff_id = p_id
      and l.company_id = v_company_id
    group by l.variant_id
    having coalesce(sum(il.qty), 0) < sum(l.qty)
  loop
    select sku into v_sku
      from public.erp_variants
     where id = v_insufficient.variant_id;

    select name into v_warehouse_name
      from public.erp_warehouses
     where id = v_writeoff.warehouse_id;

    raise exception 'Insufficient stock for SKU % in %',
      coalesce(v_sku, v_insufficient.variant_id::text),
      coalesce(v_warehouse_name, 'warehouse');
  end loop;

  v_reason := coalesce(nullif(trim(v_writeoff.reason), ''), 'Write-off');
  v_ref := coalesce(nullif(trim(v_writeoff.ref), ''), 'WO:' || p_id::text);

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
    v_writeoff.warehouse_id,
    l.variant_id,
    -abs(l.qty)::integer,
    'damage_out',
    v_reason,
    v_ref,
    auth.uid(),
    now()
  from public.erp_inventory_writeoff_lines l
  where l.writeoff_id = p_id
    and l.company_id = v_company_id;

  update public.erp_inventory_writeoffs
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_inventory_writeoff_lines
   where writeoff_id = p_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_inventory_writeoff_post(uuid) from public;
grant execute on function public.erp_inventory_writeoff_post(uuid) to authenticated;

notify pgrst, 'reload schema';
