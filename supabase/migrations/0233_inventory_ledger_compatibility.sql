-- 0233_inventory_ledger_compatibility.sql
-- Bring erp_inventory_ledger to canonical schema expected by posting logic.
-- Forward-only, safe, idempotent.

-- Quantities
alter table public.erp_inventory_ledger
  add column if not exists qty_in integer not null default 0,
  add column if not exists qty_out integer not null default 0;

-- Costs
alter table public.erp_inventory_ledger
  add column if not exists unit_cost numeric not null default 0,
  add column if not exists line_value numeric not null default 0,
  add column if not exists currency text not null default 'INR';

-- Entry semantics
alter table public.erp_inventory_ledger
  add column if not exists entry_type text not null default 'movement',
  add column if not exists reference text null;

-- Document references
alter table public.erp_inventory_ledger
  add column if not exists ref_type text null,
  add column if not exists ref_id uuid null,
  add column if not exists ref_line_id uuid null;

-- Movement timestamp
alter table public.erp_inventory_ledger
  add column if not exists movement_at timestamptz not null default now();

-- Audit
alter table public.erp_inventory_ledger
  add column if not exists updated_by uuid null,
  add column if not exists updated_at timestamptz not null default now();

-- Void lifecycle
alter table public.erp_inventory_ledger
  add column if not exists is_void boolean not null default false,
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by uuid null;

-- Backfill from legacy columns
update public.erp_inventory_ledger
set
  entry_type = coalesce(nullif(entry_type,''), nullif(type,''), 'movement'),
  reference  = coalesce(reference, ref),
  line_value = case
    when line_value = 0 then abs(qty) * unit_cost
    else line_value
  end
where true;

-- Guard: prevent both in and out
alter table public.erp_inventory_ledger
  drop constraint if exists erp_inventory_ledger_qty_in_out_chk;

alter table public.erp_inventory_ledger
  add constraint erp_inventory_ledger_qty_in_out_chk
  check (
    qty_in >= 0
    and qty_out >= 0
    and not (qty_in > 0 and qty_out > 0)
  );

-- Useful indexes
create index if not exists erp_inventory_ledger_company_ref_idx
  on public.erp_inventory_ledger(company_id, ref_type, ref_id);

create index if not exists erp_inventory_ledger_company_variant_idx
  on public.erp_inventory_ledger(company_id, variant_id);
