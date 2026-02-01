-- 0354_fin_period_lock_month_close.sql
-- Phase F3-A: Period Locks + Month Close skeleton

create table if not exists public.erp_fin_period_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  fiscal_year text not null,
  period_month int not null,
  is_locked boolean not null default true,
  locked_at timestamptz not null default now(),
  locked_by uuid null,
  lock_reason text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_fin_period_locks_unique unique (company_id, fiscal_year, period_month),
  constraint erp_fin_period_locks_month_check check (period_month between 1 and 12)
);

create index if not exists erp_fin_period_locks_company_fy_month_idx
  on public.erp_fin_period_locks (company_id, fiscal_year, period_month);

alter table public.erp_fin_period_locks enable row level security;
alter table public.erp_fin_period_locks force row level security;

do $$
begin
  drop policy if exists erp_fin_period_locks_select on public.erp_fin_period_locks;
  drop policy if exists erp_fin_period_locks_write on public.erp_fin_period_locks;

  create policy erp_fin_period_locks_select
    on public.erp_fin_period_locks
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

  create policy erp_fin_period_locks_write
    on public.erp_fin_period_locks
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
    );
end $$;

create table if not exists public.erp_fin_month_close (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  fiscal_year text not null,
  period_month int not null,
  status text not null default 'draft',
  closed_at timestamptz null,
  closed_by uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_fin_month_close_unique unique (company_id, fiscal_year, period_month),
  constraint erp_fin_month_close_month_check check (period_month between 1 and 12),
  constraint erp_fin_month_close_status_check check (status in ('draft', 'in_progress', 'ready', 'closed'))
);

create index if not exists erp_fin_month_close_company_fy_month_idx
  on public.erp_fin_month_close (company_id, fiscal_year, period_month);

alter table public.erp_fin_month_close enable row level security;
alter table public.erp_fin_month_close force row level security;

do $$
begin
  drop policy if exists erp_fin_month_close_select on public.erp_fin_month_close;
  drop policy if exists erp_fin_month_close_write on public.erp_fin_month_close;

  create policy erp_fin_month_close_select
    on public.erp_fin_month_close
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

  create policy erp_fin_month_close_write
    on public.erp_fin_month_close
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
    );
end $$;

create or replace function public.erp_fiscal_period_month(p_date date)
returns int
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_month int := extract(month from p_date)::int;
begin
  if v_month >= 4 then
    return v_month - 3;
  end if;

  return v_month + 9;
end;
$$;

create or replace function public.erp_fin_period_is_locked(
  p_company_id uuid,
  p_posting_date date
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiscal_year text := public.erp_fiscal_year(p_posting_date);
  v_period_month int := public.erp_fiscal_period_month(p_posting_date);
  v_is_locked boolean;
begin
  select exists (
    select 1
    from public.erp_fin_period_locks l
    where l.company_id = p_company_id
      and l.fiscal_year = v_fiscal_year
      and l.period_month = v_period_month
      and l.is_locked = true
  ) into v_is_locked;

  return coalesce(v_is_locked, false);
end;
$$;

create or replace function public.erp_require_fin_open_period(
  p_company_id uuid,
  p_posting_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiscal_year text := public.erp_fiscal_year(p_posting_date);
  v_period_month int := public.erp_fiscal_period_month(p_posting_date);
  v_locked boolean;
begin
  v_locked := public.erp_fin_period_is_locked(p_company_id, p_posting_date);

  if v_locked then
    raise exception 'Period is locked: % month %', v_fiscal_year, v_period_month;
  end if;
end;
$$;

create or replace function public.erp_fin_period_lock(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  insert into public.erp_fin_period_locks (
    company_id,
    fiscal_year,
    period_month,
    is_locked,
    locked_at,
    locked_by,
    lock_reason,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_company_id,
    p_fiscal_year,
    p_period_month,
    true,
    now(),
    v_actor,
    p_reason,
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, fiscal_year, period_month)
  do update set
    is_locked = true,
    locked_at = now(),
    locked_by = v_actor,
    lock_reason = coalesce(p_reason, public.erp_fin_period_locks.lock_reason),
    updated_at = now(),
    updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.erp_fin_period_unlock(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_reason text;
  v_existing_reason text;
begin
  perform public.erp_require_finance_writer();

  -- Unlocking should be rare; keep a clear audit trail of the reason.
  select lock_reason
    into v_existing_reason
    from public.erp_fin_period_locks
    where company_id = p_company_id
      and fiscal_year = p_fiscal_year
      and period_month = p_period_month;

  if p_reason is not null then
    v_reason := case
      when v_existing_reason is null or v_existing_reason = '' then
        format('Unlocked: %s', p_reason)
      else
        v_existing_reason || E'\n' || format('Unlocked: %s', p_reason)
    end;
  else
    v_reason := v_existing_reason;
  end if;

  update public.erp_fin_period_locks
     set is_locked = false,
         lock_reason = v_reason,
         updated_at = now(),
         updated_by = v_actor
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and period_month = p_period_month
  returning id into v_id;

  if v_id is null then
    raise exception 'Lock record not found';
  end if;

  return v_id;
end;
$$;

create or replace function public.erp_fin_period_locks_list(
  p_company_id uuid,
  p_fiscal_year text
) returns table (
  id uuid,
  company_id uuid,
  fiscal_year text,
  period_month int,
  is_locked boolean,
  locked_at timestamptz,
  locked_by uuid,
  lock_reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    l.id,
    l.company_id,
    l.fiscal_year,
    l.period_month,
    l.is_locked,
    l.locked_at,
    l.locked_by,
    l.lock_reason
  from public.erp_fin_period_locks l
  where l.company_id = p_company_id
    and l.fiscal_year = p_fiscal_year
  order by l.period_month;
end;
$$;

create or replace function public.erp_fin_month_close_checks(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_year int;
  v_month int;
  v_year int;
  v_start_date date;
  v_end_date date;
  v_bank_ok boolean := false;
  v_bank_details jsonb := jsonb_build_object('message', 'Bank reconciliation close not implemented yet');
  v_sales_ok boolean := true;
  v_sales_details jsonb;
  v_purchase_ok boolean := true;
  v_purchase_details jsonb;
  v_inventory_ok boolean := true;
  v_ap_ok boolean := true;
  v_payroll_ok boolean := true;
  v_sales_drafts int := 0;
  v_purchase_drafts int := 0;
  v_all_ok boolean;
  v_bank_table regclass;
begin
  perform public.erp_require_finance_reader();

  if p_period_month < 1 or p_period_month > 12 then
    raise exception 'period_month must be between 1 and 12';
  end if;

  v_start_year := 2000 + substring(p_fiscal_year from 3 for 2)::int;

  if p_period_month <= 9 then
    v_month := p_period_month + 3;
    v_year := v_start_year;
  else
    v_month := p_period_month - 9;
    v_year := v_start_year + 1;
  end if;

  v_start_date := make_date(v_year, v_month, 1);
  v_end_date := (date_trunc('month', v_start_date) + interval '1 month - 1 day')::date;

  v_bank_table := to_regclass('public.erp_bank_reconciliations');
  if v_bank_table is not null then
    v_bank_ok := false;
    v_bank_details := jsonb_build_object('message', 'Bank reconciliation close not implemented yet');
  end if;

  select count(*)
    into v_sales_drafts
    from public.erp_invoices i
    where i.company_id = p_company_id
      and i.status = 'draft'
      and i.invoice_date between v_start_date and v_end_date;

  if v_sales_drafts > 0 then
    v_sales_ok := false;
    v_sales_details := jsonb_build_object('draft_count', v_sales_drafts);
  else
    v_sales_details := jsonb_build_object('draft_count', 0);
  end if;

  select count(*)
    into v_purchase_drafts
    from public.erp_gst_purchase_invoices i
    where i.company_id = p_company_id
      and i.is_void = false
      and i.status in ('draft', 'approved')
      and i.invoice_date between v_start_date and v_end_date;

  if v_purchase_drafts > 0 then
    v_purchase_ok := false;
    v_purchase_details := jsonb_build_object('draft_count', v_purchase_drafts);
  else
    v_purchase_details := jsonb_build_object('draft_count', 0);
  end if;

  v_all_ok := v_bank_ok and v_sales_ok and v_purchase_ok and v_inventory_ok and v_ap_ok and v_payroll_ok;

  return jsonb_build_object(
    'bank_reco_done', jsonb_build_object('ok', v_bank_ok, 'details', v_bank_details),
    'gst_sales_posted', jsonb_build_object('ok', v_sales_ok, 'details', v_sales_details),
    'gst_purchase_posted', jsonb_build_object('ok', v_purchase_ok, 'details', v_purchase_details),
    'inventory_closed', jsonb_build_object('ok', v_inventory_ok, 'details', jsonb_build_object('not_applicable', true)),
    'ap_reviewed', jsonb_build_object('ok', v_ap_ok, 'details', jsonb_build_object('not_applicable', true)),
    'payroll_posted', jsonb_build_object('ok', v_payroll_ok, 'details', jsonb_build_object('not_applicable', true)),
    'all_ok', v_all_ok
  );
end;
$$;

create or replace function public.erp_fin_month_close_upsert(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_checks jsonb;
  v_all_ok boolean;
  v_status text;
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  v_checks := public.erp_fin_month_close_checks(p_company_id, p_fiscal_year, p_period_month);
  v_all_ok := coalesce((v_checks->>'all_ok')::boolean, false);
  v_status := case when v_all_ok then 'ready' else 'in_progress' end;

  insert into public.erp_fin_month_close (
    company_id,
    fiscal_year,
    period_month,
    status,
    notes,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    p_company_id,
    p_fiscal_year,
    p_period_month,
    v_status,
    p_notes,
    now(),
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, fiscal_year, period_month)
  do update set
    status = v_status,
    notes = coalesce(p_notes, public.erp_fin_month_close.notes),
    updated_at = now(),
    updated_by = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.erp_fin_month_close_finalize(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_checks jsonb;
  v_all_ok boolean;
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  v_checks := public.erp_fin_month_close_checks(p_company_id, p_fiscal_year, p_period_month);
  v_all_ok := coalesce((v_checks->>'all_ok')::boolean, false);

  if not v_all_ok then
    raise exception 'Month close checks failed: %', v_checks::text;
  end if;

  update public.erp_fin_month_close
     set status = 'closed',
         closed_at = now(),
         closed_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and period_month = p_period_month
  returning id into v_id;

  if v_id is null then
    raise exception 'Month close record not found';
  end if;

  perform public.erp_fin_period_lock(p_company_id, p_fiscal_year, p_period_month, 'Month close');

  return v_id;
end;
$$;

revoke all on function public.erp_fin_period_lock(uuid, text, int, text) from public;
revoke all on function public.erp_fin_period_unlock(uuid, text, int, text) from public;
revoke all on function public.erp_fin_period_locks_list(uuid, text) from public;
revoke all on function public.erp_fin_month_close_checks(uuid, text, int) from public;
revoke all on function public.erp_fin_month_close_upsert(uuid, text, int, text) from public;
revoke all on function public.erp_fin_month_close_finalize(uuid, text, int) from public;
revoke all on function public.erp_fin_period_is_locked(uuid, date) from public;
revoke all on function public.erp_require_fin_open_period(uuid, date) from public;
revoke all on function public.erp_fiscal_period_month(date) from public;

grant execute on function public.erp_fin_period_lock(uuid, text, int, text) to authenticated;
grant execute on function public.erp_fin_period_unlock(uuid, text, int, text) to authenticated;
grant execute on function public.erp_fin_period_locks_list(uuid, text) to authenticated;
grant execute on function public.erp_fin_month_close_checks(uuid, text, int) to authenticated;
grant execute on function public.erp_fin_month_close_upsert(uuid, text, int, text) to authenticated;
grant execute on function public.erp_fin_month_close_finalize(uuid, text, int) to authenticated;
grant execute on function public.erp_fin_period_is_locked(uuid, date) to authenticated;
grant execute on function public.erp_require_fin_open_period(uuid, date) to authenticated;
grant execute on function public.erp_fiscal_period_month(date) to authenticated;

-- Enforce open period on finance posting RPCs

create or replace function public.erp_ap_vendor_bill_post(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill record;
  v_preview jsonb;
  v_errors jsonb;
  v_totals jsonb;
  v_lines jsonb;
  v_journal_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_tds_section text;
  v_tds_rate numeric;
  v_tds_amount numeric;
  v_net_payable numeric;
  v_subtotal numeric;
  v_gst_total numeric;
  v_total numeric;
  v_posted_doc text;
begin
  perform public.erp_require_finance_writer();

  select i.*, j.doc_no as posted_doc
    into v_bill
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
     and j.company_id = i.company_id
    where i.company_id = v_company_id
      and i.id = p_bill_id
    for update;

  if v_bill.id is null then
    raise exception 'Vendor bill not found';
  end if;

  if v_bill.is_void then
    raise exception 'Vendor bill is void';
  end if;

  if v_bill.status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be posted';
  end if;

  if v_bill.finance_journal_id is not null then
    return jsonb_build_object(
      'journal_id', v_bill.finance_journal_id,
      'doc_no', v_bill.posted_doc
    );
  end if;

  perform public.erp_ap_vendor_bill_recalc(p_bill_id);

  v_preview := public.erp_ap_vendor_bill_post_preview(p_bill_id);
  v_errors := coalesce(v_preview->'errors', '[]'::jsonb);

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'Posting blocked: %', v_errors::text;
  end if;

  v_totals := v_preview->'totals';
  v_lines := v_preview->'journal_lines';

  v_subtotal := coalesce((v_totals->>'subtotal')::numeric, 0);
  v_gst_total := coalesce((v_totals->>'gst_total')::numeric, 0);
  v_total := coalesce((v_totals->>'total')::numeric, 0);
  v_tds_section := nullif(v_totals->>'tds_section', '');
  v_tds_rate := coalesce((v_totals->>'tds_rate')::numeric, 0);
  v_tds_amount := coalesce((v_totals->>'tds_amount')::numeric, 0);
  v_net_payable := coalesce((v_totals->>'net_payable')::numeric, 0);

  perform public.erp_require_fin_open_period(v_company_id, v_bill.invoice_date);

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
    v_bill.invoice_date,
    'posted',
    format('Vendor bill %s', v_bill.invoice_no),
    'vendor_bill',
    v_bill.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  for v_line in
    select * from jsonb_array_elements(v_lines)
  loop
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
      v_line_no,
      v_line->>'account_code',
      v_line->>'account_name',
      v_line->>'memo',
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0)
    );

    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_line_no := v_line_no + 1;
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Posting error: journal totals do not balance';
  end if;

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

  update public.erp_gst_purchase_invoices
  set finance_journal_id = v_journal_id,
      status = 'posted',
      subtotal = v_subtotal,
      gst_total = v_gst_total,
      total = v_total,
      tds_section = v_tds_section,
      tds_rate = v_tds_rate,
      tds_amount = v_tds_amount,
      net_payable = v_net_payable,
      updated_at = now(),
      updated_by = v_actor
  where id = v_bill.id
    and company_id = v_company_id;

  return jsonb_build_object(
    'journal_id', v_journal_id,
    'doc_no', v_doc_no
  );
end;
$$;

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
  v_advances_account record;
  v_payment_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_role_id uuid;
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
    for update of a;

  if v_advance.id is null then
    raise exception 'Vendor advance not found';
  end if;

  if v_advance.is_void or v_advance.status = 'void' then
    raise exception 'Vendor advance is void';
  end if;

  if v_advance.finance_journal_id is not null then
    raise exception 'Vendor advance already posted';
  end if;

  v_role_id := public.erp_fin_account_by_role('vendor_advance');
  select id, code, name into v_advances_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  v_role_id := public.erp_fin_account_by_role('bank_main');
  select id, code, name into v_payment_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_advances_account.id is null or v_payment_account.id is null then
    raise exception 'Advance posting accounts missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_advance.advance_date);

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
         status = 'posted',
         updated_at = now(),
         updated_by = v_actor
   where id = v_advance.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

create or replace function public.erp_ap_vendor_payment_approve(
  p_vendor_payment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_vendor_name text;
  v_payable_account record;
  v_bank_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_role_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select p.*, j.doc_no as posted_doc
    into v_payment
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.id = p_vendor_payment_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    raise exception 'Vendor payment is void';
  end if;

  if v_payment.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_payment.finance_journal_id, 'doc_no', v_payment.posted_doc);
  end if;

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payment.payment_instrument_id is not null then
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_payment.payment_instrument_id
        and a.company_id = v_company_id;
  else
    v_role_id := public.erp_fin_account_by_role('bank_main');
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_role_id;
  end if;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment posting accounts missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_payment.payment_date);

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
    v_payment.payment_date,
    'posted',
    format('Vendor payment %s', coalesce(v_payment.reference_no, v_vendor_name, v_payment.id::text)),
    'vendor_payment',
    v_payment.id,
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
    v_payable_account.code,
    v_payable_account.name,
    format('Vendor payment %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    v_payment.amount,
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
    v_bank_account.code,
    v_bank_account.name,
    'Vendor payment',
    0,
    v_payment.amount
  );

  v_total_debit := v_payment.amount;
  v_total_credit := v_payment.amount;

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

  update public.erp_ap_vendor_payments
     set finance_journal_id = v_journal_id,
         status = 'approved',
         updated_at = now(),
         updated_by = v_actor
   where id = v_payment.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

create or replace function public.erp_ap_vendor_payment_void(
  p_id uuid,
  p_void_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_vendor_name text;
  v_payable_account record;
  v_bank_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_role_id uuid;
  v_is_matched boolean;
  v_void_date date := current_date;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select p.*
    into v_payment
    from public.erp_ap_vendor_payments p
    where p.company_id = v_company_id
      and p.id = p_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    return jsonb_build_object('voided', true);
  end if;

  if v_payment.status <> 'approved' then
    raise exception 'Only approved payments can be voided';
  end if;

  select exists (
    select 1
    from public.erp_bank_transactions t
    where t.company_id = v_company_id
      and t.is_matched = true
      and t.matched_entity_type in ('vendor_payment', 'ap_vendor_payment')
      and t.matched_entity_id = p_id
  ) into v_is_matched;

  if v_is_matched then
    raise exception 'Payment is matched to a bank transaction. Unmatch first.';
  end if;

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payment.payment_instrument_id is not null then
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_payment.payment_instrument_id
        and a.company_id = v_company_id;
  else
    v_role_id := public.erp_fin_account_by_role('bank_main');
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_role_id;
  end if;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment reversal accounts missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_void_date);

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
    v_void_date,
    'posted',
    format('Vendor payment void %s', coalesce(v_payment.reference_no, v_vendor_name, v_payment.id::text)),
    'vendor_payment_void',
    v_payment.id,
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
    v_bank_account.code,
    v_bank_account.name,
    'Vendor payment reversal',
    v_payment.amount,
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
    v_payable_account.code,
    v_payable_account.name,
    format('Vendor payment reversal %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    0,
    v_payment.amount
  );

  update public.erp_fin_journals
  set total_debit = v_payment.amount,
      total_credit = v_payment.amount
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_ap_vendor_payments
     set status = 'void',
         is_void = true,
         voided_at = now(),
         voided_by = v_actor,
         void_reason = p_void_reason,
         updated_at = now(),
         updated_by = v_actor
   where id = v_payment.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no, 'voided', true);
end;
$$;

create or replace function public.erp_payroll_finance_post(
  p_run_id uuid,
  p_idempotency_key uuid default null,
  p_post_date date default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_run record;
  v_existing_doc_id uuid;
  v_total_net numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_config record;
  v_post_date date := coalesce(p_post_date, current_date);
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select r.id,
         r.year,
         r.month,
         r.status,
         r.finance_post_status,
         r.finance_journal_id
    into v_run
    from public.erp_payroll_runs r
    where r.id = p_run_id
      and r.company_id = v_company_id
    for update;

  if v_run.id is null then
    raise exception 'Payroll run not found';
  end if;

  if not public.erp_payroll_run_is_finalized(p_run_id) then
    raise exception 'Payroll run must be finalized before posting';
  end if;

  if p_idempotency_key is not null then
    select p.finance_doc_id
      into v_existing_doc_id
      from public.erp_payroll_finance_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_doc_id
    into v_existing_doc_id
    from public.erp_payroll_finance_posts p
    where p.company_id = v_company_id
      and p.payroll_run_id = p_run_id;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  if v_run.finance_post_status = 'posted' and v_run.finance_journal_id is not null then
    return v_run.finance_journal_id;
  end if;

  select
    salary_expense_account_code,
    salary_expense_account_name,
    payroll_payable_account_code,
    payroll_payable_account_name
    into v_config
  from public.erp_payroll_posting_config c
  where c.company_id = v_company_id;

  if v_config.salary_expense_account_name is null
    or v_config.payroll_payable_account_name is null then
    raise exception 'Payroll posting config missing (accounts not configured)';
  end if;

  select
    coalesce(sum(coalesce(pi.net_pay, pi.gross - pi.deductions, 0)), 0)
    into v_total_net
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_run_id;

  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    coalesce(p_notes, format('Payroll run %s-%s', v_run.year, lpad(v_run.month::text, 2, '0'))),
    'payroll_run',
    p_run_id,
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
    v_config.salary_expense_account_code,
    v_config.salary_expense_account_name,
    'Payroll salary expense',
    v_total_net,
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
    v_config.payroll_payable_account_code,
    v_config.payroll_payable_account_name,
    'Payroll payable',
    0,
    v_total_net
  );

  v_total_debit := v_total_net;
  v_total_credit := v_total_net;

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

  insert into public.erp_payroll_finance_posts (
    company_id,
    payroll_run_id,
    finance_doc_id,
    status,
    idempotency_key,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    p_run_id,
    v_journal_id,
    'posted',
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor
  );

  update public.erp_payroll_runs
  set finance_journal_id = v_journal_id,
      finance_post_status = 'posted',
      finance_posted_at = now(),
      finance_posted_by_user_id = v_actor
  where id = v_run.id
    and company_id = v_company_id;

  return v_journal_id;
end;
$$;

create or replace function public.erp_razorpay_settlement_post(
  p_razorpay_settlement_id text,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_settlement record;
  v_existing_doc_id uuid;
  v_config record;
  v_clearing record;
  v_bank record;
  v_fees record;
  v_gst record;
  v_bank_amount numeric(14,2) := 0;
  v_fee_amount numeric(14,2) := 0;
  v_tax_amount numeric(14,2) := 0;
  v_clearing_total numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_has_recon boolean := false;
  v_post_date date;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select *
    into v_settlement
    from public.erp_razorpay_settlements s
    where s.company_id = v_company_id
      and s.razorpay_settlement_id = p_razorpay_settlement_id
      and s.is_void = false
    for update;

  if v_settlement.id is null then
    raise exception 'Settlement not found';
  end if;

  if p_idempotency_key is not null then
    select p.finance_journal_id
      into v_existing_doc_id
      from public.erp_razorpay_settlement_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key
        and p.is_void = false;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_journal_id
    into v_existing_doc_id
    from public.erp_razorpay_settlement_posts p
    where p.company_id = v_company_id
      and p.razorpay_settlement_id = p_razorpay_settlement_id
      and p.is_void = false;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    razorpay_clearing_account_id,
    bank_account_id,
    gateway_fees_account_id,
    gst_input_on_fees_account_id
    into v_config
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id;

  if v_config.razorpay_clearing_account_id is null or v_config.bank_account_id is null then
    raise exception 'Settlement posting config missing';
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts
    where id = v_config.razorpay_clearing_account_id;

  select id, code, name into v_bank
    from public.erp_gl_accounts
    where id = v_config.bank_account_id;

  if v_clearing.id is null or v_bank.id is null then
    raise exception 'Settlement accounts missing';
  end if;

  v_bank_amount := coalesce(v_settlement.amount, 0);
  v_fee_amount := coalesce(v_settlement.fee, 0);
  v_tax_amount := coalesce(v_settlement.tax, 0);

  if v_fee_amount > 0 then
    select id, code, name into v_fees
      from public.erp_gl_accounts
      where id = v_config.gateway_fees_account_id;
  end if;

  if v_tax_amount > 0 then
    select id, code, name into v_gst
      from public.erp_gl_accounts
      where id = v_config.gst_input_on_fees_account_id;
  end if;

  if v_bank_amount <= 0 then
    raise exception 'Settlement amount missing';
  end if;

  if v_fee_amount > 0 and v_fees.id is null then
    raise exception 'Gateway fees account missing';
  end if;

  if v_tax_amount > 0 and v_gst.id is null then
    raise exception 'GST input on fees account missing';
  end if;

  v_clearing_total := round(v_bank_amount + v_fee_amount + v_tax_amount, 2);
  v_post_date := coalesce(v_settlement.settled_at::date, current_date);

  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    format('Razorpay settlement %s payout', v_settlement.razorpay_settlement_id),
    'razorpay_settlement',
    v_settlement.id,
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
    v_bank.code,
    v_bank.name,
    'Razorpay settlement (bank)',
    v_bank_amount,
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
    v_clearing.code,
    v_clearing.name,
    'Razorpay settlement (clearing)',
    0,
    v_clearing_total
  );

  if v_fee_amount > 0 then
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
      3,
      v_fees.code,
      v_fees.name,
      'Gateway fees',
      v_fee_amount,
      0
    );
  end if;

  if v_tax_amount > 0 then
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
      4,
      v_gst.code,
      v_gst.name,
      'GST on fees',
      v_tax_amount,
      0
    );
  end if;

  v_total_debit := round(v_bank_amount + v_fee_amount + v_tax_amount, 2);
  v_total_credit := v_clearing_total;

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

  insert into public.erp_razorpay_settlement_posts (
    company_id,
    razorpay_settlement_id,
    finance_journal_id,
    status,
    idempotency_key,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    v_settlement.razorpay_settlement_id,
    v_journal_id,
    'posted',
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor
  );

  update public.erp_razorpay_settlements
  set finance_journal_id = v_journal_id,
      status = 'posted',
      updated_at = now(),
      updated_by = v_actor
  where id = v_settlement.id
    and company_id = v_company_id;

  update public.erp_bank_transactions
  set is_reconciled = true,
      updated_at = now()
  where company_id = v_company_id
    and matched_entity_type = 'razorpay_settlement'
    and matched_entity_id = v_settlement.id;

  return v_journal_id;
end;
$$;

create or replace function public.erp_shopify_sales_finance_post(
  p_source_id uuid,
  p_idempotency_key uuid default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_order record;
  v_existing_doc_id uuid;
  v_config record;
  v_clearing record;
  v_sales record;
  v_gst record;
  v_gst_totals record;
  v_net_sales numeric(14,2) := 0;
  v_gst_amount numeric(14,2) := 0;
  v_gross_total numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_payment_gateways text[] := '{}'::text[];
  v_is_razorpay boolean := false;
  v_line_no int := 1;
  v_post_date date;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_source_id
      and o.company_id = v_company_id
    for update;

  if v_order.id is null then
    raise exception 'Source not found';
  end if;

  if v_order.is_cancelled or v_order.cancelled_at is not null then
    raise exception 'Order is cancelled';
  end if;

  if p_idempotency_key is not null then
    select p.finance_doc_id
      into v_existing_doc_id
      from public.erp_sales_finance_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_doc_id
    into v_existing_doc_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and (p.source_id = p_source_id or p.order_id = p_source_id);

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    clearing_account_id,
    sales_account_id,
    gst_account_id
    into v_config
  from public.erp_sales_posting_config c
  where c.company_id = v_company_id;

  if v_config.clearing_account_id is null or v_config.sales_account_id is null then
    raise exception 'Sales posting config missing';
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts
    where id = v_config.clearing_account_id;

  select id, code, name into v_sales
    from public.erp_gl_accounts
    where id = v_config.sales_account_id;

  if v_config.gst_account_id is not null then
    select id, code, name into v_gst
      from public.erp_gl_accounts
      where id = v_config.gst_account_id;
  end if;

  if v_clearing.id is null or v_sales.id is null then
    raise exception 'Sales posting accounts missing';
  end if;

  select
    coalesce(sum(coalesce(r.taxable_value, 0) + coalesce(r.shipping_taxable_value, 0)), 0) as net_sales,
    coalesce(sum(coalesce(r.total_tax, 0)), 0) as gst_total
    into v_gst_totals
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false;

  v_net_sales := round(coalesce(v_gst_totals.net_sales, 0), 2);
  v_gst_amount := round(coalesce(v_gst_totals.gst_total, 0), 2);

  if v_net_sales = 0 and v_gst_amount = 0 then
    v_net_sales := round(
      coalesce(v_order.subtotal_price, 0) - coalesce(v_order.total_discounts, 0) + coalesce(v_order.total_shipping, 0),
      2
    );
    v_gst_amount := round(coalesce(v_order.total_tax, 0), 2);
  end if;

  v_gross_total := round(v_net_sales + v_gst_amount, 2);

  if v_net_sales <= 0 or v_gross_total <= 0 then
    raise exception 'Invalid totals';
  end if;

  v_post_date := v_order.order_created_at::date;
  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    coalesce(p_notes, format('Shopify order %s', coalesce(v_order.shopify_order_number, v_order.shopify_order_id::text))),
    'shopify_order',
    v_order.id,
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
    v_line_no,
    v_clearing.code,
    v_clearing.name,
    'Shopify order clearing',
    v_gross_total,
    0
  );

  v_line_no := v_line_no + 1;

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
    v_line_no,
    v_sales.code,
    v_sales.name,
    'Shopify sales',
    0,
    v_net_sales
  );

  if v_gst_amount > 0 and v_gst.id is not null then
    v_line_no := v_line_no + 1;

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
      v_line_no,
      v_gst.code,
      v_gst.name,
      'GST output',
      0,
      v_gst_amount
    );
  end if;

  v_total_debit := v_gross_total;
  v_total_credit := v_net_sales + v_gst_amount;

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

  insert into public.erp_sales_finance_posts (
    company_id,
    source_type,
    source_id,
    order_id,
    finance_doc_id,
    status,
    idempotency_key,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    'shopify_order',
    v_order.id,
    v_order.id,
    v_journal_id,
    'posted',
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor
  ) returning finance_doc_id into v_journal_id;

  update public.erp_shopify_orders
  set finance_doc_id = v_journal_id,
      updated_at = now(),
      updated_by = v_actor
  where id = v_order.id
    and company_id = v_company_id;

  return v_journal_id;
end;
$$;

create or replace function public.erp_shopify_sales_finance_refund_post(
  p_order_id uuid,
  p_refund_source_id text,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_order record;
  v_existing_doc_id uuid;
  v_config record;
  v_clearing record;
  v_sales record;
  v_gst record;
  v_refund record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_line_no int := 1;
  v_sales_post uuid;
  v_gst_net_total numeric(14,2) := 0;
  v_gst_tax_total numeric(14,2) := 0;
  v_gst_refund_count int := 0;
  v_has_gst_refunds boolean := false;
  v_refund_count int := 0;
  v_total_raw_gross numeric(14,2) := 0;
  v_refund_share numeric(14,6) := 0;
  v_refund_net numeric(14,2) := 0;
  v_refund_gst numeric(14,2) := 0;
  v_refund_gross numeric(14,2) := 0;
  v_post_date date;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if p_refund_source_id is null or trim(p_refund_source_id) = '' then
    raise exception 'refund_source_id is required';
  end if;

  select *
    into v_order
    from public.erp_shopify_orders o
    where o.id = p_order_id
      and o.company_id = v_company_id
    for update;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  select p.finance_doc_id
    into v_sales_post
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and (p.source_id = v_order.id or p.order_id = v_order.id)
      and p.status = 'posted'
    limit 1;

  if v_sales_post is null then
    raise exception 'Original sales journal not posted';
  end if;

  if p_idempotency_key is not null then
    select p.finance_journal_id
      into v_existing_doc_id
      from public.erp_sales_refund_finance_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key
        and p.is_void = false;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_journal_id
    into v_existing_doc_id
    from public.erp_sales_refund_finance_posts p
    where p.company_id = v_company_id
      and p.order_id = v_order.id
      and p.refund_source_id = p_refund_source_id
      and p.is_void = false
    for update;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    clearing_account_id,
    sales_account_id,
    gst_account_id
    into v_config
  from public.erp_sales_posting_config c
  where c.company_id = v_company_id;

  if v_config.clearing_account_id is null or v_config.sales_account_id is null then
    raise exception 'Sales posting config missing';
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts
    where id = v_config.clearing_account_id;

  select id, code, name into v_sales
    from public.erp_gl_accounts
    where id = v_config.sales_account_id;

  if v_config.gst_account_id is not null then
    select id, code, name into v_gst
      from public.erp_gl_accounts
      where id = v_config.gst_account_id;
  end if;

  if v_clearing.id is null or v_sales.id is null then
    raise exception 'Sales posting accounts missing';
  end if;

  select *
    into v_refund
    from public.erp_shopify_order_refunds r
    where r.company_id = v_company_id
      and r.order_id = v_order.id
      and r.refund_source_id = p_refund_source_id
      and r.is_void = false;

  if v_refund.id is null then
    raise exception 'Refund not found';
  end if;

  select
    coalesce(sum(coalesce(r.taxable_value, 0) + coalesce(r.shipping_taxable_value, 0)), 0) as net_sales,
    coalesce(sum(coalesce(r.total_tax, 0)), 0) as gst_total,
    count(*) as refund_count
    into v_gst_net_total, v_gst_tax_total, v_gst_refund_count
  from public.erp_gst_sales_register r
  where r.company_id = v_company_id
    and r.source_order_id = v_order.id
    and r.is_void = false
    and r.source = 'shopify_refund';

  if v_gst_refund_count > 0 then
    v_has_gst_refunds := true;
  end if;

  select count(*)
    into v_refund_count
    from public.erp_shopify_order_refunds r
    where r.company_id = v_company_id
      and r.order_id = v_order.id
      and r.is_void = false;

  select coalesce(sum(coalesce(r.gross, 0)), 0)
    into v_total_raw_gross
    from public.erp_shopify_order_refunds r
    where r.company_id = v_company_id
      and r.order_id = v_order.id
      and r.is_void = false;

  if v_has_gst_refunds then
    if coalesce(v_total_raw_gross, 0) > 0 then
      v_refund_share := v_refund.gross / v_total_raw_gross;
    elsif coalesce(v_refund_count, 0) > 0 then
      v_refund_share := 1::numeric / v_refund_count;
    else
      v_refund_share := 0;
    end if;

    v_refund_net := round(v_gst_net_total * v_refund_share, 2);
    v_refund_gst := round(v_gst_tax_total * v_refund_share, 2);
    v_refund_gross := round(v_refund_net + v_refund_gst, 2);
  else
    v_refund_net := round(coalesce(v_refund.net, 0), 2);
    v_refund_gst := round(coalesce(v_refund.gst, 0), 2);
    v_refund_gross := round(coalesce(v_refund.gross, 0), 2);
  end if;

  if v_refund_gross <= 0 then
    raise exception 'Invalid refund totals';
  end if;

  v_post_date := coalesce(v_refund.refunded_at::date, v_order.order_created_at::date);
  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    format(
      'Shopify refund reversal for order %s (refund %s)',
      coalesce(v_order.shopify_order_number, v_order.shopify_order_id::text),
      p_refund_source_id
    ),
    'shopify_refund',
    v_order.id,
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
    v_line_no,
    v_sales.code,
    v_sales.name,
    'Shopify refund sales reversal',
    v_refund_net,
    0
  );

  v_line_no := v_line_no + 1;

  if v_refund_gst > 0 and v_gst.id is not null then
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
      v_line_no,
      v_gst.code,
      v_gst.name,
      'GST reversal',
      v_refund_gst,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

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
    v_line_no,
    v_clearing.code,
    v_clearing.name,
    'Shopify refund clearing',
    0,
    v_refund_gross
  );

  v_total_debit := round(v_refund_net + v_refund_gst, 2);
  v_total_credit := v_refund_gross;

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

  insert into public.erp_sales_refund_finance_posts (
    company_id,
    order_id,
    refund_source_id,
    finance_journal_id,
    status,
    idempotency_key,
    created_at,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    v_order.id,
    p_refund_source_id,
    v_journal_id,
    'posted',
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor
  );

  return v_journal_id;
end;
$$;

create or replace function public.erp_gst_purchase_invoice_post(
  p_invoice_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_inv record;
  v_journal_id uuid;
  v_doc_no text;
  v_inventory record;
  v_cgst_account record;
  v_sgst_account record;
  v_igst_account record;
  v_vendor_payable record;
  v_tds_payable record;
  v_subtotal numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_cess numeric := 0;
  v_gst_total numeric := 0;
  v_total numeric := 0;
  v_tds_rate numeric := 0;
  v_tds_amount numeric := 0;
  v_net_payable numeric := 0;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_igst_total numeric := 0;
  v_role_id uuid;
begin
  perform public.erp_require_finance_writer();

  select *
    into v_inv
    from public.erp_gst_purchase_invoices
    where company_id = v_company_id
      and id = p_invoice_id
    for update;

  if v_inv.id is null then
    raise exception 'GST purchase invoice not found';
  end if;

  if v_inv.is_void or v_inv.status = 'void' then
    raise exception 'Invoice is void';
  end if;

  if v_inv.finance_journal_id is not null or v_inv.status = 'posted' then
    if v_inv.finance_journal_id is not null then
      select j.doc_no
        into v_doc_no
        from public.erp_fin_journals j
        where j.id = v_inv.finance_journal_id
          and j.company_id = v_company_id;
    end if;

    return jsonb_build_object(
      'invoice_id', v_inv.id,
      'finance_journal_id', v_inv.finance_journal_id,
      'journal_doc_no', v_doc_no
    );
  end if;

  if v_inv.status <> 'draft' then
    raise exception 'Only draft invoices can be posted';
  end if;

  if v_inv.vendor_id is null then
    raise exception 'Vendor is required';
  end if;

  select
    coalesce(sum(l.taxable_value), 0) as subtotal,
    coalesce(sum(l.cgst), 0) as cgst,
    coalesce(sum(l.sgst), 0) as sgst,
    coalesce(sum(l.igst), 0) as igst,
    coalesce(sum(l.cess), 0) as cess
  into v_subtotal, v_cgst, v_sgst, v_igst, v_cess
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = v_inv.id
    and l.is_void = false;

  v_gst_total := v_cgst + v_sgst + v_igst + v_cess;
  v_total := round(v_subtotal + v_gst_total, 2);
  v_tds_rate := coalesce(v_inv.tds_rate, 0);
  v_tds_amount := coalesce(v_inv.tds_amount, 0);

  if v_tds_amount = 0 and v_tds_rate > 0 then
    v_tds_amount := round(v_subtotal * v_tds_rate / 100, 2);
  end if;

  v_net_payable := round(v_total - v_tds_amount, 2);

  v_role_id := public.erp_fin_account_by_role('inventory_asset');
  select id, code, name into v_inventory from public.erp_gl_accounts a where a.id = v_role_id;

  if v_cgst > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_cgst');
    select id, code, name into v_cgst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  if v_sgst > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_sgst');
    select id, code, name into v_sgst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  v_igst_total := v_igst + v_cess;
  if v_igst_total > 0 then
    v_role_id := public.erp_fin_account_by_role('input_gst_igst');
    select id, code, name into v_igst_account from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_vendor_payable from public.erp_gl_accounts a where a.id = v_role_id;

  if v_tds_amount > 0 then
    v_role_id := public.erp_fin_account_by_role('tds_payable');
    select id, code, name into v_tds_payable from public.erp_gl_accounts a where a.id = v_role_id;
  end if;

  if v_inventory.id is null or v_vendor_payable.id is null then
    raise exception 'Posting accounts missing';
  end if;

  if v_cgst > 0 and v_cgst_account.id is null then
    raise exception 'CGST account missing';
  end if;

  if v_sgst > 0 and v_sgst_account.id is null then
    raise exception 'SGST account missing';
  end if;

  if v_igst_total > 0 and v_igst_account.id is null then
    raise exception 'IGST account missing';
  end if;

  if v_tds_amount > 0 and v_tds_payable.id is null then
    raise exception 'TDS account missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_inv.invoice_date);

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
    v_inv.invoice_date,
    'posted',
    format('GST purchase invoice %s', v_inv.invoice_no),
    'gst_purchase_invoice',
    v_inv.id,
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
    v_line_no,
    v_inventory.code,
    v_inventory.name,
    'Inventory',
    v_subtotal,
    0
  );

  if v_cgst > 0 then
    v_line_no := v_line_no + 1;
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
      v_line_no,
      v_cgst_account.code,
      v_cgst_account.name,
      'Input CGST',
      v_cgst,
      0
    );
  end if;

  if v_sgst > 0 then
    v_line_no := v_line_no + 1;
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
      v_line_no,
      v_sgst_account.code,
      v_sgst_account.name,
      'Input SGST',
      v_sgst,
      0
    );
  end if;

  if v_igst_total > 0 then
    v_line_no := v_line_no + 1;
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
      v_line_no,
      v_igst_account.code,
      v_igst_account.name,
      'Input IGST',
      v_igst_total,
      0
    );
  end if;

  if v_tds_amount > 0 then
    v_line_no := v_line_no + 1;
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
      v_line_no,
      v_tds_payable.code,
      v_tds_payable.name,
      'TDS payable',
      0,
      v_tds_amount
    );
  end if;

  v_line_no := v_line_no + 1;
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
    v_line_no,
    v_vendor_payable.code,
    v_vendor_payable.name,
    'Vendor payable',
    0,
    v_net_payable
  );

  v_total_debit := round(v_subtotal + v_gst_total, 2);
  v_total_credit := round(v_net_payable + v_tds_amount, 2);

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

  update public.erp_gst_purchase_invoices
  set finance_journal_id = v_journal_id,
      status = 'posted',
      subtotal = v_subtotal,
      gst_total = v_gst_total,
      total = v_total,
      tds_amount = v_tds_amount,
      net_payable = v_net_payable,
      updated_at = now(),
      updated_by = v_actor
  where id = v_inv.id
    and company_id = v_company_id;

  return jsonb_build_object(
    'invoice_id', v_inv.id,
    'finance_journal_id', v_journal_id,
    'journal_doc_no', v_doc_no
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post(uuid) from public;
revoke all on function public.erp_ap_vendor_advance_approve_and_post(uuid) from public;
revoke all on function public.erp_ap_vendor_payment_approve(uuid) from public;
revoke all on function public.erp_ap_vendor_payment_void(uuid, text) from public;
revoke all on function public.erp_payroll_finance_post(uuid, uuid, date, text) from public;
revoke all on function public.erp_razorpay_settlement_post(text, uuid) from public;
revoke all on function public.erp_shopify_sales_finance_post(uuid, uuid, text) from public;
revoke all on function public.erp_shopify_sales_finance_refund_post(uuid, text, uuid) from public;
revoke all on function public.erp_gst_purchase_invoice_post(uuid) from public;

grant execute on function public.erp_ap_vendor_bill_post(uuid) to authenticated;
grant execute on function public.erp_ap_vendor_advance_approve_and_post(uuid) to authenticated;
grant execute on function public.erp_ap_vendor_payment_approve(uuid) to authenticated;
grant execute on function public.erp_ap_vendor_payment_void(uuid, text) to authenticated;
grant execute on function public.erp_payroll_finance_post(uuid, uuid, date, text) to authenticated;
grant execute on function public.erp_razorpay_settlement_post(text, uuid) to authenticated;
grant execute on function public.erp_shopify_sales_finance_post(uuid, uuid, text) to authenticated;
grant execute on function public.erp_shopify_sales_finance_refund_post(uuid, text, uuid) to authenticated;
grant execute on function public.erp_gst_purchase_invoice_post(uuid) to authenticated;
