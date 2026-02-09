-- 0457_mfg_asn_dispatch_tracking_v1.sql
-- Vendor dispatch metadata, status progression, ASN docs, and event timeline.
-- Forward-only numeric migration (NO timestamp migrations).

-- ============================================================
-- 1) ASN header fields (idempotent)
-- ============================================================
alter table public.erp_mfg_asns
  add column if not exists transporter_name text null,
  add column if not exists tracking_no text null,
  add column if not exists dispatched_at timestamptz null,
  add column if not exists remarks text null;

-- Ensure updated_at exists with default (if column exists already, we won't alter it here to avoid risk).
alter table public.erp_mfg_asns
  add column if not exists updated_at timestamptz not null default now();

-- ============================================================
-- 2) Expand/normalize ASN status CHECK constraint safely
--    - Drop any existing status check constraint (best-effort)
--    - Add canonical status check
-- ============================================================
do $$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'erp_mfg_asns'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if v_constraint is not null then
    execute format('alter table public.erp_mfg_asns drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.erp_mfg_asns
  drop constraint if exists erp_mfg_asns_status_chk;

alter table public.erp_mfg_asns
  add constraint erp_mfg_asns_status_chk
  check (status in (
    'DRAFT','SUBMITTED','DISPATCHED','IN_TRANSIT','CANCELLED','RECEIVED_PARTIAL','RECEIVED_FULL'
  ));

-- ============================================================
-- 3) Events table upgrades: event_ts + payload + event_type CHECK
--    Fix legacy event_type values BEFORE adding constraint.
-- ============================================================
alter table public.erp_mfg_asn_events
  add column if not exists event_ts timestamptz not null default now(),
  add column if not exists payload jsonb null;

-- Backfill event_ts from created_at when possible (safe)
update public.erp_mfg_asn_events
set event_ts = coalesce(created_at, event_ts)
where event_ts is null;

-- Normalize legacy event types:
-- Map known legacy type(s)
update public.erp_mfg_asn_events
set event_type = 'NOTE_ADDED'
where event_type = 'CARTONS_SET';

-- Safety net: any other unexpected types -> NOTE_ADDED
update public.erp_mfg_asn_events
set event_type = 'NOTE_ADDED'
where event_type is not null
  and event_type not in ('CREATED','SUBMITTED','DISPATCHED','IN_TRANSIT','CANCELLED','NOTE_ADDED','DOC_UPLOADED');

alter table public.erp_mfg_asn_events
  drop constraint if exists erp_mfg_asn_events_event_type_chk;

alter table public.erp_mfg_asn_events
  add constraint erp_mfg_asn_events_event_type_chk
  check (event_type in ('CREATED','SUBMITTED','DISPATCHED','IN_TRANSIT','CANCELLED','NOTE_ADDED','DOC_UPLOADED'));

create index if not exists erp_mfg_asn_events_asn_event_ts_desc_idx
  on public.erp_mfg_asn_events(asn_id, event_ts desc);

-- ============================================================
-- 4) Documents table (idempotent) + RLS + ERP read policy
-- ============================================================
create table if not exists public.erp_mfg_asn_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete restrict,
  asn_id uuid not null references public.erp_mfg_asns(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete restrict,
  doc_type text not null,
  file_path text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists erp_mfg_asn_documents_asn_uploaded_desc_idx
  on public.erp_mfg_asn_documents(asn_id, uploaded_at desc);

alter table public.erp_mfg_asn_documents enable row level security;

drop policy if exists erp_mfg_asn_documents_erp_read_all on public.erp_mfg_asn_documents;
create policy erp_mfg_asn_documents_erp_read_all
on public.erp_mfg_asn_documents
for select to authenticated
using (public.is_erp_manager(auth.uid()));

-- (Optional) Vendor RLS policies can be added later if you expose docs list in vendor UI via PostgREST directly.
-- For now vendor access is via SECURITY DEFINER RPCs.

-- ============================================================
-- 5) Storage bucket (best-effort idempotent)
-- ============================================================
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'mfg-asn-docs') then
    insert into storage.buckets (id, name, public)
    values ('mfg-asn-docs', 'mfg-asn-docs', false);
  end if;
end $$;

-- ============================================================
-- 6) DROP + CREATE functions (fixes 42P13 return-type mismatch)
-- ============================================================

-- Mark Dispatched
drop function if exists public.erp_mfg_asn_mark_dispatched_v1(text, uuid, text, text, timestamptz, text);
create function public.erp_mfg_asn_mark_dispatched_v1(
  p_session_token text,
  p_asn_id uuid,
  p_transporter text,
  p_tracking_no text,
  p_dispatched_at timestamptz,
  p_remarks text
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
     set status = 'DISPATCHED',
         transporter_name = nullif(trim(coalesce(p_transporter, '')), ''),
         tracking_no = nullif(trim(coalesce(p_tracking_no, '')), ''),
         dispatched_at = coalesce(p_dispatched_at, now()),
         remarks = nullif(trim(coalesce(p_remarks, '')), ''),
         updated_at = now()
   where a.id = p_asn_id
     and a.company_id = v_company_id
     and a.vendor_id = v_vendor_id
     and a.status = 'SUBMITTED'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ASN not found or cannot be marked dispatched';
  end if;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, event_ts, payload, created_by_session_id)
  values (
    v_company_id,
    p_asn_id,
    v_vendor_id,
    'DISPATCHED',
    coalesce(v_row.dispatched_at, now()),
    jsonb_strip_nulls(jsonb_build_object(
      'transporter_name', v_row.transporter_name,
      'tracking_no', v_row.tracking_no,
      'remarks', v_row.remarks
    )),
    v_session_id
  );

  return v_row;
end;
$$;

-- Mark In Transit
drop function if exists public.erp_mfg_asn_mark_in_transit_v1(text, uuid, text);
create function public.erp_mfg_asn_mark_in_transit_v1(
  p_session_token text,
  p_asn_id uuid,
  p_remarks text default null
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
     set status = 'IN_TRANSIT',
         remarks = coalesce(nullif(trim(coalesce(p_remarks, '')), ''), a.remarks),
         updated_at = now()
   where a.id = p_asn_id
     and a.company_id = v_company_id
     and a.vendor_id = v_vendor_id
     and a.status = 'DISPATCHED'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ASN not found or cannot be marked in transit';
  end if;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, payload, created_by_session_id)
  values (
    v_company_id,
    p_asn_id,
    v_vendor_id,
    'IN_TRANSIT',
    jsonb_strip_nulls(jsonb_build_object('remarks', nullif(trim(coalesce(p_remarks, '')), ''))),
    v_session_id
  );

  return v_row;
end;
$$;

-- Add Note
drop function if exists public.erp_mfg_asn_add_note_v1(text, uuid, text);
create function public.erp_mfg_asn_add_note_v1(
  p_session_token text,
  p_asn_id uuid,
  p_note text
) returns public.erp_mfg_asn_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_note text;
  v_asn public.erp_mfg_asns;
  v_event public.erp_mfg_asn_events;
begin
  if p_asn_id is null then
    raise exception 'asn_id is required';
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null then
    raise exception 'note is required';
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
    and a.vendor_id = v_vendor_id;

  if v_asn.id is null then
    raise exception 'ASN not found for vendor';
  end if;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, payload, created_by_session_id)
  values (v_company_id, p_asn_id, v_vendor_id, 'NOTE_ADDED', jsonb_build_object('note', v_note), v_session_id)
  returning * into v_event;

  return v_event;
end;
$$;

-- Document Create
drop function if exists public.erp_mfg_asn_document_create_v1(text, uuid, text, text);
create function public.erp_mfg_asn_document_create_v1(
  p_session_token text,
  p_asn_id uuid,
  p_doc_type text,
  p_file_path text
) returns public.erp_mfg_asn_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me jsonb;
  v_company_id uuid;
  v_vendor_id uuid;
  v_session_id uuid;
  v_doc_type text;
  v_file_path text;
  v_asn public.erp_mfg_asns;
  v_doc public.erp_mfg_asn_documents;
begin
  if p_asn_id is null then
    raise exception 'asn_id is required';
  end if;

  v_doc_type := upper(nullif(trim(coalesce(p_doc_type, '')), ''));
  v_file_path := nullif(trim(coalesce(p_file_path, '')), '');

  if v_doc_type is null then
    raise exception 'doc_type is required';
  end if;
  if v_file_path is null then
    raise exception 'file_path is required';
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
    and a.vendor_id = v_vendor_id;

  if v_asn.id is null then
    raise exception 'ASN not found for vendor';
  end if;

  insert into public.erp_mfg_asn_documents(company_id, asn_id, vendor_id, doc_type, file_path)
  values (v_company_id, p_asn_id, v_vendor_id, v_doc_type, v_file_path)
  returning * into v_doc;

  insert into public.erp_mfg_asn_events(company_id, asn_id, vendor_id, event_type, payload, created_by_session_id)
  values (
    v_company_id,
    p_asn_id,
    v_vendor_id,
    'DOC_UPLOADED',
    jsonb_build_object('doc_id', v_doc.id, 'doc_type', v_doc.doc_type, 'file_path', v_doc.file_path),
    v_session_id
  );

  return v_doc;
end;
$$;

-- Tracking detail (JSON)
drop function if exists public.erp_mfg_asn_tracking_detail_v1(text, uuid);
create function public.erp_mfg_asn_tracking_detail_v1(
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
  v_asn jsonb;
  v_events jsonb;
  v_docs jsonb;
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

  select to_jsonb(a.*) into v_asn
  from public.erp_mfg_asns a
  where a.id = p_asn_id
    and a.company_id = v_company_id
    and a.vendor_id = v_vendor_id;

  if v_asn is null then
    raise exception 'ASN not found for vendor';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by coalesce(e.event_ts, e.created_at) desc), '[]'::jsonb)
    into v_events
  from public.erp_mfg_asn_events e
  where e.asn_id = p_asn_id
    and e.company_id = v_company_id
    and e.vendor_id = v_vendor_id;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.uploaded_at desc), '[]'::jsonb)
    into v_docs
  from public.erp_mfg_asn_documents d
  where d.asn_id = p_asn_id
    and d.company_id = v_company_id
    and d.vendor_id = v_vendor_id;

  return jsonb_build_object('asn', v_asn, 'events', v_events, 'documents', v_docs);
end;
$$;

-- Vendor list
drop function if exists public.erp_mfg_vendor_asns_list_v1(text, text, date, date);
create function public.erp_mfg_vendor_asns_list_v1(
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
  transporter_name text,
  tracking_no text,
  dispatched_at timestamptz,
  remarks text,
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
    a.transporter_name,
    a.tracking_no,
    a.dispatched_at,
    a.remarks,
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
  group by a.id, a.po_id, po.doc_no, po.po_no, a.status, a.dispatch_date, a.eta_date,
           a.transporter_name, a.tracking_no, a.dispatched_at, a.remarks, a.created_at
  order by a.created_at desc;
end;
$$;

-- ERP list
drop function if exists public.erp_mfg_erp_asns_list_v1(uuid, text, date, date);
create function public.erp_mfg_erp_asns_list_v1(
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
  transporter_name text,
  tracking_no text,
  dispatched_at timestamptz,
  remarks text,
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
    a.transporter_name,
    a.tracking_no,
    a.dispatched_at,
    a.remarks,
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
  group by a.id, a.company_id, a.vendor_id, v.legal_name, a.po_id, po.doc_no, po.po_no, a.status, a.dispatch_date, a.eta_date,
           a.transporter_name, a.tracking_no, a.dispatched_at, a.remarks, a.created_at
  order by a.created_at desc;
end;
$$;

-- ============================================================
-- 7) Lock core fields after submit/cancel via trigger
-- ============================================================
-- ============================================================
-- 7) Lock core fields after submit/cancel via trigger
-- ============================================================

-- Drop trigger first (it depends on the function)
drop trigger if exists erp_mfg_asns_lock_after_submit_trg on public.erp_mfg_asns;
-- Some older versions might have used a different trigger name:
drop trigger if exists erp_mfg_asns_lock_after_submit on public.erp_mfg_asns;

-- Now it's safe to drop/recreate the function
drop function if exists public.erp_mfg_asn_lock_after_submit_v1();

create function public.erp_mfg_asn_lock_after_submit_v1()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('SUBMITTED', 'DISPATCHED', 'IN_TRANSIT', 'CANCELLED', 'RECEIVED_PARTIAL', 'RECEIVED_FULL') then
    if new.dispatch_date is distinct from old.dispatch_date
       or new.eta_date is distinct from old.eta_date
       or new.po_id is distinct from old.po_id
       or new.vendor_id is distinct from old.vendor_id
       or new.company_id is distinct from old.company_id then
      raise exception 'ASN core fields are locked after submit/cancel';
    end if;
  end if;

  -- keep updated_at fresh if column exists
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='erp_mfg_asns' and column_name='updated_at'
  ) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger erp_mfg_asns_lock_after_submit_trg
before update on public.erp_mfg_asns
for each row
execute function public.erp_mfg_asn_lock_after_submit_v1();


-- ============================================================
-- 8) Permissions
-- ============================================================
revoke all on function public.erp_mfg_asn_mark_dispatched_v1(text, uuid, text, text, timestamptz, text) from public;
revoke all on function public.erp_mfg_asn_mark_in_transit_v1(text, uuid, text) from public;
revoke all on function public.erp_mfg_asn_add_note_v1(text, uuid, text) from public;
revoke all on function public.erp_mfg_asn_document_create_v1(text, uuid, text, text) from public;
revoke all on function public.erp_mfg_asn_tracking_detail_v1(text, uuid) from public;
revoke all on function public.erp_mfg_vendor_asns_list_v1(text, text, date, date) from public;

-- Vendor cookie auth commonly uses anon + service_role in your setup
grant execute on function public.erp_mfg_asn_mark_dispatched_v1(text, uuid, text, text, timestamptz, text) to anon, service_role;
grant execute on function public.erp_mfg_asn_mark_in_transit_v1(text, uuid, text) to anon, service_role;
grant execute on function public.erp_mfg_asn_add_note_v1(text, uuid, text) to anon, service_role;
grant execute on function public.erp_mfg_asn_document_create_v1(text, uuid, text, text) to anon, service_role;
grant execute on function public.erp_mfg_asn_tracking_detail_v1(text, uuid) to anon, service_role;
grant execute on function public.erp_mfg_vendor_asns_list_v1(text, text, date, date) to anon, service_role;

-- ERP list is invoker + ERP auth; keep default privileges, but grant to authenticated if needed
grant select on public.erp_mfg_asn_documents to authenticated, service_role;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
