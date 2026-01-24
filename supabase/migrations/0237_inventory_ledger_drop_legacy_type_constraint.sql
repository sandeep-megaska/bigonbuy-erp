begin;

-- Drop the legacy constraint that blocks canonical inserts
alter table public.erp_inventory_ledger
  drop constraint if exists erp_inventory_ledger_type_check;

-- Recreate a modern compatible constraint
alter table public.erp_inventory_ledger
  add constraint erp_inventory_ledger_type_check
  check (
    (
      -- New canonical mode
      coalesce(qty_in, 0) >= 0
      and coalesce(qty_out, 0) >= 0
      and not (coalesce(qty_in, 0) > 0 and coalesce(qty_out, 0) > 0)
      and (
        coalesce(qty_in, 0) > 0
        or coalesce(qty_out, 0) > 0
        or (coalesce(qty_in, 0) = 0 and coalesce(qty_out, 0) = 0)
      )
    )
    or
    (
      -- Legacy compatibility
      qty is not null
      and qty <> 0
      and type is not null
      and btrim(type) <> ''
    )
  );

commit;
