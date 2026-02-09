begin;

alter table if exists public.erp_mkt_settings
  add column if not exists meta_test_event_code text null;

commit;
