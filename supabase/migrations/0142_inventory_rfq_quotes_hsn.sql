-- Add HSN code to products
alter table public.erp_products
  add column if not exists hsn_code text null;

create index if not exists erp_products_company_hsn_code_idx
  on public.erp_products (company_id, hsn_code);

-- Extend company counters for RFQ + vendor quote numbering
alter table public.erp_company_counters
  add column if not exists rfq_no_seq bigint not null default 0,
  add column if not exists quote_no_seq bigint not null default 0;

-- Next RFQ number
create or replace function public.erp_next_rfq_no(p_company_id uuid)
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

  insert into public.erp_company_counters (company_id, rfq_no_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set rfq_no_seq = public.erp_company_counters.rfq_no_seq + 1,
                updated_at = now()
  returning rfq_no_seq into v_seq;

  return 'RFQ' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.erp_next_rfq_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.erp_next_rfq_no(public.erp_current_company_id())
$$;

revoke all on function public.erp_next_rfq_no(uuid) from public;
grant execute on function public.erp_next_rfq_no(uuid) to authenticated;

revoke all on function public.erp_next_rfq_no() from public;
grant execute on function public.erp_next_rfq_no() to authenticated;

-- Next Vendor Quote number
create or replace function public.erp_next_vendor_quote_no(p_company_id uuid)
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

  insert into public.erp_company_counters (company_id, quote_no_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set quote_no_seq = public.erp_company_counters.quote_no_seq + 1,
                updated_at = now()
  returning quote_no_seq into v_seq;

  return 'QUO' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.erp_next_vendor_quote_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.erp_next_vendor_quote_no(public.erp_current_company_id())
$$;

revoke all on function public.erp_next_vendor_quote_no(uuid) from public;
grant execute on function public.erp_next_vendor_quote_no(uuid) to authenticated;

revoke all on function public.erp_next_vendor_quote_no() from public;
grant execute on function public.erp_next_vendor_quote_no() to authenticated;

-- RFQs
create table if not exists public.erp_rfq (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  rfq_no text not null default public.erp_next_rfq_no(public.erp_current_company_id()),
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  requested_on date not null default current_date,
  needed_by date null,
  deliver_to_warehouse_id uuid null references public.erp_warehouses (id) on delete set null,
  status text not null default 'draft',
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_rfq_status_check
    check (status in ('draft', 'sent', 'closed', 'cancelled'))
);

create unique index if not exists erp_rfq_company_rfq_no_key
  on public.erp_rfq (company_id, rfq_no);

create index if not exists erp_rfq_company_id_idx
  on public.erp_rfq (company_id);

create index if not exists erp_rfq_vendor_id_idx
  on public.erp_rfq (vendor_id);

create table if not exists public.erp_rfq_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  rfq_id uuid not null references public.erp_rfq (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty numeric not null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_rfq_lines_company_id_idx
  on public.erp_rfq_lines (company_id);

create index if not exists erp_rfq_lines_rfq_id_idx
  on public.erp_rfq_lines (rfq_id);

-- Vendor Quotes
create table if not exists public.erp_vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  quote_no text not null default public.erp_next_vendor_quote_no(public.erp_current_company_id()),
  rfq_id uuid not null references public.erp_rfq (id) on delete restrict,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  received_on date not null default current_date,
  validity_until date null,
  lead_time_days integer null,
  payment_terms_days integer null,
  status text not null default 'received',
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_vendor_quotes_status_check
    check (status in ('received', 'accepted', 'rejected', 'expired'))
);

create unique index if not exists erp_vendor_quotes_company_quote_no_key
  on public.erp_vendor_quotes (company_id, quote_no);

create index if not exists erp_vendor_quotes_company_id_idx
  on public.erp_vendor_quotes (company_id);

create index if not exists erp_vendor_quotes_rfq_id_idx
  on public.erp_vendor_quotes (rfq_id);

create index if not exists erp_vendor_quotes_vendor_id_idx
  on public.erp_vendor_quotes (vendor_id);

create table if not exists public.erp_vendor_quote_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  quote_id uuid not null references public.erp_vendor_quotes (id) on delete cascade,
  variant_id uuid not null references public.erp_variants (id) on delete restrict,
  qty numeric not null,
  unit_rate numeric not null,
  gst_note text null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_vendor_quote_lines_company_id_idx
  on public.erp_vendor_quote_lines (company_id);

create index if not exists erp_vendor_quote_lines_quote_id_idx
  on public.erp_vendor_quote_lines (quote_id);

-- Link POs to RFQ / Quote
alter table public.erp_purchase_orders
  add column if not exists rfq_id uuid null references public.erp_rfq (id) on delete set null,
  add column if not exists vendor_quote_id uuid null references public.erp_vendor_quotes (id) on delete set null,
  add column if not exists quote_ref_no text null,
  add column if not exists deliver_to_warehouse_id uuid null references public.erp_warehouses (id) on delete set null;

create index if not exists erp_purchase_orders_rfq_id_idx
  on public.erp_purchase_orders (rfq_id);

create index if not exists erp_purchase_orders_vendor_quote_id_idx
  on public.erp_purchase_orders (vendor_quote_id);

-- Triggers for updated_at
drop trigger if exists erp_rfq_set_updated on public.erp_rfq;
create trigger erp_rfq_set_updated
before update on public.erp_rfq
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_rfq_lines_set_updated on public.erp_rfq_lines;
create trigger erp_rfq_lines_set_updated
before update on public.erp_rfq_lines
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_vendor_quotes_set_updated on public.erp_vendor_quotes;
create trigger erp_vendor_quotes_set_updated
before update on public.erp_vendor_quotes
for each row
execute function public.erp_inventory_set_updated();

drop trigger if exists erp_vendor_quote_lines_set_updated on public.erp_vendor_quote_lines;
create trigger erp_vendor_quote_lines_set_updated
before update on public.erp_vendor_quote_lines
for each row
execute function public.erp_inventory_set_updated();

-- RLS
alter table public.erp_rfq enable row level security;
alter table public.erp_rfq force row level security;
alter table public.erp_rfq_lines enable row level security;
alter table public.erp_rfq_lines force row level security;
alter table public.erp_vendor_quotes enable row level security;
alter table public.erp_vendor_quotes force row level security;
alter table public.erp_vendor_quote_lines enable row level security;
alter table public.erp_vendor_quote_lines force row level security;

do $$
begin
  drop policy if exists erp_rfq_select on public.erp_rfq;
  drop policy if exists erp_rfq_write on public.erp_rfq;
  drop policy if exists erp_rfq_lines_select on public.erp_rfq_lines;
  drop policy if exists erp_rfq_lines_write on public.erp_rfq_lines;
  drop policy if exists erp_vendor_quotes_select on public.erp_vendor_quotes;
  drop policy if exists erp_vendor_quotes_write on public.erp_vendor_quotes;
  drop policy if exists erp_vendor_quote_lines_select on public.erp_vendor_quote_lines;
  drop policy if exists erp_vendor_quote_lines_write on public.erp_vendor_quote_lines;

  create policy erp_rfq_select
    on public.erp_rfq
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

  create policy erp_rfq_write
    on public.erp_rfq
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

  create policy erp_rfq_lines_select
    on public.erp_rfq_lines
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

  create policy erp_rfq_lines_write
    on public.erp_rfq_lines
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

  create policy erp_vendor_quotes_select
    on public.erp_vendor_quotes
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

  create policy erp_vendor_quotes_write
    on public.erp_vendor_quotes
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

  create policy erp_vendor_quote_lines_select
    on public.erp_vendor_quote_lines
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

  create policy erp_vendor_quote_lines_write
    on public.erp_vendor_quote_lines
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
