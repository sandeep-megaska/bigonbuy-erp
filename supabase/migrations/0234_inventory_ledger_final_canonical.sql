-- 0234_inventory_ledger_final_canonical.sql
-- Ensure canonical columns for erp_inventory_ledger and fix qty/type constraint.

alter table public.erp_inventory_ledger
  add column if not exists qty_in integer,
  add column if not exists qty_out integer,
  add column if not exists unit_cost numeric,
  add column if not exists entry_type text,
  add column if not exists reference text;

alter table public.erp_inventory_ledger
  alter column qty_in set default 0,
  alter column qty_out set default 0;

update public.erp_inventory_ledger
set qty_in = 0
where qty_in is null;

update public.erp_inventory_ledger
set qty_out = 0
where qty_out is null;

alter table public.erp_inventory_ledger
  alter column qty_in set not null,
  alter column qty_out set not null,
  alter column unit_cost drop not null,
  alter column entry_type drop not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_inventory_ledger'
      and column_name = 'qty'
  ) then
    update public.erp_inventory_ledger
    set
      qty_in = case
        when qty > 0 then qty
        else 0
      end,
      qty_out = case
        when qty < 0 then abs(qty)
        else 0
      end
    where qty is not null
      and (qty_in is null or qty_out is null or (qty_in = 0 and qty_out = 0));
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_inventory_ledger'
      and column_name = 'type'
  ) then
    update public.erp_inventory_ledger
    set entry_type = type
    where (entry_type is null or btrim(entry_type) = '')
      and type is not null
      and btrim(type) <> '';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_inventory_ledger'
      and column_name = 'ref'
  ) then
    update public.erp_inventory_ledger
    set reference = ref
    where (reference is null or btrim(reference) = '')
      and ref is not null
      and btrim(ref) <> '';
  end if;
end $$;

alter table public.erp_inventory_ledger
  drop constraint if exists erp_inventory_ledger_qty_type_check;

alter table public.erp_inventory_ledger
  add constraint erp_inventory_ledger_qty_type_check
  check (
    qty_in >= 0
    and qty_out >= 0
    and not (qty_in > 0 and qty_out > 0)
  );

create index if not exists erp_inventory_ledger_company_wh_variant_idx
  on public.erp_inventory_ledger (company_id, warehouse_id, variant_id);

create index if not exists erp_inventory_ledger_company_entry_type_idx
  on public.erp_inventory_ledger (company_id, entry_type);

create index if not exists erp_inventory_ledger_company_reference_idx
  on public.erp_inventory_ledger (company_id, reference);
