-- 0440_mfg_prod1_create_missing_stage_event_tables.sql
-- Safety migration: ensure MFG-PROD-1 core tables exist (create-if-missing).
-- Fixes runtime errors: relation public.erp_mfg_po_line_stage_events does not exist.

create table if not exists public.erp_mfg_po_line_stage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_id uuid null references public.erp_purchase_orders(id) on delete set null,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  stage_code text not null,
  completed_qty_abs numeric(18,6) not null,
  completed_qty_delta numeric(18,6) not null,
  event_note text null,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  created_by_vendor_user_id uuid null,
  constraint erp_mfg_po_line_stage_events_abs_nonneg_chk check (completed_qty_abs >= 0),
  constraint erp_mfg_po_line_stage_events_delta_nonneg_chk check (completed_qty_delta >= 0),
  constraint erp_mfg_po_line_stage_events_vendor_client_event_uniq unique (vendor_id, client_event_id)
);

create index if not exists erp_mfg_po_line_stage_events_lookup_idx
  on public.erp_mfg_po_line_stage_events (company_id, vendor_id, po_line_id, stage_code, created_at desc);

create table if not exists public.erp_mfg_consumption_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  po_line_id uuid not null references public.erp_purchase_order_lines(id) on delete cascade,
  stage_event_id uuid not null references public.erp_mfg_po_line_stage_events(id) on delete restrict,
  stage_code text not null,
  completed_qty_delta numeric(18,6) not null,
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null references auth.users(id) on delete set null,
  reversal_batch_id uuid null,
  reason text null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_batches_stage_event_uniq unique (stage_event_id),
  constraint erp_mfg_consumption_batches_status_chk check (status in ('posted', 'reversed', 'voided')),
  constraint erp_mfg_consumption_batches_delta_nonneg_chk check (completed_qty_delta >= 0)
);

create index if not exists erp_mfg_consumption_batches_lookup_idx
  on public.erp_mfg_consumption_batches (company_id, vendor_id, po_line_id, stage_code, posted_at desc);

create table if not exists public.erp_mfg_consumption_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.erp_mfg_consumption_batches(id) on delete cascade,
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  material_id uuid not null references public.erp_mfg_materials(id) on delete restrict,
  bom_id uuid null references public.erp_mfg_boms(id) on delete set null,
  bom_line_id uuid null references public.erp_mfg_bom_lines(id) on delete set null,
  required_qty numeric(18,6) not null,
  uom text not null,
  ledger_entry_id uuid null references public.erp_mfg_material_ledger(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_batch_lines_required_qty_nonneg_chk check (required_qty >= 0)
);

create index if not exists erp_mfg_consumption_batch_lines_batch_idx
  on public.erp_mfg_consumption_batch_lines (batch_id);

create index if not exists erp_mfg_consumption_batch_lines_material_idx
  on public.erp_mfg_consumption_batch_lines (company_id, vendor_id, material_id);

-- Reload PostgREST schema cache (Supabase)
select pg_notify('pgrst', 'reload schema');
