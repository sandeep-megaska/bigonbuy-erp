alter table public.erp_external_inventory_batches
  add column if not exists type text not null default 'summary',
  add column if not exists status text not null default 'completed',
  add column if not exists external_report_id text null;

create index if not exists erp_external_inventory_batches_report_idx
  on public.erp_external_inventory_batches (external_report_id);
