-- Stock transfers + return receipts

-- Expand inventory writer gate to include inventory role
create or replace function public.erp_require_inventory_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_inventory_writer() from public;
grant execute on function public.erp_require_inventory_writer() to authenticated;

create table if not exists public.erp_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  status text not null default 'draft',
  from_warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  to_warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  transfer_date date not null default current_date,
  reference text null,
  notes text null,
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_stock_transfers_status_check
    check (status in ('draft', 'posted', 'cancelled')),
  constraint erp_stock_transfers_warehouse_check
    check (from_warehouse_id <> to_warehouse_id)
);

create index if not exists erp_stock_transfers_company_id_idx
  on public.erp_stock_transfers (company_id);

create index if not exists erp_stock_transfers_from_warehouse_id_idx
  on public.erp_stock_transfers (from_warehouse_id);

create index if not exists erp_stock_transfers_to_warehouse_id_idx
  on public.erp_stock_transfers (to_warehouse_id);

create table if not exists public.erp_stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  transfer_id uuid not null references public.erp_stock_transfers (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty numeric not null check (qty > 0),
  created_at timestamptz not null default now()
);

create index if not exists erp_stock_transfer_lines_company_id_idx
  on public.erp_stock_transfer_lines (company_id);

create index if not exists erp_stock_transfer_lines_transfer_id_idx
  on public.erp_stock_transfer_lines (transfer_id);

create table if not exists public.erp_return_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  status text not null default 'draft',
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  receipt_date date not null default current_date,
  receipt_type text not null default 'return',
  reference text null,
  notes text null,
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_return_receipts_status_check
    check (status in ('draft', 'posted', 'cancelled')),
  constraint erp_return_receipts_type_check
    check (receipt_type in ('return', 'rto'))
);

create index if not exists erp_return_receipts_company_id_idx
  on public.erp_return_receipts (company_id);

create index if not exists erp_return_receipts_warehouse_id_idx
  on public.erp_return_receipts (warehouse_id);

create table if not exists public.erp_return_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  receipt_id uuid not null references public.erp_return_receipts (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty numeric not null check (qty > 0),
  condition text null,
  created_at timestamptz not null default now()
);

create index if not exists erp_return_receipt_lines_company_id_idx
  on public.erp_return_receipt_lines (company_id);

create index if not exists erp_return_receipt_lines_receipt_id_idx
  on public.erp_return_receipt_lines (receipt_id);

alter table public.erp_stock_transfers enable row level security;
alter table public.erp_stock_transfers force row level security;
alter table public.erp_stock_transfer_lines enable row level security;
alter table public.erp_stock_transfer_lines force row level security;

alter table public.erp_return_receipts enable row level security;
alter table public.erp_return_receipts force row level security;
alter table public.erp_return_receipt_lines enable row level security;
alter table public.erp_return_receipt_lines force row level security;

do $$
begin
  drop policy if exists erp_stock_transfers_select on public.erp_stock_transfers;
  drop policy if exists erp_stock_transfers_write on public.erp_stock_transfers;
  drop policy if exists erp_stock_transfer_lines_select on public.erp_stock_transfer_lines;
  drop policy if exists erp_stock_transfer_lines_write on public.erp_stock_transfer_lines;

  drop policy if exists erp_return_receipts_select on public.erp_return_receipts;
  drop policy if exists erp_return_receipts_write on public.erp_return_receipts;
  drop policy if exists erp_return_receipt_lines_select on public.erp_return_receipt_lines;
  drop policy if exists erp_return_receipt_lines_write on public.erp_return_receipt_lines;

  create policy erp_stock_transfers_select
    on public.erp_stock_transfers
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

  create policy erp_stock_transfers_write
    on public.erp_stock_transfers
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

  create policy erp_stock_transfer_lines_select
    on public.erp_stock_transfer_lines
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

  create policy erp_stock_transfer_lines_write
    on public.erp_stock_transfer_lines
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

  create policy erp_return_receipts_select
    on public.erp_return_receipts
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

  create policy erp_return_receipts_write
    on public.erp_return_receipts
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

  create policy erp_return_receipt_lines_select
    on public.erp_return_receipt_lines
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

  create policy erp_return_receipt_lines_write
    on public.erp_return_receipt_lines
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

create or replace function public.erp_stock_transfer_create(
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_transfer_date date default current_date,
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
  v_transfer_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_from_warehouse_id is null or p_to_warehouse_id is null then
    raise exception 'from and to warehouse are required';
  end if;

  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'Source and destination warehouses must be different';
  end if;

  insert into public.erp_stock_transfers (
    company_id,
    from_warehouse_id,
    to_warehouse_id,
    transfer_date,
    reference,
    notes,
    created_at,
    created_by,
    updated_at
  )
  values (
    v_company_id,
    p_from_warehouse_id,
    p_to_warehouse_id,
    coalesce(p_transfer_date, current_date),
    nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid(),
    now()
  )
  returning id into v_transfer_id;

  return v_transfer_id;
end;
$$;

revoke all on function public.erp_stock_transfer_create(uuid, uuid, date, text, text) from public;
grant execute on function public.erp_stock_transfer_create(uuid, uuid, date, text, text) to authenticated;

create or replace function public.erp_stock_transfer_update_header(
  p_transfer_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_transfer_date date,
  p_reference text,
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
    from public.erp_stock_transfers
   where id = p_transfer_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Transfer not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft transfers can be updated';
  end if;

  if p_from_warehouse_id is null or p_to_warehouse_id is null then
    raise exception 'from and to warehouse are required';
  end if;

  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'Source and destination warehouses must be different';
  end if;

  update public.erp_stock_transfers
     set from_warehouse_id = p_from_warehouse_id,
         to_warehouse_id = p_to_warehouse_id,
         transfer_date = coalesce(p_transfer_date, transfer_date),
         reference = nullif(trim(p_reference), ''),
         notes = nullif(trim(p_notes), ''),
         updated_at = now()
   where id = p_transfer_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_stock_transfer_update_header(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.erp_stock_transfer_update_header(uuid, uuid, uuid, date, text, text) to authenticated;

create or replace function public.erp_stock_transfer_upsert_lines(
  p_transfer_id uuid,
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
    from public.erp_stock_transfers
   where id = p_transfer_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Transfer not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft transfers can update lines';
  end if;

  delete from public.erp_stock_transfer_lines
   where transfer_id = p_transfer_id
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

    insert into public.erp_stock_transfer_lines (
      company_id,
      transfer_id,
      variant_id,
      qty,
      created_at
    )
    values (
      v_company_id,
      p_transfer_id,
      v_variant_id,
      v_qty,
      now()
    );
  end loop;
end;
$$;

revoke all on function public.erp_stock_transfer_upsert_lines(uuid, jsonb) from public;
grant execute on function public.erp_stock_transfer_upsert_lines(uuid, jsonb) to authenticated;

create or replace function public.erp_stock_transfer_post(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_transfer record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
  v_insufficient record;
  v_sku text;
  v_warehouse_name text;
  v_qty integer;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_transfer
    from public.erp_stock_transfers
   where id = p_transfer_id
     and company_id = v_company_id
   for update;

  if v_transfer.id is null then
    raise exception 'Transfer not found';
  end if;

  if v_transfer.status <> 'draft' then
    raise exception 'Only draft transfers can be posted';
  end if;

  if v_transfer.from_warehouse_id = v_transfer.to_warehouse_id then
    raise exception 'Source and destination warehouses must be different';
  end if;

  select count(*) into v_total_lines
    from public.erp_stock_transfer_lines
   where transfer_id = p_transfer_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Transfer has no lines to post';
  end if;

  for v_insufficient in
    select
      l.variant_id,
      sum(l.qty) as transfer_qty,
      coalesce(sum(il.qty), 0) as on_hand
    from public.erp_stock_transfer_lines l
    left join public.erp_inventory_ledger il
      on il.company_id = v_company_id
     and il.warehouse_id = v_transfer.from_warehouse_id
     and il.variant_id = l.variant_id
    where l.transfer_id = p_transfer_id
      and l.company_id = v_company_id
    group by l.variant_id
    having coalesce(sum(il.qty), 0) < sum(l.qty)
  loop
    select sku into v_sku
      from public.erp_variants
     where id = v_insufficient.variant_id;

    select name into v_warehouse_name
      from public.erp_warehouses
     where id = v_transfer.from_warehouse_id;

    raise exception 'Insufficient stock for SKU % in %', coalesce(v_sku, v_insufficient.variant_id::text), coalesce(v_warehouse_name, 'warehouse');
  end loop;

  v_ref := 'TRANSFER:' || p_transfer_id::text;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    qty_type,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_transfer.from_warehouse_id,
    l.variant_id,
    abs(l.qty)::integer,
    'out',
    'TRANSFER',
    coalesce(nullif(trim(v_transfer.reference), ''), 'Stock transfer'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_stock_transfer_lines l
  where l.transfer_id = p_transfer_id
    and l.company_id = v_company_id;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty,
    qty_type,
    type,
    reason,
    ref,
    created_by,
    created_at
  )
  select
    v_company_id,
    v_transfer.to_warehouse_id,
    l.variant_id,
    abs(l.qty)::integer,
    'in',
    'TRANSFER',
    coalesce(nullif(trim(v_transfer.reference), ''), 'Stock transfer'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_stock_transfer_lines l
  where l.transfer_id = p_transfer_id
    and l.company_id = v_company_id;

  update public.erp_stock_transfers
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_transfer_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_stock_transfer_lines
   where transfer_id = p_transfer_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_stock_transfer_post(uuid) from public;
grant execute on function public.erp_stock_transfer_post(uuid) to authenticated;

create or replace function public.erp_return_receipt_create(
  p_warehouse_id uuid,
  p_receipt_type text default 'return',
  p_reference text default null,
  p_notes text default null,
  p_receipt_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_receipt_id uuid;
  v_type text := lower(coalesce(p_receipt_type, 'return'));
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if v_type not in ('return', 'rto') then
    raise exception 'receipt_type must be return or rto';
  end if;

  insert into public.erp_return_receipts (
    company_id,
    warehouse_id,
    receipt_type,
    receipt_date,
    reference,
    notes,
    created_at,
    created_by,
    updated_at
  )
  values (
    v_company_id,
    p_warehouse_id,
    v_type,
    coalesce(p_receipt_date, current_date),
    nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid(),
    now()
  )
  returning id into v_receipt_id;

  return v_receipt_id;
end;
$$;

revoke all on function public.erp_return_receipt_create(uuid, text, text, text, date) from public;
grant execute on function public.erp_return_receipt_create(uuid, text, text, text, date) to authenticated;

create or replace function public.erp_return_receipt_update_header(
  p_receipt_id uuid,
  p_warehouse_id uuid,
  p_receipt_type text,
  p_receipt_date date,
  p_reference text,
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
  v_type text := lower(coalesce(p_receipt_type, 'return'));
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select status into v_status
    from public.erp_return_receipts
   where id = p_receipt_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Return receipt not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft receipts can be updated';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if v_type not in ('return', 'rto') then
    raise exception 'receipt_type must be return or rto';
  end if;

  update public.erp_return_receipts
     set warehouse_id = p_warehouse_id,
         receipt_type = v_type,
         receipt_date = coalesce(p_receipt_date, receipt_date),
         reference = nullif(trim(p_reference), ''),
         notes = nullif(trim(p_notes), ''),
         updated_at = now()
   where id = p_receipt_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_return_receipt_update_header(uuid, uuid, text, date, text, text) from public;
grant execute on function public.erp_return_receipt_update_header(uuid, uuid, text, date, text, text) to authenticated;

create or replace function public.erp_return_receipt_upsert_lines(
  p_receipt_id uuid,
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
  v_condition text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be an array';
  end if;

  select status into v_status
    from public.erp_return_receipts
   where id = p_receipt_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Return receipt not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft receipts can update lines';
  end if;

  delete from public.erp_return_receipt_lines
   where receipt_id = p_receipt_id
     and company_id = v_company_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(trim(v_line->>'variant_id'), '')::uuid;
    v_qty := nullif(trim(v_line->>'qty'), '')::numeric;
    v_condition := nullif(trim(v_line->>'condition'), '');

    if v_variant_id is null then
      raise exception 'variant_id is required';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'qty must be greater than 0';
    end if;

    if v_qty <> trunc(v_qty) then
      raise exception 'qty must be a whole number';
    end if;

    insert into public.erp_return_receipt_lines (
      company_id,
      receipt_id,
      variant_id,
      qty,
      condition,
      created_at
    )
    values (
      v_company_id,
      p_receipt_id,
      v_variant_id,
      v_qty,
      v_condition,
      now()
    );
  end loop;
end;
$$;

revoke all on function public.erp_return_receipt_upsert_lines(uuid, jsonb) from public;
grant execute on function public.erp_return_receipt_upsert_lines(uuid, jsonb) to authenticated;

create or replace function public.erp_return_receipt_post(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_receipt record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
  v_type text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_receipt
    from public.erp_return_receipts
   where id = p_receipt_id
     and company_id = v_company_id
   for update;

  if v_receipt.id is null then
    raise exception 'Return receipt not found';
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'Only draft receipts can be posted';
  end if;

  select count(*) into v_total_lines
    from public.erp_return_receipt_lines
   where receipt_id = p_receipt_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Receipt has no lines to post';
  end if;

  v_type := case when v_receipt.receipt_type = 'rto' then 'RTO' else 'RETURN' end;
  v_ref := v_type || ':' || p_receipt_id::text;

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
    v_receipt.warehouse_id,
    l.variant_id,
    abs(l.qty)::integer,
    v_type,
    coalesce(nullif(trim(v_receipt.reference), ''), 'Return receipt'),
    v_ref,
    auth.uid(),
    now()
  from public.erp_return_receipt_lines l
  where l.receipt_id = p_receipt_id
    and l.company_id = v_company_id;

  update public.erp_return_receipts
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_receipt_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_return_receipt_lines
   where receipt_id = p_receipt_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_return_receipt_post(uuid) from public;
grant execute on function public.erp_return_receipt_post(uuid) to authenticated;
