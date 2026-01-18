-- Sales consumption module

create table if not exists public.erp_sales_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint erp_sales_channels_company_code_key unique (company_id, code)
);

create index if not exists erp_sales_channels_company_id_idx
  on public.erp_sales_channels (company_id);

create table if not exists public.erp_sales_consumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  status text not null default 'draft',
  consumption_date date not null default current_date,
  channel_id uuid not null references public.erp_sales_channels (id) on delete restrict,
  warehouse_id uuid not null references public.erp_warehouses (id) on delete restrict,
  reference text null,
  notes text null,
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_sales_consumptions_status_check check (status in ('draft', 'posted'))
);

create index if not exists erp_sales_consumptions_company_id_idx
  on public.erp_sales_consumptions (company_id);

create index if not exists erp_sales_consumptions_channel_date_idx
  on public.erp_sales_consumptions (company_id, channel_id, consumption_date);

create index if not exists erp_sales_consumptions_warehouse_idx
  on public.erp_sales_consumptions (company_id, warehouse_id);

create table if not exists public.erp_sales_consumption_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  consumption_id uuid not null references public.erp_sales_consumptions (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty int not null check (qty > 0),
  created_at timestamptz not null default now()
);

create index if not exists erp_sales_consumption_lines_company_id_idx
  on public.erp_sales_consumption_lines (company_id);

create index if not exists erp_sales_consumption_lines_consumption_id_idx
  on public.erp_sales_consumption_lines (consumption_id);

alter table public.erp_sales_channels enable row level security;
alter table public.erp_sales_channels force row level security;

alter table public.erp_sales_consumptions enable row level security;
alter table public.erp_sales_consumptions force row level security;

alter table public.erp_sales_consumption_lines enable row level security;
alter table public.erp_sales_consumption_lines force row level security;

do $$
begin
  drop policy if exists erp_sales_channels_select on public.erp_sales_channels;
  drop policy if exists erp_sales_channels_write on public.erp_sales_channels;
  drop policy if exists erp_sales_consumptions_select on public.erp_sales_consumptions;
  drop policy if exists erp_sales_consumptions_write on public.erp_sales_consumptions;
  drop policy if exists erp_sales_consumption_lines_select on public.erp_sales_consumption_lines;
  drop policy if exists erp_sales_consumption_lines_write on public.erp_sales_consumption_lines;

  create policy erp_sales_channels_select
    on public.erp_sales_channels
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

  create policy erp_sales_channels_write
    on public.erp_sales_channels
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

  create policy erp_sales_consumptions_select
    on public.erp_sales_consumptions
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

  create policy erp_sales_consumptions_write
    on public.erp_sales_consumptions
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

  create policy erp_sales_consumption_lines_select
    on public.erp_sales_consumption_lines
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

  create policy erp_sales_consumption_lines_write
    on public.erp_sales_consumption_lines
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

insert into public.erp_sales_channels (company_id, code, name, is_active)
select c.id, v.code, v.name, true
from public.erp_companies c
cross join (
  values
    ('amazon', 'Amazon'),
    ('myntra', 'Myntra'),
    ('shopify', 'Shopify'),
    ('flipkart', 'Flipkart'),
    ('snapdeal', 'Snapdeal')
) as v(code, name)
on conflict (company_id, code) do nothing;

create or replace function public.erp_sales_channels_list()
returns table (
  id uuid,
  code text,
  name text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select id, code, name, is_active
  from public.erp_sales_channels
  where company_id = public.erp_current_company_id()
  order by name;
$$;

revoke all on function public.erp_sales_channels_list() from public;
grant execute on function public.erp_sales_channels_list() to authenticated;

create or replace function public.erp_sales_consumption_create(
  p_channel_id uuid,
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
  v_consumption_id uuid;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_channel_id is null then
    raise exception 'channel_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_sales_channels sc
    where sc.id = p_channel_id
      and sc.company_id = v_company_id
  ) then
    raise exception 'Sales channel not found';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  insert into public.erp_sales_consumptions (
    company_id,
    channel_id,
    warehouse_id,
    consumption_date,
    reference,
    notes,
    created_at,
    created_by,
    updated_at
  )
  values (
    v_company_id,
    p_channel_id,
    p_warehouse_id,
    coalesce(p_date, current_date),
    nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''),
    now(),
    auth.uid(),
    now()
  )
  returning id into v_consumption_id;

  return v_consumption_id;
end;
$$;

revoke all on function public.erp_sales_consumption_create(uuid, uuid, date, text, text) from public;
grant execute on function public.erp_sales_consumption_create(uuid, uuid, date, text, text) to authenticated;

create or replace function public.erp_sales_consumption_get(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_header record;
  v_lines jsonb;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_id is null then
    raise exception 'consumption id is required';
  end if;

  select
    sc.id,
    sc.status,
    sc.consumption_date,
    sc.channel_id,
    sc.warehouse_id,
    sc.reference,
    sc.notes,
    sc.posted_at
  into v_header
  from public.erp_sales_consumptions sc
  where sc.id = p_id
    and sc.company_id = v_company_id;

  if v_header.id is null then
    raise exception 'Sales consumption not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'variant_id', l.variant_id,
        'qty', l.qty
      )
      order by l.created_at
    ),
    '[]'::jsonb
  )
  into v_lines
  from public.erp_sales_consumption_lines l
  where l.company_id = v_company_id
    and l.consumption_id = p_id;

  return jsonb_build_object('header', to_jsonb(v_header), 'lines', v_lines);
end;
$$;

revoke all on function public.erp_sales_consumption_get(uuid) from public;
grant execute on function public.erp_sales_consumption_get(uuid) to authenticated;

create or replace function public.erp_sales_consumption_save_lines(
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
    from public.erp_sales_consumptions
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Sales consumption not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft consumptions can update lines';
  end if;

  delete from public.erp_sales_consumption_lines
   where consumption_id = p_id
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

    insert into public.erp_sales_consumption_lines (
      company_id,
      consumption_id,
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

revoke all on function public.erp_sales_consumption_save_lines(uuid, jsonb) from public;
grant execute on function public.erp_sales_consumption_save_lines(uuid, jsonb) to authenticated;

create or replace function public.erp_sales_consumption_update_header(
  p_id uuid,
  p_channel_id uuid,
  p_warehouse_id uuid,
  p_date date,
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
    from public.erp_sales_consumptions
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_status is null then
    raise exception 'Sales consumption not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft consumptions can be updated';
  end if;

  if p_channel_id is null then
    raise exception 'channel_id is required';
  end if;

  if p_warehouse_id is null then
    raise exception 'warehouse_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_sales_channels sc
    where sc.id = p_channel_id
      and sc.company_id = v_company_id
  ) then
    raise exception 'Sales channel not found';
  end if;

  if not exists (
    select 1
    from public.erp_warehouses w
    where w.id = p_warehouse_id
      and w.company_id = v_company_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  update public.erp_sales_consumptions
     set channel_id = p_channel_id,
         warehouse_id = p_warehouse_id,
         consumption_date = coalesce(p_date, consumption_date),
         reference = nullif(trim(p_reference), ''),
         notes = nullif(trim(p_notes), ''),
         updated_at = now()
   where id = p_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_sales_consumption_update_header(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.erp_sales_consumption_update_header(uuid, uuid, uuid, date, text, text) to authenticated;

create or replace function public.erp_sales_consumption_post(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_consumption record;
  v_total_lines integer := 0;
  v_posted_lines integer := 0;
  v_ref text;
  v_reason text;
  v_channel_name text;
  v_insufficient record;
  v_sku text;
  v_warehouse_name text;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  select * into v_consumption
    from public.erp_sales_consumptions
   where id = p_id
     and company_id = v_company_id
   for update;

  if v_consumption.id is null then
    raise exception 'Sales consumption not found';
  end if;

  if v_consumption.status <> 'draft' then
    raise exception 'Only draft consumptions can be posted';
  end if;

  select count(*) into v_total_lines
    from public.erp_sales_consumption_lines
   where consumption_id = p_id
     and company_id = v_company_id;

  if v_total_lines = 0 then
    raise exception 'Sales consumption has no lines to post';
  end if;

  for v_insufficient in
    select
      l.variant_id,
      sum(l.qty) as consume_qty,
      coalesce(sum(il.qty), 0) as on_hand
    from public.erp_sales_consumption_lines l
    left join public.erp_inventory_ledger il
      on il.company_id = v_company_id
     and il.warehouse_id = v_consumption.warehouse_id
     and il.variant_id = l.variant_id
    where l.consumption_id = p_id
      and l.company_id = v_company_id
    group by l.variant_id
    having coalesce(sum(il.qty), 0) < sum(l.qty)
  loop
    select sku into v_sku
      from public.erp_variants
     where id = v_insufficient.variant_id;

    select name into v_warehouse_name
      from public.erp_warehouses
     where id = v_consumption.warehouse_id;

    raise exception 'Insufficient stock for SKU % in %',
      coalesce(v_sku, v_insufficient.variant_id::text),
      coalesce(v_warehouse_name, 'warehouse');
  end loop;

  select name into v_channel_name
    from public.erp_sales_channels
   where id = v_consumption.channel_id;

  v_ref := 'SALES-CONSUMPTION:' || p_id::text;
  v_reason := format('Sales consumption (%s)', coalesce(v_channel_name, 'channel'));

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
    v_consumption.warehouse_id,
    l.variant_id,
    -abs(l.qty)::integer,
    'sale_out',
    v_reason,
    v_ref,
    auth.uid(),
    now()
  from public.erp_sales_consumption_lines l
  where l.consumption_id = p_id
    and l.company_id = v_company_id;

  update public.erp_sales_consumptions
     set status = 'posted',
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   where id = p_id
     and company_id = v_company_id;

  select count(*) into v_posted_lines
    from public.erp_sales_consumption_lines
   where consumption_id = p_id
     and company_id = v_company_id;

  return jsonb_build_object('ok', true, 'posted_lines', v_posted_lines);
end;
$$;

revoke all on function public.erp_sales_consumption_post(uuid) from public;
grant execute on function public.erp_sales_consumption_post(uuid) to authenticated;

notify pgrst, 'reload schema';
