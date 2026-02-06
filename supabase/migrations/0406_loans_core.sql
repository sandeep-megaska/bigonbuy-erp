begin;

create table if not exists public.erp_loans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  loan_type text not null,
  lender_name text not null,
  loan_ref text null,
  sanction_amount numeric(14,2) null,
  disbursed_amount numeric(14,2) not null default 0,
  disbursed_date date null,
  interest_rate_annual numeric(8,4) null,
  tenure_months integer null,
  emi_amount numeric(14,2) null,
  repayment_day integer null,
  status text not null default 'active',
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null,
  constraint erp_loans_type_check check (loan_type in ('term_loan', 'rbf', 'overdraft', 'other')),
  constraint erp_loans_status_check check (status in ('active', 'closed', 'void')),
  constraint erp_loans_repayment_day_check check (repayment_day is null or (repayment_day between 1 and 28))
);

create index if not exists erp_loans_company_status_idx
  on public.erp_loans (company_id, status);

create index if not exists erp_loans_company_lender_idx
  on public.erp_loans (company_id, lender_name);

create table if not exists public.erp_loan_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  loan_id uuid not null references public.erp_loans (id) on delete restrict,
  due_date date not null,
  opening_principal numeric(14,2) not null default 0,
  emi_amount numeric(14,2) not null,
  principal_component numeric(14,2) not null default 0,
  interest_component numeric(14,2) not null default 0,
  closing_principal numeric(14,2) not null default 0,
  status text not null default 'due',
  paid_at timestamptz null,
  paid_by_user_id uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null,
  constraint erp_loan_schedules_status_check check (status in ('due', 'paid', 'skipped', 'void')),
  constraint erp_loan_schedules_split_check check (
    round(coalesce(principal_component, 0)::numeric, 2) + round(coalesce(interest_component, 0)::numeric, 2) = round(coalesce(emi_amount, 0)::numeric, 2)
  )
);

alter table public.erp_loan_schedules
  add constraint erp_loan_schedules_company_loan_due_uniq unique (company_id, loan_id, due_date);

create index if not exists erp_loan_schedules_company_due_idx
  on public.erp_loan_schedules (company_id, due_date);

create index if not exists erp_loan_schedules_company_loan_due_idx
  on public.erp_loan_schedules (company_id, loan_id, due_date);

create table if not exists public.erp_loan_finance_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  schedule_id uuid not null references public.erp_loan_schedules (id) on delete restrict,
  journal_id uuid not null references public.erp_fin_journals (id) on delete restrict,
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null,
  constraint erp_loan_finance_posts_company_schedule_uniq unique (company_id, schedule_id)
);

create index if not exists erp_loan_finance_posts_company_schedule_idx
  on public.erp_loan_finance_posts (company_id, schedule_id);

create index if not exists erp_loan_finance_posts_company_journal_idx
  on public.erp_loan_finance_posts (company_id, journal_id);

alter table public.erp_loans enable row level security;
alter table public.erp_loans force row level security;
alter table public.erp_loan_schedules enable row level security;
alter table public.erp_loan_schedules force row level security;
alter table public.erp_loan_finance_posts enable row level security;
alter table public.erp_loan_finance_posts force row level security;

do $$
begin
  drop policy if exists erp_loans_select on public.erp_loans;
  drop policy if exists erp_loans_write on public.erp_loans;
  drop policy if exists erp_loan_schedules_select on public.erp_loan_schedules;
  drop policy if exists erp_loan_schedules_write on public.erp_loan_schedules;
  drop policy if exists erp_loan_finance_posts_select on public.erp_loan_finance_posts;
  drop policy if exists erp_loan_finance_posts_write on public.erp_loan_finance_posts;

  create policy erp_loans_select
    on public.erp_loans
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    );

  create policy erp_loans_write
    on public.erp_loans
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    )
    with check (company_id = public.erp_current_company_id());

  create policy erp_loan_schedules_select
    on public.erp_loan_schedules
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    );

  create policy erp_loan_schedules_write
    on public.erp_loan_schedules
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    )
    with check (company_id = public.erp_current_company_id());

  create policy erp_loan_finance_posts_select
    on public.erp_loan_finance_posts
    for select
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    );

  create policy erp_loan_finance_posts_write
    on public.erp_loan_finance_posts
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner','admin','finance')
        ))
    )
    with check (company_id = public.erp_current_company_id());
end
$$;

commit;
