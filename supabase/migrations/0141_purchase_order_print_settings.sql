-- Extend company settings for purchase order branding
alter table public.erp_company_settings
  add column if not exists legal_name text,
  add column if not exists gstin text,
  add column if not exists address_text text,
  add column if not exists po_terms_text text;
-- Ensure updated_by is never NULL during migrations (auth.uid() is NULL here)
create or replace function public.erp_set_updated_cols()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  return new;
end;
$$;

drop trigger if exists erp_vendors_set_updated on public.erp_vendors;

create trigger erp_vendors_set_updated
before update on public.erp_vendors
for each row
execute function public.erp_set_updated_cols();

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
