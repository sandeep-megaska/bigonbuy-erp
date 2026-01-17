alter table public.erp_products
  add column if not exists style_code text,
  add column if not exists image_url text;

alter table public.erp_variants
  add column if not exists image_url text;

create unique index if not exists erp_products_company_style_code_key
  on public.erp_products (company_id, style_code)
  where style_code is not null;
