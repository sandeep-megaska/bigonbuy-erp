-- 0231_inventory_ledger_canonical_columns.sql
-- Canonicalize erp_inventory_ledger columns to prevent posting failures (GRN/adjustments/issues).
-- Forward-only: add missing columns with safe defaults.

-- Quantities (if 0230 applied, these will already exist; IF NOT EXISTS makes it safe)
alter table public.erp_inventory_ledger
  add column if not exists qty_in integer not null default 0;

alter table public.erp_inventory_ledger
  add column if not exists qty_out integer not null default 0;

-- Costs
alter table public.erp_inventory_ledger
  add column if not exists unit_cost numeric not null default 0;

-- Optional: computed line value (not generated column to avoid complexity)
alter table public.erp_inventory_ledger
  add column if not exists line_value numeric not null default 0;

alter table public.erp_inventory_ledger
  add column if not exists currency text not null default 'INR';

-- References (to link ledger back to documents like GRN/Issue/Transfer)
alter table public.erp_inventory_ledger
  add column if not exists ref_type text null;        -- e.g. 'grn', 'issue', 'transfer', 'adjustment'

alter table public.erp_inventory_ledger
  add column if not exists ref_id uuid null;          -- document id (grn_id, etc.)

alter table public.erp_inventory_ledger
  add column if not exists ref_line_id uuid null;     -- line id if applicable

-- Movement date/time (separate from created_at; useful for backdated postings)
alter table public.erp_inventory_ledger
  add column if not exists movement_at timestamptz not null default now();

-- Audit (many tables already have created_by/created_at; add updated fields for consistency)
alter table public.erp_inventory_ledger
  add column if not exists updated_by uuid null;

alter table public.erp_inventory_ledger
  add column if not exists updated_at timestamptz not null default now();

-- Void lifecycle (in case you ever need to reverse a posting safely)
alter table public.erp_inventory_ledger
  add column if not exists is_void boolean not null default false;

alter table public.erp_inventory_ledger
  add column if not exists void_reason text null;

alter table public.erp_inventory_ledger
  add column if not exists voided_at timestamptz null;

alter table public.erp_inventory_ledger
  add column if not exists voided_by uuid null;

-- Guards
alter table public.erp_inventory_ledger
  drop constraint if exists erp_inventory_ledger_qty_in_out_chk;

alter table public.erp_inventory_ledger
  add constraint erp_inventory_ledger_qty_in_out_chk
  check (
    qty_in >= 0
    and qty_out >= 0
    and not (qty_in > 0 and qty_out > 0)
  );

-- Helpful indexes (safe, only if you expect volume)
create index if not exists erp_inventory_ledger_company_wh_variant_idx
  on public.erp_inventory_ledger(company_id, warehouse_id, variant_id);

create index if not exists erp_inventory_ledger_company_ref_idx
  on public.erp_inventory_ledger(company_id, ref_type, ref_id);
