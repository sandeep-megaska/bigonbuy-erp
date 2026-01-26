-- Add contact fields for document headers
alter table public.erp_company_settings
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists website text;
