-- Vendor portal dual-logo support

alter table public.erp_vendors
  add column if not exists portal_logo_path text,
  add column if not exists portal_logo_updated_at timestamptz;

alter table public.erp_companies
  add column if not exists secondary_logo_path text,
  add column if not exists secondary_logo_updated_at timestamptz;
