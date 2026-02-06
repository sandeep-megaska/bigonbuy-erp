begin;

alter table public.erp_marketplace_settlement_batches
  add column if not exists is_void boolean not null default false,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by_user_id uuid;

create index if not exists erp_mkt_settlement_batches_company_void_idx
  on public.erp_marketplace_settlement_batches (company_id, is_void);

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
end $$;

commit;
