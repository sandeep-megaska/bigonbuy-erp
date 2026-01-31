-- 0341_ap_vendor_advances.sql
-- Vendor advances + allocations against vendor bills

create table if not exists public.erp_ap_vendor_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  po_id uuid null references public.erp_purchase_orders (id) on delete set null,
  advance_date date not null default current_date,
  amount numeric not null check (amount >= 0),
  payment_instrument_id uuid null references public.erp_gl_accounts (id) on delete set null,
  bank_txn_id uuid null references public.erp_bank_transactions (id) on delete set null,
  reference text null,
  status text not null default 'draft',
  finance_journal_id uuid null references public.erp_fin_journals (id),
  notes text null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_ap_vendor_advances_status_check
    check (status in ('draft', 'approved', 'void'))
);

create index if not exists erp_ap_vendor_advances_company_vendor_idx
  on public.erp_ap_vendor_advances (company_id, vendor_id);

alter table public.erp_ap_vendor_advances enable row level security;
alter table public.erp_ap_vendor_advances force row level security;

do $$
begin
  drop policy if exists erp_ap_vendor_advances_select on public.erp_ap_vendor_advances;
  drop policy if exists erp_ap_vendor_advances_write on public.erp_ap_vendor_advances;

  create policy erp_ap_vendor_advances_select
    on public.erp_ap_vendor_advances
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

  create policy erp_ap_vendor_advances_write
    on public.erp_ap_vendor_advances
    for all
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
    )
    with check (
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
end $$;

create table if not exists public.erp_ap_vendor_bill_advance_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  bill_id uuid not null references public.erp_gst_purchase_invoices (id) on delete restrict,
  advance_id uuid not null references public.erp_ap_vendor_advances (id) on delete restrict,
  allocated_amount numeric not null check (allocated_amount >= 0),
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_ap_vendor_bill_advance_allocations_unique_active
  on public.erp_ap_vendor_bill_advance_allocations (company_id, bill_id, advance_id)
  where is_void = false;

create index if not exists erp_ap_vendor_bill_advance_allocations_company_bill_idx
  on public.erp_ap_vendor_bill_advance_allocations (company_id, bill_id);

alter table public.erp_ap_vendor_bill_advance_allocations enable row level security;
alter table public.erp_ap_vendor_bill_advance_allocations force row level security;

do $$
begin
  drop policy if exists erp_ap_vendor_bill_advance_allocations_select on public.erp_ap_vendor_bill_advance_allocations;
  drop policy if exists erp_ap_vendor_bill_advance_allocations_write on public.erp_ap_vendor_bill_advance_allocations;

  create policy erp_ap_vendor_bill_advance_allocations_select
    on public.erp_ap_vendor_bill_advance_allocations
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

  create policy erp_ap_vendor_bill_advance_allocations_write
    on public.erp_ap_vendor_bill_advance_allocations
    for all
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
    )
    with check (
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
end $$;

create or replace function public.erp_ap_vendor_advance_create(
  p_vendor_id uuid,
  p_amount numeric,
  p_advance_date date default current_date,
  p_payment_instrument_id uuid default null,
  p_po_id uuid default null,
  p_bank_txn_id uuid default null,
  p_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  insert into public.erp_ap_vendor_advances (
    company_id,
    vendor_id,
    po_id,
    advance_date,
    amount,
    payment_instrument_id,
    bank_txn_id,
    reference,
    notes,
    status,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_vendor_id,
    p_po_id,
    coalesce(p_advance_date, current_date),
    p_amount,
    p_payment_instrument_id,
    p_bank_txn_id,
    nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'draft',
    v_actor,
    v_actor
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_ap_vendor_advance_create(uuid, numeric, date, uuid, uuid, uuid, text, text) from public;
grant execute on function public.erp_ap_vendor_advance_create(uuid, numeric, date, uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.erp_ap_vendor_advance_approve_and_post(
  p_advance_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_advance record;
  v_config record;
  v_advances_account record;
  v_payment_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  perform public.erp_require_finance_writer();

  select a.*, j.doc_no as posted_doc
    into v_advance
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
     and j.company_id = a.company_id
    where a.company_id = v_company_id
      and a.id = p_advance_id
    for update;

  if v_advance.id is null then
    raise exception 'Vendor advance not found';
  end if;

  if v_advance.is_void or v_advance.status = 'void' then
    raise exception 'Vendor advance is void';
  end if;

  if v_advance.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_advance.finance_journal_id, 'doc_no', v_advance.posted_doc);
  end if;

  if v_advance.payment_instrument_id is null then
    raise exception 'payment_instrument_id is required';
  end if;

  select c.* into v_config
    from public.erp_ap_finance_posting_config c
    where c.company_id = v_company_id;

  if v_config.vendor_advances_account_id is null then
    raise exception 'Vendor advances account not configured';
  end if;

  select id, code, name into v_advances_account
    from public.erp_gl_accounts a
    where a.id = v_config.vendor_advances_account_id;

  select id, code, name into v_payment_account
    from public.erp_gl_accounts a
    where a.id = v_advance.payment_instrument_id
      and a.company_id = v_company_id;

  if v_advances_account.id is null or v_payment_account.id is null then
    raise exception 'Advance posting accounts missing';
  end if;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    v_advance.advance_date,
    'posted',
    format('Vendor advance %s', v_advance.reference),
    'vendor_advance',
    v_advance.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    1,
    v_advances_account.code,
    v_advances_account.name,
    'Vendor advance',
    v_advance.amount,
    0
  );

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values (
    v_company_id,
    v_journal_id,
    2,
    v_payment_account.code,
    v_payment_account.name,
    'Advance payment',
    0,
    v_advance.amount
  );

  v_total_debit := v_advance.amount;
  v_total_credit := v_advance.amount;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_ap_vendor_advances
     set finance_journal_id = v_journal_id,
         status = 'approved',
         updated_at = now(),
         updated_by = v_actor
   where id = v_advance.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

revoke all on function public.erp_ap_vendor_advance_approve_and_post(uuid) from public;
grant execute on function public.erp_ap_vendor_advance_approve_and_post(uuid) to authenticated;

create or replace function public.erp_ap_vendor_advance_void(
  p_advance_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_journal_id uuid;
begin
  perform public.erp_require_finance_writer();

  select finance_journal_id
    into v_journal_id
    from public.erp_ap_vendor_advances
    where id = p_advance_id
      and company_id = v_company_id
      and is_void = false
    for update;

  if v_journal_id is not null then
    raise exception 'Posted advances must be reversed before voiding';
  end if;

  update public.erp_ap_vendor_advances
     set status = 'void',
         is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_advance_id
     and company_id = v_company_id;

  return true;
end;
$$;

revoke all on function public.erp_ap_vendor_advance_void(uuid, text) from public;
grant execute on function public.erp_ap_vendor_advance_void(uuid, text) to authenticated;

create or replace function public.erp_ap_vendor_advances_list(
  p_vendor_id uuid default null,
  p_status text default null
) returns table (
  advance_id uuid,
  vendor_id uuid,
  vendor_name text,
  advance_date date,
  amount numeric,
  status text,
  reference text,
  payment_instrument_id uuid,
  finance_journal_id uuid,
  is_void boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  select
    a.id as advance_id,
    a.vendor_id,
    v.legal_name as vendor_name,
    a.advance_date,
    a.amount,
    a.status,
    a.reference,
    a.payment_instrument_id,
    a.finance_journal_id,
    a.is_void
  from public.erp_ap_vendor_advances a
  join public.erp_vendors v
    on v.id = a.vendor_id
    and v.company_id = a.company_id
  where a.company_id = v_company_id
    and (p_vendor_id is null or a.vendor_id = p_vendor_id)
    and (p_status is null or a.status = p_status)
  order by a.advance_date desc, a.created_at desc;
end;
$$;

revoke all on function public.erp_ap_vendor_advances_list(uuid, text) from public;
grant execute on function public.erp_ap_vendor_advances_list(uuid, text) to authenticated;

create or replace function public.erp_ap_vendor_bill_advance_allocate(
  p_bill_id uuid,
  p_advance_id uuid,
  p_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill_vendor_id uuid;
  v_advance_vendor_id uuid;
  v_advance_amount numeric;
  v_allocated_total numeric;
  v_available numeric;
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  if p_amount is null or p_amount <= 0 then
    raise exception 'allocated amount must be greater than zero';
  end if;

  select vendor_id
    into v_bill_vendor_id
    from public.erp_gst_purchase_invoices
    where id = p_bill_id
      and company_id = v_company_id;

  if v_bill_vendor_id is null then
    raise exception 'Vendor bill not found';
  end if;

  select vendor_id, amount
    into v_advance_vendor_id, v_advance_amount
    from public.erp_ap_vendor_advances
    where id = p_advance_id
      and company_id = v_company_id
      and is_void = false
      and status = 'approved';

  if v_advance_vendor_id is null then
    raise exception 'Vendor advance not found or not approved';
  end if;

  if v_bill_vendor_id <> v_advance_vendor_id then
    raise exception 'Vendor mismatch between bill and advance';
  end if;

  select coalesce(sum(a.allocated_amount), 0)
    into v_allocated_total
    from public.erp_ap_vendor_bill_advance_allocations a
    where a.company_id = v_company_id
      and a.advance_id = p_advance_id
      and a.is_void = false;

  v_available := coalesce(v_advance_amount, 0) - coalesce(v_allocated_total, 0);

  if p_amount > v_available then
    raise exception 'Allocated amount exceeds available advance';
  end if;

  insert into public.erp_ap_vendor_bill_advance_allocations (
    company_id,
    bill_id,
    advance_id,
    allocated_amount,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_bill_id,
    p_advance_id,
    p_amount,
    v_actor,
    v_actor
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_advance_allocate(uuid, uuid, numeric) from public;
grant execute on function public.erp_ap_vendor_bill_advance_allocate(uuid, uuid, numeric) to authenticated;

create or replace function public.erp_ap_vendor_bill_advance_void(
  p_allocation_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.erp_require_finance_writer();

  update public.erp_ap_vendor_bill_advance_allocations
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_allocation_id
     and company_id = v_company_id
     and is_void = false;

  return true;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_advance_void(uuid, text) from public;
grant execute on function public.erp_ap_vendor_bill_advance_void(uuid, text) to authenticated;

create or replace function public.erp_ap_vendor_bill_advance_allocations_list(
  p_bill_id uuid
) returns table (
  allocation_id uuid,
  advance_id uuid,
  allocated_amount numeric,
  advance_amount numeric,
  advance_date date,
  reference text,
  status text,
  is_void boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  select
    a.id as allocation_id,
    a.advance_id,
    a.allocated_amount,
    adv.amount as advance_amount,
    adv.advance_date,
    adv.reference,
    adv.status,
    a.is_void
  from public.erp_ap_vendor_bill_advance_allocations a
  join public.erp_ap_vendor_advances adv
    on adv.id = a.advance_id
    and adv.company_id = a.company_id
  where a.company_id = v_company_id
    and a.bill_id = p_bill_id
    and a.is_void = false
  order by a.created_at desc;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_advance_allocations_list(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_advance_allocations_list(uuid) to authenticated;
