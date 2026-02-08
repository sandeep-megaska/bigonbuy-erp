-- 0452_mfg_prod1_create_consumption_reversals_table.sql
-- Create missing reversals table required by erp_mfg_stage_consumption_reverse_core_v1.

create table if not exists public.erp_mfg_consumption_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  original_batch_id uuid not null references public.erp_mfg_consumption_batches(id) on delete restrict,
  client_reverse_id uuid not null,
  reason text null,
  reversed_at timestamptz not null default now(),
  reversed_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_mfg_consumption_reversals_original_batch_uniq unique (original_batch_id),
  constraint erp_mfg_consumption_reversals_client_reverse_uniq unique (client_reverse_id)
);

create index if not exists erp_mfg_consumption_reversals_company_vendor_idx
  on public.erp_mfg_consumption_reversals(company_id, vendor_id, reversed_at desc);

alter table public.erp_mfg_consumption_reversals enable row level security;

-- Minimal policy: allow authenticated ERP users (internal) via RLS on tables they already have access to.
-- If you already manage reversals only via SECURITY DEFINER RPCs, you can omit policies.
-- We'll rely on SECURITY DEFINER for writes, and keep table non-readable by default.

revoke all on table public.erp_mfg_consumption_reversals from public;
grant select on table public.erp_mfg_consumption_reversals to authenticated;

select pg_notify('pgrst', 'reload schema');
