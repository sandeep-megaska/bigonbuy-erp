-- 0453_mfg_asn_booking_v1.sql
-- Vendor Dispatch / ASN booking (cookie-session based via erp_mfg_vendor_me_v1).

create table if not exists public.erp_mfg_asns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  vendor_id uuid not null references public.erp_vendors(id) on delete restrict,
  po_id uuid not null references public.erp_purchase_orders(id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'CANCELLED')),
  dispatch_date date not null,
  eta_date date null,
  submit_reason text null,
  cancel_reason text null,
  submitted_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint erp_mfg_asns_eta_after_dispatch_chk check (eta_date is null or eta_date >= dispatch_date)
);

create table if not exists public.erp_mfg_asn_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  asn_id uuid not null references public.erp_mfg_asns(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete restrict,
  qty numeric(18,6) not null check (qty > 0),
  created_at timestamptz not null default now(),
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  constraint erp_mfg_asn_lines_asn_po_line_uniq unique (asn_id, po_line_id)
);

create table if not exists public.erp_mfg_asn_cartons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  asn_id uuid not null references public.erp_mfg_asns(id) on delete cascade,
  carton_no integer not null check (carton_no > 0),
  created_at timestamptz not null default now(),
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  constraint erp_mfg_asn_cartons_asn_carton_no_uniq unique (asn_id, carton_no)
);

create table if not exists public.erp_mfg_asn_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  asn_id uuid not null references public.erp_mfg_asns(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete restrict,
  event_type text not null,
  reason text null,
  created_at timestamptz not null default now(),
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null
);

create index if not exists erp_mfg_asns_company_vendor_status_idx
  on public.erp_mfg_asns(company_id, vendor_id, status, created_at desc);
create index if not exists erp_mfg_asns_po_id_idx on public.erp_mfg_asns(po_id);
create index if not exists erp_mfg_asns_dispatch_date_idx on public.erp_mfg_asns(dispatch_date);
create index if not exists erp_mfg_asns_eta_date_idx on public.erp_mfg_asns(eta_date);
create index if not exists erp_mfg_asn_lines_po_line_id_idx on public.erp_mfg_asn_lines(po_line_id);
create index if not exists erp_mfg_asn_events_asn_created_idx on public.erp_mfg_asn_events(asn_id, created_at desc);

create or replace function public.erp_mfg_vendor_id_from_claims_v1()
returns uuid
language plpgsql
stable
as $$
declare
  v_claims text;
begin
  v_claims := current_setting('request.jwt.claims', true);
  if coalesce(v_claims, '') = '' then
    return null;
  end if;
  return nullif((v_claims::jsonb ->> 'vendor_id'), '')::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.erp_mfg_company_id_from_claims_v1()
returns uuid
language plpgsql
stable
as $$
declare
  v_claims text;
begin
  v_claims := current_setting('request.jwt.claims', true);
  if coalesce(v_claims, '') = '' then
    return null;
  end if;
  return nullif((v_claims::jsonb ->> 'company_id'), '')::uuid;
exception when others then
  return null;
end;
$$;

alter table public.erp_mfg_asns enable row level security;
alter table public.erp_mfg_asn_lines enable row level security;
alter table public.erp_mfg_asn_cartons enable row level security;
alter table public.erp_mfg_asn_events enable row level security;

create policy erp_mfg_asns_vendor_draft_crud on public.erp_mfg_asns
for all to anon
using (
  vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
  and company_id = public.erp_mfg_company_id_from_claims_v1()
  and status = 'DRAFT'
)
with check (
  vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
  and company_id = public.erp_mfg_company_id_from_claims_v1()
  and status = 'DRAFT'
);

create policy erp_mfg_asns_erp_read_all on public.erp_mfg_asns
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create policy erp_mfg_asn_lines_vendor_draft_crud on public.erp_mfg_asn_lines
for all to anon
using (
  exists (
    select 1
    from public.erp_mfg_asns a
    where a.id = erp_mfg_asn_lines.asn_id
      and a.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
)
with check (
  exists (
    select 1
    from public.erp_mfg_asns a
    where a.id = erp_mfg_asn_lines.asn_id
      and a.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
);

create policy erp_mfg_asn_lines_erp_read_all on public.erp_mfg_asn_lines
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create policy erp_mfg_asn_cartons_vendor_draft_crud on public.erp_mfg_asn_cartons
for all to anon
using (
  exists (
    select 1
    from public.erp_mfg_asns a
    where a.id = erp_mfg_asn_cartons.asn_id
      and a.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
)
with check (
  exists (
    select 1
    from public.erp_mfg_asns a
    where a.id = erp_mfg_asn_cartons.asn_id
      and a.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
);

create policy erp_mfg_asn_cartons_erp_read_all on public.erp_mfg_asn_cartons
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create policy erp_mfg_asn_events_erp_read_all on public.erp_mfg_asn_events
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create or replace function public.erp_mfg_asn_lock_after_submit_v1()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('SUBMITTED', 'CANCELLED') then
    if new.dispatch_date is distinct from old.dispatch_date
       or new.eta_date is distinct from old.eta_date
       or new.po_id is distinct from old.po_id
       or new.vendor_id is distinct from old.vendor_id
       or new.company_id is distinct from old.company_id then
      raise exception 'ASN core fields are locked after submit/cancel';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists erp_mfg_asns_lock_after_submit on public.erp_mfg_asns;
create trigger erp_mfg_asns_lock_after_submit
before update on public.erp_mfg_asns
for each row execute function public.erp_mfg_asn_lock_after_submit_v1();

create or replace function public.erp_mfg_asn_lines_lock_v1()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select a.status into v_status
  from public.erp_mfg_asns a
  where a.id = coalesce(new.asn_id, old.asn_id);

  if v_status in ('SUBMITTED', 'CANCELLED') then
    raise exception 'ASN lines are locked after submit/cancel';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists erp_mfg_asn_lines_lock_changes on public.erp_mfg_asn_lines;
create trigger erp_mfg_asn_lines_lock_changes
before insert or update or delete on public.erp_mfg_asn_lines
for each row execute function public.erp_mfg_asn_lines_lock_v1();

create or replace function public.erp_mfg_asn_cartons_lock_v1()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select a.status into v_status
  from public.erp_mfg_asns a
  where a.id = coalesce(new.asn_id, old.asn_id);

  if v_status in ('SUBMITTED', 'CANCELLED') then
    raise exception 'ASN cartons are locked after submit/cancel';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists erp_mfg_asn_cartons_lock_changes on public.erp_mfg_asn_cartons;
create trigger erp_mfg_asn_cartons_lock_changes
before insert or update or delete on public.erp_mfg_asn_cartons
for each row execute function public.erp_mfg_asn_cartons_lock_v1();

create or replace function public.erp_mfg_asn_create_v1(
  p_session_token text,
  p_po_id uuid,
  p_dispatch_date date,
  p_eta_date date
) returns public.erp_mfg_asns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_row public.erp_mfg_asns;
begin
  if p_po_id is null or p_dispatch_date is null then
    raise exception 'po_id and dispatch_date are required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select s.id into v_session_id
  from public.erp_mfg_sessions s
  where s.token_hash = public.erp_mfg_hash_token(p_session_token)
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if not exists (
    select 1
    from public.erp_purchase_orders po
    where po.id = p_po_id
      and po.company_id = v_company_id
      and po.vendor_id = v_vendor_id
      and coalesce(lower(po.status), '') not in ('cancelled', 'void')
  ) then
    raise exception 'PO not found for vendor';
  end if;

  insert into public.erp_mfg_asns(
    company_id, vendor_id, po_id, status, dispatch_date, eta_date, created_by_session_id
  ) values (
    v_company_id, v_vendor_id, p_po_id, 'DRAFT', p_dispatch_date, p_eta_date, v_session_id
  )
  returning * into v_row;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, created_by_session_id)
  values (v_company_id, v_row.id, v_vendor_id, 'CREATED', v_session_id);

  return v_row;
end;
$$;

create or replace function public.erp_mfg_asn_add_line_v1(
  p_session_token text,
  p_asn_id uuid,
  p_po_line_id uuid,
  p_qty numeric
) returns public.erp_mfg_asn_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_asn public.erp_mfg_asns;
  v_ordered_qty numeric(18,6);
  v_received_qty numeric(18,6);
  v_submitted_qty numeric(18,6);
  v_row public.erp_mfg_asn_lines;
begin
  if p_asn_id is null or p_po_line_id is null or coalesce(p_qty, 0) <= 0 then
    raise exception 'asn_id, po_line_id and qty (>0) are required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select s.id into v_session_id
  from public.erp_mfg_sessions s
  where s.token_hash = public.erp_mfg_hash_token(p_session_token)
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  select * into v_asn
  from public.erp_mfg_asns a
  where a.id = p_asn_id
    and a.company_id = v_company_id
    and a.vendor_id = v_vendor_id
  for update;

  if not found then
    raise exception 'ASN not found for vendor';
  end if;

  if v_asn.status <> 'DRAFT' then
    raise exception 'Only DRAFT ASN can be edited';
  end if;

  select pol.ordered_qty::numeric(18,6), coalesce(pol.received_qty,0)::numeric(18,6)
    into v_ordered_qty, v_received_qty
  from public.erp_purchase_order_lines pol
  join public.erp_purchase_orders po
    on po.id = pol.purchase_order_id
   and po.company_id = pol.company_id
  where pol.id = p_po_line_id
    and pol.purchase_order_id = v_asn.po_id
    and po.company_id = v_company_id
    and po.vendor_id = v_vendor_id
  limit 1;

  if v_ordered_qty is null then
    raise exception 'PO line not found in ASN PO';
  end if;

  select coalesce(sum(al.qty),0)::numeric(18,6)
    into v_submitted_qty
  from public.erp_mfg_asn_lines al
  join public.erp_mfg_asns a
    on a.id = al.asn_id
   and a.company_id = al.company_id
  where al.company_id = v_company_id
    and al.po_line_id = p_po_line_id
    and a.status = 'SUBMITTED'
    and a.id <> p_asn_id;

  if (p_qty::numeric(18,6) + v_submitted_qty) > v_ordered_qty then
    raise exception 'ASN qty exceeds open qty. ordered=%, already_submitted=%, requested=%', v_ordered_qty, v_submitted_qty, p_qty;
  end if;

  insert into public.erp_mfg_asn_lines(company_id, asn_id, po_line_id, qty, created_by_session_id)
  values (v_company_id, p_asn_id, p_po_line_id, p_qty::numeric(18,6), v_session_id)
  on conflict (asn_id, po_line_id)
  do update set qty = excluded.qty
  returning * into v_row;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, reason, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'LINE_UPSERT', format('po_line_id=%s qty=%s', p_po_line_id::text, p_qty::text), v_session_id);

  return v_row;
end;
$$;

create or replace function public.erp_mfg_asn_set_cartons_v1(
  p_session_token text,
  p_asn_id uuid,
  p_carton_count integer
) returns setof public.erp_mfg_asn_cartons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_asn public.erp_mfg_asns;
  v_i integer;
begin
  if p_asn_id is null or coalesce(p_carton_count, 0) < 0 then
    raise exception 'asn_id and carton_count (>=0) are required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select s.id into v_session_id
  from public.erp_mfg_sessions s
  where s.token_hash = public.erp_mfg_hash_token(p_session_token)
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  select * into v_asn
  from public.erp_mfg_asns a
  where a.id = p_asn_id
    and a.company_id = v_company_id
    and a.vendor_id = v_vendor_id
  for update;

  if not found then
    raise exception 'ASN not found for vendor';
  end if;

  if v_asn.status <> 'DRAFT' then
    raise exception 'Only DRAFT ASN can be edited';
  end if;

  delete from public.erp_mfg_asn_cartons where asn_id = p_asn_id;

  if p_carton_count > 0 then
    for v_i in 1..p_carton_count loop
      insert into public.erp_mfg_asn_cartons(company_id, asn_id, carton_no, created_by_session_id)
      values (v_company_id, p_asn_id, v_i, v_session_id);
    end loop;
  end if;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, reason, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'CARTONS_SET', format('carton_count=%s', p_carton_count), v_session_id);

  return query
  select c.*
  from public.erp_mfg_asn_cartons c
  where c.asn_id = p_asn_id
  order by c.carton_no;
end;
$$;

create or replace function public.erp_mfg_asn_submit_v1(
  p_session_token text,
  p_asn_id uuid
) returns public.erp_mfg_asns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_asn public.erp_mfg_asns;
  v_has_lines boolean := false;
  v_invalid_line record;
  v_row public.erp_mfg_asns;
begin
  if p_asn_id is null then
    raise exception 'asn_id is required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select s.id into v_session_id
  from public.erp_mfg_sessions s
  where s.token_hash = public.erp_mfg_hash_token(p_session_token)
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  select * into v_asn
  from public.erp_mfg_asns a
  where a.id = p_asn_id
    and a.company_id = v_company_id
    and a.vendor_id = v_vendor_id
  for update;

  if not found then
    raise exception 'ASN not found for vendor';
  end if;

  if v_asn.status <> 'DRAFT' then
    raise exception 'Only DRAFT ASN can be submitted';
  end if;

  select exists(select 1 from public.erp_mfg_asn_lines l where l.asn_id = p_asn_id) into v_has_lines;
  if not v_has_lines then
    raise exception 'Add at least one ASN line before submit';
  end if;

  select l.po_line_id, l.qty, pol.ordered_qty::numeric(18,6) as ordered_qty,
         coalesce((
          select sum(l2.qty)::numeric(18,6)
          from public.erp_mfg_asn_lines l2
          join public.erp_mfg_asns a2 on a2.id = l2.asn_id and a2.company_id = l2.company_id
          where l2.company_id = v_company_id
            and l2.po_line_id = l.po_line_id
            and a2.status = 'SUBMITTED'
            and a2.id <> p_asn_id
         ),0::numeric(18,6)) as already_submitted
  into v_invalid_line
  from public.erp_mfg_asn_lines l
  join public.erp_purchase_order_lines pol
    on pol.id = l.po_line_id
   and pol.company_id = l.company_id
  where l.asn_id = p_asn_id
    and (l.qty + coalesce((
          select sum(l2.qty)::numeric(18,6)
          from public.erp_mfg_asn_lines l2
          join public.erp_mfg_asns a2 on a2.id = l2.asn_id and a2.company_id = l2.company_id
          where l2.company_id = v_company_id
            and l2.po_line_id = l.po_line_id
            and a2.status = 'SUBMITTED'
            and a2.id <> p_asn_id
    ),0::numeric(18,6))) > pol.ordered_qty::numeric(18,6)
  limit 1;

  if found then
    raise exception 'Line qty exceeds remaining open qty for po_line_id=% (ordered %, already_submitted %, this_asn %)',
      v_invalid_line.po_line_id, v_invalid_line.ordered_qty, v_invalid_line.already_submitted, v_invalid_line.qty;
  end if;

  update public.erp_mfg_asns a
     set status = 'SUBMITTED',
         submitted_at = now(),
         updated_at = now()
   where a.id = p_asn_id
  returning * into v_row;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'SUBMITTED', v_session_id);

  return v_row;
end;
$$;

create or replace function public.erp_mfg_asn_cancel_v1(
  p_session_token text,
  p_asn_id uuid,
  p_reason text
) returns public.erp_mfg_asns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_row public.erp_mfg_asns;
begin
  if p_asn_id is null then
    raise exception 'asn_id is required';
  end if;

  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  select s.id into v_session_id
  from public.erp_mfg_sessions s
  where s.token_hash = public.erp_mfg_hash_token(p_session_token)
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  update public.erp_mfg_asns a
     set status = 'CANCELLED',
         cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
         cancelled_at = now(),
         updated_at = now()
   where a.id = p_asn_id
     and a.company_id = v_company_id
     and a.vendor_id = v_vendor_id
     and a.status in ('DRAFT', 'SUBMITTED')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ASN not found or cannot be cancelled';
  end if;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, reason, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'CANCELLED', nullif(trim(coalesce(p_reason, '')), ''), v_session_id);

  return v_row;
end;
$$;

create or replace function public.erp_mfg_vendor_asns_list_v1(
  p_session_token text,
  p_status text default null,
  p_from date default null,
  p_to date default null
) returns table (
  asn_id uuid,
  po_id uuid,
  po_number text,
  status text,
  dispatch_date date,
  eta_date date,
  total_qty numeric,
  cartons_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
begin
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  return query
  select
    a.id as asn_id,
    a.po_id,
    coalesce(po.doc_no, po.po_no, '') as po_number,
    a.status,
    a.dispatch_date,
    a.eta_date,
    coalesce(sum(al.qty), 0)::numeric as total_qty,
    coalesce(count(distinct c.id), 0)::integer as cartons_count,
    a.created_at
  from public.erp_mfg_asns a
  join public.erp_purchase_orders po on po.id = a.po_id and po.company_id = a.company_id
  left join public.erp_mfg_asn_lines al on al.asn_id = a.id and al.company_id = a.company_id
  left join public.erp_mfg_asn_cartons c on c.asn_id = a.id and c.company_id = a.company_id
  where a.company_id = v_company_id
    and a.vendor_id = v_vendor_id
    and (p_status is null or upper(a.status) = upper(p_status))
    and (p_from is null or a.dispatch_date >= p_from)
    and (p_to is null or a.dispatch_date <= p_to)
  group by a.id, a.po_id, po.doc_no, po.po_no, a.status, a.dispatch_date, a.eta_date, a.created_at
  order by a.created_at desc;
end;
$$;

create or replace function public.erp_mfg_vendor_po_open_lines_v1(
  p_session_token text,
  p_po_id uuid default null
) returns table(
  po_id uuid,
  po_number text,
  po_line_id uuid,
  sku text,
  ordered_qty numeric,
  received_qty numeric,
  asn_submitted_qty numeric,
  open_qty numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
begin
  select public.erp_mfg_vendor_me_v1(p_session_token) into v_me;
  if coalesce((v_me->>'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_me->>'error', 'Not authenticated');
  end if;

  v_company_id := (v_me->>'company_id')::uuid;
  v_vendor_id := (v_me->>'vendor_id')::uuid;

  return query
  with submitted as (
    select al.po_line_id, sum(al.qty)::numeric(18,6) as asn_qty
    from public.erp_mfg_asn_lines al
    join public.erp_mfg_asns a on a.id = al.asn_id and a.company_id = al.company_id
    where al.company_id = v_company_id
      and a.vendor_id = v_vendor_id
      and a.status = 'SUBMITTED'
    group by al.po_line_id
  )
  select
    po.id as po_id,
    coalesce(po.doc_no, po.po_no, '') as po_number,
    pol.id as po_line_id,
    pol.sku,
    pol.ordered_qty::numeric(18,6) as ordered_qty,
    coalesce(pol.received_qty,0)::numeric(18,6) as received_qty,
    coalesce(s.asn_qty,0)::numeric(18,6) as asn_submitted_qty,
    greatest(pol.ordered_qty::numeric(18,6) - coalesce(s.asn_qty,0)::numeric(18,6), 0::numeric) as open_qty
  from public.erp_purchase_orders po
  join public.erp_purchase_order_lines pol
    on pol.purchase_order_id = po.id
   and pol.company_id = po.company_id
  left join submitted s on s.po_line_id = pol.id
  where po.company_id = v_company_id
    and po.vendor_id = v_vendor_id
    and coalesce(lower(po.status), '') not in ('cancelled', 'void', 'closed')
    and (p_po_id is null or po.id = p_po_id)
  order by po.created_at desc, pol.created_at asc;
end;
$$;

create or replace function public.erp_mfg_erp_asns_list_v1(
  p_vendor_id uuid default null,
  p_status text default null,
  p_from date default null,
  p_to date default null
) returns table (
  asn_id uuid,
  company_id uuid,
  vendor_id uuid,
  vendor_name text,
  po_id uuid,
  po_number text,
  status text,
  dispatch_date date,
  eta_date date,
  total_qty numeric,
  cartons_count integer,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'No company context found';
  end if;

  return query
  select
    a.id as asn_id,
    a.company_id,
    a.vendor_id,
    coalesce(v.legal_name, '') as vendor_name,
    a.po_id,
    coalesce(po.doc_no, po.po_no, '') as po_number,
    a.status,
    a.dispatch_date,
    a.eta_date,
    coalesce(sum(al.qty), 0)::numeric as total_qty,
    coalesce(count(distinct c.id), 0)::integer as cartons_count,
    a.created_at
  from public.erp_mfg_asns a
  join public.erp_vendors v on v.id = a.vendor_id and v.company_id = a.company_id
  join public.erp_purchase_orders po on po.id = a.po_id and po.company_id = a.company_id
  left join public.erp_mfg_asn_lines al on al.asn_id = a.id and al.company_id = a.company_id
  left join public.erp_mfg_asn_cartons c on c.asn_id = a.id and c.company_id = a.company_id
  where a.company_id = v_company_id
    and (p_vendor_id is null or a.vendor_id = p_vendor_id)
    and (p_status is null or upper(a.status) = upper(p_status))
    and (p_from is null or a.dispatch_date >= p_from)
    and (p_to is null or a.dispatch_date <= p_to)
  group by a.id, a.company_id, a.vendor_id, v.legal_name, a.po_id, po.doc_no, po.po_no, a.status, a.dispatch_date, a.eta_date, a.created_at
  order by a.created_at desc;
end;
$$;

revoke all on function public.erp_mfg_asn_create_v1(text, uuid, date, date) from public;
revoke all on function public.erp_mfg_asn_add_line_v1(text, uuid, uuid, numeric) from public;
revoke all on function public.erp_mfg_asn_set_cartons_v1(text, uuid, integer) from public;
revoke all on function public.erp_mfg_asn_submit_v1(text, uuid) from public;
revoke all on function public.erp_mfg_asn_cancel_v1(text, uuid, text) from public;
revoke all on function public.erp_mfg_vendor_asns_list_v1(text, text, date, date) from public;
revoke all on function public.erp_mfg_vendor_po_open_lines_v1(text, uuid) from public;
revoke all on function public.erp_mfg_erp_asns_list_v1(uuid, text, date, date) from public;

grant execute on function public.erp_mfg_asn_create_v1(text, uuid, date, date) to anon, service_role;
grant execute on function public.erp_mfg_asn_add_line_v1(text, uuid, uuid, numeric) to anon, service_role;
grant execute on function public.erp_mfg_asn_set_cartons_v1(text, uuid, integer) to anon, service_role;
grant execute on function public.erp_mfg_asn_submit_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_asn_cancel_v1(text, uuid, text) to anon, service_role;
grant execute on function public.erp_mfg_vendor_asns_list_v1(text, text, date, date) to anon, service_role;
grant execute on function public.erp_mfg_vendor_po_open_lines_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_erp_asns_list_v1(uuid, text, date, date) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
