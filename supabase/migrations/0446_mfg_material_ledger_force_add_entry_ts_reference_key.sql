-- 0446_mfg_material_ledger_force_add_entry_ts_reference_key.sql
-- Force-add missing columns required by consumption posting:
-- entry_ts, reference_key, created_by_user_id

do $$
begin
  if to_regclass('public.erp_mfg_material_ledger') is null then
    raise exception 'Missing table public.erp_mfg_material_ledger';
  end if;
end $$;

-- Add columns (idempotent)
alter table public.erp_mfg_material_ledger
  add column if not exists entry_ts timestamptz;

alter table public.erp_mfg_material_ledger
  add column if not exists reference_key text;

alter table public.erp_mfg_material_ledger
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

-- Backfill entry_ts
update public.erp_mfg_material_ledger
set entry_ts = coalesce(entry_ts, created_at, (entry_date::timestamptz), now())
where entry_ts is null;

-- Make entry_ts not null + default (only after backfill)
alter table public.erp_mfg_material_ledger
  alter column entry_ts set default now();

alter table public.erp_mfg_material_ledger
  alter column entry_ts set not null;

-- Add unique reference_key index for idempotency (partial unique)
create unique index if not exists erp_mfg_material_ledger_company_reference_key_uniq
  on public.erp_mfg_material_ledger(company_id, reference_key)
  where reference_key is not null;

-- Helpful index
create index if not exists erp_mfg_material_ledger_company_vendor_material_ts_idx
  on public.erp_mfg_material_ledger(company_id, vendor_id, material_id, entry_ts desc);

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
