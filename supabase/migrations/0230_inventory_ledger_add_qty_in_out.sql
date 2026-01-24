-- 0230_inventory_ledger_add_qty_in_out.sql
-- Add qty_in / qty_out to align with GRN posting logic.
-- Keep existing qty + type for backward compatibility.

alter table public.erp_inventory_ledger
  add column if not exists qty_in integer not null default 0;

alter table public.erp_inventory_ledger
  add column if not exists qty_out integer not null default 0;

-- Best-effort backfill for existing rows:
-- Common conventions:
--  - type in ('in','receipt','grn','stock_in') => qty_in
--  - type in ('out','issue','stock_out') => qty_out
update public.erp_inventory_ledger
set
  qty_in = case
    when qty_in = 0 and lower(coalesce(type,'')) in ('in','receipt','grn','stock_in') then qty
    else qty_in
  end,
  qty_out = case
    when qty_out = 0 and lower(coalesce(type,'')) in ('out','issue','stock_out') then qty
    else qty_out
  end
where qty <> 0;

-- Prevent both being positive simultaneously (ERP correctness guard)
alter table public.erp_inventory_ledger
  drop constraint if exists erp_inventory_ledger_qty_in_out_chk;

alter table public.erp_inventory_ledger
  add constraint erp_inventory_ledger_qty_in_out_chk
  check (
    qty_in >= 0
    and qty_out >= 0
    and not (qty_in > 0 and qty_out > 0)
  );
