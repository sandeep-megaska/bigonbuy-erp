-- GST fields for invoices and invoice lines

alter table public.erp_invoices
  add column if not exists billing_state_code text,
  add column if not exists billing_state_name text,
  add column if not exists shipping_state_code text,
  add column if not exists shipping_state_name text,
  add column if not exists place_of_supply_state_code text,
  add column if not exists place_of_supply_state_name text,
  add column if not exists is_inter_state boolean,
  add column if not exists taxable_amount numeric(12,2) not null default 0,
  add column if not exists cgst_amount numeric(12,2) not null default 0,
  add column if not exists sgst_amount numeric(12,2) not null default 0,
  add column if not exists igst_amount numeric(12,2) not null default 0,
  add column if not exists gst_amount numeric(12,2) not null default 0,
  add column if not exists total_amount numeric(12,2) not null default 0;

alter table public.erp_invoice_lines
  add column if not exists discount_percent numeric(5,2) not null default 0,
  add column if not exists tax_percent numeric(5,2) not null default 0,
  add column if not exists taxable_amount numeric(12,2) not null default 0,
  add column if not exists cgst_amount numeric(12,2) not null default 0,
  add column if not exists sgst_amount numeric(12,2) not null default 0,
  add column if not exists igst_amount numeric(12,2) not null default 0,
  add column if not exists line_total numeric(12,2) not null default 0;

alter table public.erp_invoice_lines
  add column if not exists line_subtotal numeric(14,2) not null default 0,
  add column if not exists line_tax numeric(14,2) not null default 0;

update public.erp_invoice_lines
  set tax_percent = coalesce(nullif(tax_percent, 0), tax_rate, 0),
      taxable_amount = coalesce(nullif(taxable_amount, 0), line_subtotal, 0),
      cgst_amount = coalesce(nullif(cgst_amount, 0), 0),
      sgst_amount = coalesce(nullif(sgst_amount, 0), 0),
      igst_amount = coalesce(nullif(igst_amount, 0), line_tax, 0),
      line_total = coalesce(nullif(line_total, 0), line_total, 0);


update public.erp_invoices
  set taxable_amount = coalesce(nullif(taxable_amount, 0), subtotal, 0),
      cgst_amount = coalesce(nullif(cgst_amount, 0), cgst_total, 0),
      sgst_amount = coalesce(nullif(sgst_amount, 0), sgst_total, 0),
      igst_amount = coalesce(nullif(igst_amount, 0), igst_total, 0),
      gst_amount = coalesce(nullif(gst_amount, 0), tax_total, 0),
      total_amount = coalesce(nullif(total_amount, 0), total, 0);
