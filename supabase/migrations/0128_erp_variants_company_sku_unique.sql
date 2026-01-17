alter table public.erp_variants
  drop constraint if exists erp_variants_sku_key;

create unique index if not exists erp_variants_company_sku_key
  on public.erp_variants (company_id, sku);
