-- 0241_ap_payment_allocations.sql
-- Phase-3B: AP vendor payment allocations

create table if not exists public.erp_ap_vendor_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete restrict,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  invoice_id uuid not null references public.erp_gst_purchase_invoices (id) on delete restrict,
  payment_id uuid not null references public.erp_ap_vendor_payments (id) on delete restrict,
  allocated_amount numeric not null check (allocated_amount > 0),
  allocation_date date not null default current_date,
  note text null,
  source text not null default 'manual',
  source_ref text null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

create index if not exists erp_ap_vendor_payment_allocations_company_vendor_idx
  on public.erp_ap_vendor_payment_allocations (company_id, vendor_id);

create index if not exists erp_ap_vendor_payment_allocations_company_invoice_idx
  on public.erp_ap_vendor_payment_allocations (company_id, invoice_id);

create index if not exists erp_ap_vendor_payment_allocations_company_payment_idx
  on public.erp_ap_vendor_payment_allocations (company_id, payment_id);

create unique index if not exists erp_ap_vendor_payment_allocations_unique_active
  on public.erp_ap_vendor_payment_allocations (company_id, invoice_id, payment_id)
  where is_void = false;

alter table public.erp_ap_vendor_payment_allocations enable row level security;
alter table public.erp_ap_vendor_payment_allocations force row level security;

do $$
begin
  drop policy if exists erp_ap_vendor_payment_allocations_select
    on public.erp_ap_vendor_payment_allocations;

  create policy erp_ap_vendor_payment_allocations_select
    on public.erp_ap_vendor_payment_allocations
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end;
$$;
