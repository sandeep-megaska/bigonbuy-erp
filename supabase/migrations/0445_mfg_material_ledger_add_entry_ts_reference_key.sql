-- 0445_mfg_material_ledger_add_entry_ts_reference_key.sql
-- Ensure material ledger supports timestamped entries + idempotency reference keys for MFG-PROD-1.

do $$
begin
  if to_regclass('public.erp_mfg_material_ledger') is null then
    raise exception 'Missing table public.erp_mfg_material_ledger (cannot apply 0445)';
  end if;
end $$;

-- 1) Add entry_ts (timestamp for ordering) + reference_key (idempotency key) + created_by_user_id (audit)
alter table public.erp_mfg_material_ledger
  add column if not exists entry_ts timestamptz;

alter table public.erp_mfg_material_ledger
  add column if not exists reference_key text;

alter table public.erp_mfg_material_ledger
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

-- 2) Backfill entry_ts from best available source
-- Some older schema versions have entry_date (date) and created_at.
-- We keep this robust: prefer created_at, then entry_date::timestamptz, else now().
update public.erp_mfg_material_ledger
set entry_ts = coalesce(entry_ts, created_at, (entry_date::timestamptz), now())
where entry_ts is null;

-- 3) Default + not null (after backfill)
alter table public.erp_mfg_material_ledger
  alter column entry_ts set default now();

alter table public.erp_mfg_material_ledger
  alter column entry_ts set not null;

-- 4) Ensure entry_type constraint allows OUT/REVERSAL etc (don’t break existing values)
-- If you already have a constraint, we replace it with a superset.
alter table public.erp_mfg_material_ledger
  drop constraint if exists erp_mfg_material_ledger_entry_type_check;

alter table public.erp_mfg_material_ledger
  add constraint erp_mfg_material_ledger_entry_type_check
  check (
    entry_type in (
      'OPENING',
      'PURCHASE_IN',
      'ADJUST_IN',
      'ADJUST_OUT',
      'CONSUME_OUT',
      'production_consume',
      'OUT',
      'IN',
      'ADJUST',
      'REVERSAL'
    )
  );

-- 5) Idempotency index on reference_key (partial unique)
create unique index if not exists erp_mfg_material_ledger_company_reference_key_uniq
  on public.erp_mfg_material_ledger (company_id, reference_key)
  where reference_key is not null;

-- 6) Helpful sort/index for balances + ledgers
create index if not exists erp_mfg_material_ledger_company_vendor_material_ts_idx
  on public.erp_mfg_material_ledger (company_id, vendor_id, material_id, entry_ts desc);

-- 7) PostgREST schema reload
select pg_notify('pgrst', 'reload schema');
