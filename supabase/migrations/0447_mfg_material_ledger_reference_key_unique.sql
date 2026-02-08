-- 0447_mfg_material_ledger_reference_key_unique.sql
-- Ensure ON CONFLICT (company_id, reference_key) works by providing a matching UNIQUE index.

do $$
begin
  if to_regclass('public.erp_mfg_material_ledger') is null then
    raise exception 'Missing table public.erp_mfg_material_ledger';
  end if;
end $$;

-- Drop the partial unique index if it exists (name may vary, so we attempt the common one)
drop index if exists public.erp_mfg_material_ledger_company_reference_key_uniq;

-- Create a NON-partial unique index so ON CONFLICT (company_id, reference_key) is valid.
-- Multiple NULL reference_key values are allowed under UNIQUE in Postgres, so this is safe.
create unique index if not exists erp_mfg_material_ledger_company_reference_key_uniq
  on public.erp_mfg_material_ledger(company_id, reference_key);

select pg_notify('pgrst', 'reload schema');
