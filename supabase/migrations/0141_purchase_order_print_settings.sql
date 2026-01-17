-- Extend company settings for purchase order branding
alter table public.erp_company_settings
  add column if not exists legal_name text,
  add column if not exists gstin text,
  add column if not exists address_text text,
  add column if not exists po_terms_text text;

update public.erp_company_settings
  set address_text = coalesce(address_text, po_footer_address_text)
  where address_text is null
    and po_footer_address_text is not null;

-- Extend vendor addresses for print-ready POs
alter table public.erp_vendors
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists country text;

update public.erp_vendors
  set address_line1 = coalesce(address_line1, address)
  where address_line1 is null
    and address is not null;
