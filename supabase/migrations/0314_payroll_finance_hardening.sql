-- Payroll finance hardening (journals balance, voiding, idempotency, locks)

alter table public.erp_fin_journals
  add column if not exists voided_at timestamptz null,
  add column if not exists void_reason text null;

alter table public.erp_fin_journals
  add constraint erp_fin_journals_balanced_check
  check (total_debit = total_credit);

alter table public.erp_payroll_runs
  add column if not exists posted_to_finance boolean not null default false;

alter table public.erp_payroll_finance_posts
  add column if not exists idempotency_key uuid null;

create unique index if not exists erp_payroll_finance_posts_company_idempotency_key
  on public.erp_payroll_finance_posts (company_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists public.erp_payroll_finance_post(uuid, date, text);

create or replace function public.erp_payroll_finance_post(
  p_run_id uuid,
  p_post_date date default null,
  p_notes text default null,
  p_idempotency_key uuid default null
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
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select r.id, r.year, r.month, r.status, r.posted_to_finance
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

  if v_run.posted_to_finance then
    select p.finance_doc_id
      into v_existing_doc_id
      from public.erp_payroll_finance_posts p
      where p.company_id = v_company_id
        and p.payroll_run_id = p_run_id;

    if v_existing_doc_id is null then
      raise exception 'Payroll run already marked as posted';
    end if;

    return v_existing_doc_id;
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
    v_total_net,
    v_total_net,
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
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_config.salary_expense_account_code,
      v_config.salary_expense_account_name,
      'Salary Expense',
      v_total_net,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_config.payroll_payable_account_code,
      v_config.payroll_payable_account_name,
      'Payroll Payable',
      0,
      v_total_net
    );

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_payroll_finance_posts (
    company_id,
    payroll_run_id,
    finance_doc_type,
    finance_doc_id,
    status,
    posted_at,
    posted_by_user_id,
    meta,
    idempotency_key
  ) values (
    v_company_id,
    p_run_id,
    'journal',
    v_journal_id,
    'posted',
    now(),
    v_actor,
    jsonb_build_object('journal_no', v_doc_no),
    p_idempotency_key
  );

  update public.erp_payroll_runs
  set posted_to_finance = true
  where id = p_run_id
    and company_id = v_company_id;

  return v_journal_id;
end;
$$;

revoke all on function public.erp_payroll_finance_post(uuid, date, text, uuid) from public;
grant execute on function public.erp_payroll_finance_post(uuid, date, text, uuid) to authenticated;

create or replace function public.erp_fin_journal_void(
  p_journal_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  update public.erp_fin_journals
  set status = 'void',
      voided_at = now(),
      void_reason = p_reason
  where id = p_journal_id
    and company_id = v_company_id;

  if not found then
    raise exception 'Journal not found';
  end if;

  update public.erp_payroll_finance_posts
  set status = 'void'
  where company_id = v_company_id
    and finance_doc_type = 'journal'
    and finance_doc_id = p_journal_id;
end;
$$;

revoke all on function public.erp_fin_journal_void(uuid, text) from public;
grant execute on function public.erp_fin_journal_void(uuid, text) to authenticated;
