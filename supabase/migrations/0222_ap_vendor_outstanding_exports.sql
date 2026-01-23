-- 0222_ap_vendor_outstanding_exports.sql

------------------------------------------------------------
-- RPC: Vendor Outstanding Export
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_outstanding_export(date, uuid);

create function public.erp_ap_vendor_outstanding_export(
  p_as_of date,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
  vendor_name text,
  invoice_total numeric,
  payment_total numeric,
  outstanding numeric,
  last_invoice_date date,
  last_payment_date date
)
language sql
security definer
set search_path = public
as $$
  select *
  from public.erp_ap_vendor_outstanding(p_as_of, p_vendor_id);
$$;

grant execute on function public.erp_ap_vendor_outstanding_export(date, uuid) to authenticated;

------------------------------------------------------------
-- RPC: Vendor Aging Export
------------------------------------------------------------

drop function if exists public.erp_ap_vendor_aging_export(date, uuid);

create function public.erp_ap_vendor_aging_export(
  p_as_of date,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
  vendor_name text,
  bucket_0_30 numeric,
  bucket_31_60 numeric,
  bucket_61_90 numeric,
  bucket_90_plus numeric,
  outstanding_total numeric
)
language sql
security definer
set search_path = public
as $$
  select
    aging.vendor_id,
    vendors.legal_name,
    aging.bucket_0_30,
    aging.bucket_31_60,
    aging.bucket_61_90,
    aging.bucket_90_plus,
    aging.outstanding_total
  from public.erp_ap_vendor_aging(p_as_of, p_vendor_id) aging
  left join public.erp_vendors vendors
    on vendors.id = aging.vendor_id;
$$;

grant execute on function public.erp_ap_vendor_aging_export(date, uuid) to authenticated;
