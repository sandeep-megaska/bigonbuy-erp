-- 0240_drop_ap_vendor_payment_upsert_legacy_overload.sql
-- Fix RPC ambiguity: drop legacy overload (vendor_id first, p_id last)

drop function if exists public.erp_ap_vendor_payment_upsert(
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
);
