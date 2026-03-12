begin;

alter table if exists public.erp_mkt_settings
  add column if not exists meta_ad_account_id text null;

commit;
