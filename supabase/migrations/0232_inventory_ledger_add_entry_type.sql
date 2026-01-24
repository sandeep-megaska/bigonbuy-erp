-- 0232_inventory_ledger_add_entry_type.sql
-- Add entry_type column expected by posting code; backfill from existing type.

alter table public.erp_inventory_ledger
  add column if not exists entry_type text not null default 'movement';

-- Backfill entry_type from legacy 'type' where it looks meaningful
update public.erp_inventory_ledger
set entry_type = case
  when entry_type is null or btrim(entry_type) = '' or entry_type = 'movement' then
    coalesce(nullif(btrim(type), ''), 'movement')
  else entry_type
end
where true;
