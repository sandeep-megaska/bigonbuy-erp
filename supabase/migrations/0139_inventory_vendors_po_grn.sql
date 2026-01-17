-- Vendors + Purchase Orders + GRN (Phase-1)

-- Ensure inventory ledger has company + warehouse references for GRN posting
alter table public.erp_inventory_ledger
  add column if not exists company_id uuid default public.erp_current_company_id(),
  add column if not exists warehouse_id uuid;

update public.erp_inventory_ledger
   set company_id = public.erp_current_company_id()
 where company_id is null;

alter table public.erp_inventory_ledger
  alter column company_id set not null,
  alter column company_id set default public.erp_current_company_id();

create index if not exists erp_inventory_ledger_company_id_idx
  on public.erp_inventory_ledger (company_id);

-- Extend company counters for PO/GRN numbering
alter table public.erp_company_counters
  add column if not exists po_no_seq bigint not null default 0,
  add column if not exists grn_no_seq bigint not null default 0;

-- Helper to set updated timestamps
create or replace function public.erp_inventory_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Next PO number
create or replace function public.erp_next_po_no(p_company_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(p_company_id, public.erp_current_company_id());
  v_seq bigint;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  insert into public.erp_company_counters (company_id, po_no_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set po_no_seq = public.erp_company_counters.po_no_seq + 1,
                updated_at = now()
  returning po_no_seq into v_seq;

  return 'PO' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.erp_next_po_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.erp_next_po_no(public.erp_current_company_id())
$$;

revoke all on function public.erp_next_po_no(uuid) from public;
grant execute on function public.erp_next_po_no(uuid) to authenticated;

revoke all on function public.erp_next_po_no() from public;
grant execute on function public.erp_next_po_no() to authenticated;

-- Next GRN number
create or replace function public.erp_next_grn_no(p_company_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(p_company_id, public.erp_current_company_id());
  v_seq bigint;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  insert into public.erp_company_counters (company_id, grn_no_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set grn_no_seq = public.erp_company_counters.grn_no_seq + 1,
                updated_at = now()
  returning grn_no_seq into v_seq;

  return 'GRN' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.erp_next_grn_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.erp_next_grn_no(public.erp_current_company_id())
$$;

revoke all on function public.erp_next_grn_no(uuid) from public;
grant execute on function public.erp_next_grn_no(uuid) to authenticated;

revoke all on function public.erp_next_grn_no() from public;
grant execute on function public.erp_next_grn_no() to authenticated;

-- Vendor master
create table if not exists public.erp_vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  vendor_type text not null,
  legal_name text not null,
  gstin text null,
  contact_person text null,
  phone text null,
  email text null,
  address text null,
  payment_terms_days integer not null default 0,
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_vendors_company_id_idx
  on public.erp_vendors (company_id);

-- Purchase Orders
create table if not exists public.erp_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  po_no text not null default public.erp_next_po_no(public.erp_current_company_id()),
  status text not null default 'draft',
  order_date date not null default current_date,
  expected_delivery_date date null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_purchase_orders_status_check
    check (status in ('draft', 'approved', 'partially_received', 'received', 'cancelled'))
);

create unique index if not exists erp_purchase_orders_company_po_no_key
  on public.erp_purchase_orders (company_id, po_no);

create index if not exists erp_purchase_orders_company_id_idx
  on public.erp_purchase_orders (company_id);

create table if not exists public.erp_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  purchase_order_id uuid not null references public.erp_purchase_orders (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  ordered_qty integer not null,
  received_qty integer not null default 0,
  unit_cost numeric(12, 2) null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_purchase_order_lines_company_id_idx
  on public.erp_purchase_order_lines (company_id);

create index if not exists erp_purchase_order_lines_po_id_idx
  on public.erp_purchase_order_lines (purchase_order_id);

-- Goods Receipt Notes
create table if not exists public.erp_grns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  purchase_order_id uuid not null references public.erp_purchase_orders (id) on delete restrict,
  grn_no text not null default public.erp_next_grn_no(public.erp_current_company_id()),
  status text not null default 'draft',
  received_at timestamptz not null default now(),
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_grns_status_check
    check (status in ('draft', 'posted', 'cancelled'))
);

create unique index if not exists erp_grns_company_grn_no_key
  on public.erp_grns (company_id, grn_no);

create index if not exists erp_grns_company_id_idx
  on public.erp_grns (company_id);

create table if not exists public.erp_grn_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  grn_id uuid not null references public.erp_grns (id) on delete cascade,
  purchase_order_line_id uuid not null references public.erp_purchase_order_lines (id) on delete restrict,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  warehouse_id uuid not null,
  received_qty integer not null,
  unit_cost numeric(12, 2) null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_grn_lines_company_id_idx
  on public.erp_grn_lines (company_id);

create index if not exists erp_grn_lines_grn_id_idx
  on public.erp_grn_lines (grn_id);

-- Triggers for updated_at
drop trigger if exists erp_vendors_set_updated on public.erp_vendors;
create trigger erp_vendors_set_updated
before update on public.erp_vendors
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_purchase_orders_set_updated on public.erp_purchase_orders;
create trigger erp_purchase_orders_set_updated
before update on public.erp_purchase_orders
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_purchase_order_lines_set_updated on public.erp_purchase_order_lines;
create trigger erp_purchase_order_lines_set_updated
before update on public.erp_purchase_order_lines
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_grns_set_updated on public.erp_grns;
create trigger erp_grns_set_updated
before update on public.erp_grns
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_grn_lines_set_updated on public.erp_grn_lines;
create trigger erp_grn_lines_set_updated
before update on public.erp_grn_lines
for each row
execute function public.erp_inventory_set_updated();

-- RLS
alter table public.erp_vendors enable row level security;
alter table public.erp_vendors force row level security;
alter table public.erp_purchase_orders enable row level security;
alter table public.erp_purchase_orders force row level security;
alter table public.erp_purchase_order_lines enable row level security;
alter table public.erp_purchase_order_lines force row level security;
alter table public.erp_grns enable row level security;
alter table public.erp_grns force row level security;
alter table public.erp_grn_lines enable row level security;
alter table public.erp_grn_lines force row level security;

do $$
begin
  drop policy if exists erp_inventory_ledger_read_authenticated on public.erp_inventory_ledger;
  drop policy if exists erp_inventory_ledger_write_admin on public.erp_inventory_ledger;
  drop policy if exists erp_inventory_ledger_update_admin on public.erp_inventory_ledger;
  drop policy if exists erp_inventory_ledger_delete_admin on public.erp_inventory_ledger;
  drop policy if exists erp_vendors_select on public.erp_vendors;
  drop policy if exists erp_vendors_write on public.erp_vendors;
  drop policy if exists erp_purchase_orders_select on public.erp_purchase_orders;
  drop policy if exists erp_purchase_orders_write on public.erp_purchase_orders;
  drop policy if exists erp_purchase_order_lines_select on public.erp_purchase_order_lines;
  drop policy if exists erp_purchase_order_lines_write on public.erp_purchase_order_lines;
  drop policy if exists erp_grns_select on public.erp_grns;
  drop policy if exists erp_grns_write on public.erp_grns;
  drop policy if exists erp_grn_lines_select on public.erp_grn_lines;
  drop policy if exists erp_grn_lines_write on public.erp_grn_lines;

  create policy erp_inventory_ledger_read_authenticated
    on public.erp_inventory_ledger
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

  create policy erp_inventory_ledger_write_admin
    on public.erp_inventory_ledger
    for insert
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_inventory_ledger_update_admin
    on public.erp_inventory_ledger
    for update
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_inventory_ledger_delete_admin
    on public.erp_inventory_ledger
    for delete
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_vendors_select
    on public.erp_vendors
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

  create policy erp_vendors_write
    on public.erp_vendors
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_purchase_orders_select
    on public.erp_purchase_orders
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

  create policy erp_purchase_orders_write
    on public.erp_purchase_orders
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_purchase_order_lines_select
    on public.erp_purchase_order_lines
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

  create policy erp_purchase_order_lines_write
    on public.erp_purchase_order_lines
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_grns_select
    on public.erp_grns
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

  create policy erp_grns_write
    on public.erp_grns
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_grn_lines_select
    on public.erp_grn_lines
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

  create policy erp_grn_lines_write
    on public.erp_grn_lines
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
            and cu.role_key in ('owner', 'admin')
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
            and cu.role_key in ('owner', 'admin')
        )
      )
    );
end
$$;

-- GRN posting RPC
create or replace function public.erp_post_grn(p_grn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_grn record;
  v_over_count integer;
  v_total_lines integer;
  v_received_lines integer;
begin
  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Only owner/admin can post GRNs';
  end if;

  select * into v_grn
    from public.erp_grns
   where id = p_grn_id
     and company_id = v_company_id
   for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted';
  end if;

  select count(*) into v_over_count
    from public.erp_grn_lines gl
    join public.erp_purchase_order_lines pol on pol.id = gl.purchase_order_line_id
   where gl.grn_id = p_grn_id
     and pol.company_id = v_company_id
     and (pol.received_qty + gl.received_qty) > pol.ordered_qty;

  if v_over_count > 0 then
    raise exception 'GRN quantities exceed ordered quantities';
  end if;

  select count(*) into v_total_lines
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id;

  if v_total_lines = 0 then
    raise exception 'GRN has no lines to post';
  end if;

  update public.erp_purchase_order_lines pol
     set received_qty = pol.received_qty + gl.received_qty,
         updated_at = now(),
         updated_by = auth.uid()
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and pol.id = gl.purchase_order_line_id
     and pol.company_id = v_company_id;

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
    gl.warehouse_id,
    gl.variant_id,
    gl.received_qty,
    'grn_in',
    'GRN Receipt',
    'GRN:' || p_grn_id::text,
    auth.uid(),
    now()
  from public.erp_grn_lines gl
  where gl.grn_id = p_grn_id;

  select count(*) into v_total_lines
    from public.erp_purchase_order_lines pol
   where pol.purchase_order_id = v_grn.purchase_order_id
     and pol.company_id = v_company_id;

  select count(*) into v_received_lines
    from public.erp_purchase_order_lines pol
   where pol.purchase_order_id = v_grn.purchase_order_id
     and pol.company_id = v_company_id
     and pol.received_qty >= pol.ordered_qty;

  update public.erp_purchase_orders po
     set status = case
       when v_total_lines > 0 and v_total_lines = v_received_lines then 'received'
       else 'partially_received'
     end,
         updated_at = now(),
         updated_by = auth.uid()
   where po.id = v_grn.purchase_order_id
     and po.company_id = v_company_id;

  update public.erp_grns
     set status = 'posted',
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_grn_id
     and company_id = v_company_id;

  return jsonb_build_object('status', 'posted', 'grn_id', p_grn_id);
end;
$$;

revoke all on function public.erp_post_grn(uuid) from public;
grant execute on function public.erp_post_grn(uuid) to authenticated;
