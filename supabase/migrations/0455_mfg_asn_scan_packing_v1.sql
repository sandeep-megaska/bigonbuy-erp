-- 0455_mfg_asn_scan_packing_v1.sql
-- ASN scan-based packing with carton-wise lines and append-only scan events.

alter table if exists public.erp_mfg_asn_cartons
  add column if not exists status text not null default 'OPEN',
  add column if not exists carton_label_code text null;

alter table public.erp_mfg_asn_cartons
  drop constraint if exists erp_mfg_asn_cartons_status_chk;
alter table public.erp_mfg_asn_cartons
  add constraint erp_mfg_asn_cartons_status_chk check (status in ('OPEN', 'CLOSED'));

create unique index if not exists erp_mfg_asn_cartons_company_asn_label_uniq
  on public.erp_mfg_asn_cartons(company_id, asn_id, carton_label_code)
  where carton_label_code is not null;

create table if not exists public.erp_variant_barcodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  variant_id uuid not null references public.erp_variants(id) on delete cascade,
  barcode text not null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  constraint erp_variant_barcodes_company_barcode_uniq unique (company_id, barcode)
);

create index if not exists erp_variant_barcodes_company_variant_idx
  on public.erp_variant_barcodes(company_id, variant_id);

create table if not exists public.erp_mfg_asn_carton_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  carton_id uuid not null references public.erp_mfg_asn_cartons(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete restrict,
  qty_packed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mfg_asn_carton_lines_qty_chk check (qty_packed >= 0),
  constraint erp_mfg_asn_carton_lines_carton_po_line_uniq unique(carton_id, po_line_id)
);

create index if not exists erp_mfg_asn_carton_lines_carton_idx
  on public.erp_mfg_asn_carton_lines(carton_id);
create index if not exists erp_mfg_asn_carton_lines_po_line_idx
  on public.erp_mfg_asn_carton_lines(po_line_id);

create table if not exists public.erp_mfg_asn_scan_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  asn_id uuid not null references public.erp_mfg_asns(id) on delete cascade,
  carton_id uuid not null references public.erp_mfg_asn_cartons(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete restrict,
  barcode text not null,
  resolved_po_line_id uuid null references public.erp_purchase_order_lines(id) on delete set null,
  resolved_sku text null,
  qty_delta integer not null default 1,
  scan_ts timestamptz not null default now(),
  status text not null check (status in ('APPLIED','REJECTED')),
  reject_reason text null,
  device_meta jsonb null,
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null
);

create index if not exists erp_mfg_asn_scan_events_asn_idx
  on public.erp_mfg_asn_scan_events(asn_id);
create index if not exists erp_mfg_asn_scan_events_carton_idx
  on public.erp_mfg_asn_scan_events(carton_id);
create index if not exists erp_mfg_asn_scan_events_vendor_idx
  on public.erp_mfg_asn_scan_events(vendor_id);
create index if not exists erp_mfg_asn_scan_events_scan_ts_desc_idx
  on public.erp_mfg_asn_scan_events(scan_ts desc);

alter table public.erp_variant_barcodes enable row level security;
alter table public.erp_mfg_asn_carton_lines enable row level security;
alter table public.erp_mfg_asn_scan_events enable row level security;

create policy erp_variant_barcodes_erp_read_all on public.erp_variant_barcodes
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create policy erp_mfg_asn_carton_lines_vendor_draft_crud on public.erp_mfg_asn_carton_lines
for all to anon
using (
  exists (
    select 1
    from public.erp_mfg_asn_cartons c
    join public.erp_mfg_asns a on a.id = c.asn_id and a.company_id = c.company_id
    where c.id = erp_mfg_asn_carton_lines.carton_id
      and c.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
)
with check (
  exists (
    select 1
    from public.erp_mfg_asn_cartons c
    join public.erp_mfg_asns a on a.id = c.asn_id and a.company_id = c.company_id
    where c.id = erp_mfg_asn_carton_lines.carton_id
      and c.company_id = public.erp_mfg_company_id_from_claims_v1()
      and a.vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
      and a.status = 'DRAFT'
  )
);

create policy erp_mfg_asn_carton_lines_erp_read_all on public.erp_mfg_asn_carton_lines
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create policy erp_mfg_asn_scan_events_vendor_rw on public.erp_mfg_asn_scan_events
for all to anon
using (
  vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
  and company_id = public.erp_mfg_company_id_from_claims_v1()
)
with check (
  vendor_id = public.erp_mfg_vendor_id_from_claims_v1()
  and company_id = public.erp_mfg_company_id_from_claims_v1()
);

create policy erp_mfg_asn_scan_events_erp_read_all on public.erp_mfg_asn_scan_events
for select to authenticated
using (public.is_erp_manager(auth.uid()));

create or replace function public.erp_mfg_asn_scan_piece_v1(
  p_session_token text,
  p_carton_id uuid,
  p_barcode text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_asn_id uuid;
  v_po_id uuid;
  v_asn_status text;
  v_carton_no integer;
  v_variant_id uuid;
  v_po_line_id uuid;
  v_sku text;
  v_ordered_qty numeric(18,6);
  v_submitted_qty numeric(18,6);
  v_this_asn_qty numeric(18,6);
  v_remaining numeric(18,6);
  v_total_carton integer;
  v_total_asn integer;
  v_reason text;
begin
  if p_carton_id is null or coalesce(trim(p_barcode),'') = '' then
    raise exception 'carton_id and barcode are required';
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

  select c.asn_id, c.carton_no, a.po_id, a.status
    into v_asn_id, v_carton_no, v_po_id, v_asn_status
  from public.erp_mfg_asn_cartons c
  join public.erp_mfg_asns a on a.id = c.asn_id and a.company_id = c.company_id
  where c.id = p_carton_id
    and c.company_id = v_company_id
    and a.vendor_id = v_vendor_id
  for update;

  if v_asn_id is null then
    raise exception 'Carton not found for vendor';
  end if;

  if v_asn_status <> 'DRAFT' then
    v_reason := 'ASN_LOCKED';
    insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, qty_delta, status, reject_reason, created_by_session_id)
    values (v_company_id, v_asn_id, p_carton_id, v_vendor_id, trim(p_barcode), 1, 'REJECTED', v_reason, v_session_id);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  select vb.variant_id, v.sku
    into v_variant_id, v_sku
  from public.erp_variant_barcodes vb
  join public.erp_variants v on v.id = vb.variant_id and v.company_id = vb.company_id
  where vb.company_id = v_company_id
    and vb.barcode = trim(p_barcode)
  limit 1;

  if v_variant_id is null then
    v_reason := 'BARCODE_UNKNOWN';
    insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, qty_delta, status, reject_reason, created_by_session_id)
    values (v_company_id, v_asn_id, p_carton_id, v_vendor_id, trim(p_barcode), 1, 'REJECTED', v_reason, v_session_id);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  select pol.id, pol.ordered_qty::numeric(18,6)
    into v_po_line_id, v_ordered_qty
  from public.erp_purchase_order_lines pol
  where pol.company_id = v_company_id
    and pol.purchase_order_id = v_po_id
    and pol.variant_id = v_variant_id
  limit 1;

  if v_po_line_id is null then
    v_reason := 'NOT_IN_PO';
    insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, resolved_sku, qty_delta, status, reject_reason, created_by_session_id)
    values (v_company_id, v_asn_id, p_carton_id, v_vendor_id, trim(p_barcode), v_sku, 1, 'REJECTED', v_reason, v_session_id);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  select coalesce(sum(al.qty),0)::numeric(18,6)
    into v_submitted_qty
  from public.erp_mfg_asn_lines al
  join public.erp_mfg_asns a on a.id = al.asn_id and a.company_id = al.company_id
  where al.company_id = v_company_id
    and al.po_line_id = v_po_line_id
    and a.status = 'SUBMITTED'
    and a.id <> v_asn_id;

  select coalesce(sum(cl.qty_packed),0)::numeric(18,6)
    into v_this_asn_qty
  from public.erp_mfg_asn_carton_lines cl
  join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
  where cl.company_id = v_company_id
    and c.asn_id = v_asn_id
    and cl.po_line_id = v_po_line_id;

  v_remaining := v_ordered_qty - v_submitted_qty - v_this_asn_qty;
  if v_remaining <= 0 then
    v_reason := 'OVER_LIMIT';
    insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, resolved_po_line_id, resolved_sku, qty_delta, status, reject_reason, created_by_session_id)
    values (v_company_id, v_asn_id, p_carton_id, v_vendor_id, trim(p_barcode), v_po_line_id, v_sku, 1, 'REJECTED', v_reason, v_session_id);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, resolved_po_line_id, resolved_sku, qty_delta, status, created_by_session_id)
  values (v_company_id, v_asn_id, p_carton_id, v_vendor_id, trim(p_barcode), v_po_line_id, v_sku, 1, 'APPLIED', v_session_id);

  insert into public.erp_mfg_asn_carton_lines(company_id, carton_id, po_line_id, qty_packed)
  values (v_company_id, p_carton_id, v_po_line_id, 1)
  on conflict (carton_id, po_line_id)
  do update set qty_packed = erp_mfg_asn_carton_lines.qty_packed + 1,
                updated_at = now();

  select coalesce(sum(cl.qty_packed),0)::integer
    into v_total_carton
  from public.erp_mfg_asn_carton_lines cl
  where cl.carton_id = p_carton_id;

  select coalesce(sum(cl.qty_packed),0)::integer
    into v_total_asn
  from public.erp_mfg_asn_carton_lines cl
  join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
  where c.asn_id = v_asn_id;

  return jsonb_build_object(
    'ok', true,
    'carton', jsonb_build_object('carton_id', p_carton_id, 'carton_no', v_carton_no, 'total_pcs', v_total_carton),
    'asn', jsonb_build_object('asn_id', v_asn_id, 'total_pcs', v_total_asn),
    'lines_in_carton', coalesce((
      select jsonb_agg(jsonb_build_object('po_line_id', cl.po_line_id, 'sku', v2.sku, 'qty_packed', cl.qty_packed) order by v2.sku)
      from public.erp_mfg_asn_carton_lines cl
      join public.erp_purchase_order_lines pol on pol.id = cl.po_line_id and pol.company_id = cl.company_id
      join public.erp_variants v2 on v2.id = pol.variant_id and v2.company_id = pol.company_id
      where cl.carton_id = p_carton_id
    ), '[]'::jsonb),
    'lines_in_asn', coalesce((
      select jsonb_agg(jsonb_build_object('po_line_id', t.po_line_id, 'sku', t.sku, 'qty_packed_total', t.qty_total) order by t.sku)
      from (
        select cl.po_line_id, v2.sku, sum(cl.qty_packed)::integer as qty_total
        from public.erp_mfg_asn_carton_lines cl
        join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
        join public.erp_purchase_order_lines pol on pol.id = cl.po_line_id and pol.company_id = cl.company_id
        join public.erp_variants v2 on v2.id = pol.variant_id and v2.company_id = pol.company_id
        where c.asn_id = v_asn_id
        group by cl.po_line_id, v2.sku
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.erp_mfg_asn_scan_undo_last_v1(
  p_session_token text,
  p_carton_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_event record;
  v_asn_status text;
  v_qty integer;
begin
  if p_carton_id is null then
    raise exception 'carton_id is required';
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

  select a.status into v_asn_status
  from public.erp_mfg_asn_cartons c
  join public.erp_mfg_asns a on a.id = c.asn_id and a.company_id = c.company_id
  where c.id = p_carton_id
    and c.company_id = v_company_id
    and a.vendor_id = v_vendor_id;

  if v_asn_status is null then
    raise exception 'Carton not found for vendor';
  end if;

  if v_asn_status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'reason', 'ASN_LOCKED');
  end if;

  select e.* into v_event
  from public.erp_mfg_asn_scan_events e
  where e.company_id = v_company_id
    and e.carton_id = p_carton_id
    and e.vendor_id = v_vendor_id
    and e.status = 'APPLIED'
    and e.qty_delta > 0
  order by e.scan_ts desc
  limit 1;

  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_SCAN_TO_UNDO');
  end if;

  select qty_packed into v_qty
  from public.erp_mfg_asn_carton_lines
  where carton_id = p_carton_id
    and po_line_id = v_event.resolved_po_line_id
  for update;

  if coalesce(v_qty, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'NO_SCAN_TO_UNDO');
  end if;

  update public.erp_mfg_asn_carton_lines
     set qty_packed = greatest(qty_packed - 1, 0),
         updated_at = now()
   where carton_id = p_carton_id
     and po_line_id = v_event.resolved_po_line_id;

  insert into public.erp_mfg_asn_scan_events(company_id, asn_id, carton_id, vendor_id, barcode, resolved_po_line_id, resolved_sku, qty_delta, status, created_by_session_id)
  values (v_company_id, v_event.asn_id, p_carton_id, v_vendor_id, v_event.barcode, v_event.resolved_po_line_id, v_event.resolved_sku, -1, 'APPLIED', v_session_id);

  return jsonb_build_object('ok', true, 'reason', 'UNDO_APPLIED', 'asn_id', v_event.asn_id, 'carton_id', p_carton_id);
end;
$$;

create or replace function public.erp_mfg_asn_packing_state_v1(
  p_session_token text,
  p_asn_id uuid
) returns jsonb
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

  if not exists (
    select 1
    from public.erp_mfg_asns a
    where a.id = p_asn_id
      and a.company_id = v_company_id
      and a.vendor_id = v_vendor_id
  ) then
    raise exception 'ASN not found for vendor';
  end if;

  return jsonb_build_object(
    'ok', true,
    'cartons', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'carton_no', c.carton_no, 'status', c.status) order by c.carton_no)
      from public.erp_mfg_asn_cartons c
      where c.asn_id = p_asn_id
    ), '[]'::jsonb),
    'lines_in_asn', coalesce((
      select jsonb_agg(jsonb_build_object('po_line_id', t.po_line_id, 'sku', t.sku, 'qty_packed_total', t.qty_total) order by t.sku)
      from (
        select cl.po_line_id, v.sku, sum(cl.qty_packed)::integer as qty_total
        from public.erp_mfg_asn_carton_lines cl
        join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
        join public.erp_purchase_order_lines pol on pol.id = cl.po_line_id and pol.company_id = cl.company_id
        join public.erp_variants v on v.id = pol.variant_id and v.company_id = pol.company_id
        where c.asn_id = p_asn_id
        group by cl.po_line_id, v.sku
      ) t
    ), '[]'::jsonb),
    'applied_scan_count', (
      select count(*)::integer from public.erp_mfg_asn_scan_events e
      where e.asn_id = p_asn_id and e.vendor_id = v_vendor_id and e.status = 'APPLIED' and e.qty_delta > 0
    )
  );
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
  v_has_cartons boolean := false;
  v_scan_count integer := 0;
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

  select exists(select 1 from public.erp_mfg_asn_cartons c where c.asn_id = p_asn_id) into v_has_cartons;
  if not v_has_cartons then
    raise exception 'Create cartons before submit';
  end if;

  select count(*)::integer into v_scan_count
  from public.erp_mfg_asn_scan_events e
  where e.asn_id = p_asn_id
    and e.vendor_id = v_vendor_id
    and e.status = 'APPLIED'
    and e.qty_delta > 0;

  if v_scan_count <= 0 then
    raise exception 'Scan at least one item before submit';
  end if;

  with per_line as (
    select cl.po_line_id, sum(cl.qty_packed)::numeric(18,6) as this_asn_qty
    from public.erp_mfg_asn_carton_lines cl
    join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
    where c.asn_id = p_asn_id
    group by cl.po_line_id
  )
  select pl.po_line_id,
         pl.this_asn_qty,
         pol.ordered_qty::numeric(18,6) as ordered_qty,
         coalesce((
           select sum(al.qty)::numeric(18,6)
           from public.erp_mfg_asn_lines al
           join public.erp_mfg_asns a2 on a2.id = al.asn_id and a2.company_id = al.company_id
           where al.company_id = v_company_id
             and al.po_line_id = pl.po_line_id
             and a2.status = 'SUBMITTED'
             and a2.id <> p_asn_id
         ),0::numeric(18,6)) as already_submitted
  into v_invalid_line
  from per_line pl
  join public.erp_purchase_order_lines pol on pol.id = pl.po_line_id and pol.company_id = v_company_id
  where (pl.this_asn_qty + coalesce((
           select sum(al.qty)::numeric(18,6)
           from public.erp_mfg_asn_lines al
           join public.erp_mfg_asns a2 on a2.id = al.asn_id and a2.company_id = al.company_id
           where al.company_id = v_company_id
             and al.po_line_id = pl.po_line_id
             and a2.status = 'SUBMITTED'
             and a2.id <> p_asn_id
        ),0::numeric(18,6))) > pol.ordered_qty::numeric(18,6)
  limit 1;

  if found then
    raise exception 'Packed qty exceeds remaining open qty for po_line_id=% (ordered %, already_submitted %, this_asn %)',
      v_invalid_line.po_line_id, v_invalid_line.ordered_qty, v_invalid_line.already_submitted, v_invalid_line.this_asn_qty;
  end if;

  delete from public.erp_mfg_asn_lines where asn_id = p_asn_id;
  insert into public.erp_mfg_asn_lines(company_id, asn_id, po_line_id, qty, created_by_session_id)
  select c.company_id, c.asn_id, cl.po_line_id, sum(cl.qty_packed)::numeric(18,6), v_session_id
  from public.erp_mfg_asn_carton_lines cl
  join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
  where c.asn_id = p_asn_id
  group by c.company_id, c.asn_id, cl.po_line_id;

  update public.erp_mfg_asns a
     set status = 'SUBMITTED',
         submitted_at = now(),
         updated_at = now()
   where a.id = p_asn_id
  returning * into v_row;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'SUBMITTED', v_session_id);

  update public.erp_mfg_asn_cartons
     set status = 'CLOSED'
   where asn_id = p_asn_id;

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
  v_has_scan boolean := false;
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

  select exists(select 1 from public.erp_mfg_asn_scan_events e where e.asn_id = p_asn_id and e.status = 'APPLIED') into v_has_scan;
  if v_has_scan then
    raise exception 'Cannot reset cartons after scanning has started';
  end if;

  delete from public.erp_mfg_asn_cartons where asn_id = p_asn_id;

  if p_carton_count > 0 then
    for v_i in 1..p_carton_count loop
      insert into public.erp_mfg_asn_cartons(company_id, asn_id, carton_no, carton_label_code, status, created_by_session_id)
      values (v_company_id, p_asn_id, v_i, format('BOX-%s', v_i), 'OPEN', v_session_id);
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

create or replace function public.erp_mfg_vendor_asn_packing_list_v1(
  p_session_token text,
  p_asn_id uuid
) returns table(
  asn_id uuid,
  carton_no integer,
  sku text,
  qty_packed integer
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

  if not exists (
    select 1 from public.erp_mfg_asns a
    where a.id = p_asn_id and a.company_id = v_company_id and a.vendor_id = v_vendor_id
  ) then
    raise exception 'ASN not found for vendor';
  end if;

  return query
  select c.asn_id, c.carton_no, v.sku, cl.qty_packed
  from public.erp_mfg_asn_carton_lines cl
  join public.erp_mfg_asn_cartons c on c.id = cl.carton_id and c.company_id = cl.company_id
  join public.erp_purchase_order_lines pol on pol.id = cl.po_line_id and pol.company_id = cl.company_id
  join public.erp_variants v on v.id = pol.variant_id and v.company_id = pol.company_id
  where c.asn_id = p_asn_id
  order by c.carton_no, v.sku;
end;
$$;

revoke all on function public.erp_mfg_asn_scan_piece_v1(text, uuid, text) from public;
revoke all on function public.erp_mfg_asn_scan_undo_last_v1(text, uuid) from public;
revoke all on function public.erp_mfg_asn_packing_state_v1(text, uuid) from public;
revoke all on function public.erp_mfg_vendor_asn_packing_list_v1(text, uuid) from public;
revoke all on function public.erp_mfg_asn_submit_v1(text, uuid) from public;
revoke all on function public.erp_mfg_asn_set_cartons_v1(text, uuid, integer) from public;

grant execute on function public.erp_mfg_asn_scan_piece_v1(text, uuid, text) to anon, service_role;
grant execute on function public.erp_mfg_asn_scan_undo_last_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_asn_packing_state_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_vendor_asn_packing_list_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_asn_submit_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_asn_set_cartons_v1(text, uuid, integer) to anon, service_role;

select pg_notify('pgrst', 'reload schema');
