-- Payroll finance posting hardening v2 (locks, idempotency, void metadata, journals RPCs)

alter table public.erp_payroll_finance_posts
  add column if not exists idempotency_key uuid null;

create unique index if not exists erp_payroll_finance_posts_company_idempotency_key
  on public.erp_payroll_finance_posts (company_id, idempotency_key)
  where idempotency_key is not null;

alter table public.erp_fin_journals
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by_user_id uuid null,
  add column if not exists void_reason text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_fin_journals_totals_match'
      and conrelid = 'public.erp_fin_journals'::regclass
  ) then
    alter table public.erp_fin_journals
      add constraint erp_fin_journals_totals_match
      check (total_debit = total_credit);
  end if;
end;
$$;

alter table public.erp_payroll_runs
  add column if not exists finance_journal_id uuid null,
  add column if not exists finance_posted_at timestamptz null,
  add column if not exists finance_posted_by_user_id uuid null,
  add column if not exists finance_post_status text not null default 'unposted';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_payroll_runs_finance_post_status_check'
      and conrelid = 'public.erp_payroll_runs'::regclass
  ) then
    alter table public.erp_payroll_runs
      add constraint erp_payroll_runs_finance_post_status_check
      check (finance_post_status in ('unposted', 'posted', 'voided'));
  end if;
end;
$$;

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

  select
    coalesce(sum(l.debit), 0),
    coalesce(sum(l.credit), 0)
    into v_total_debit, v_total_credit
  from public.erp_fin_journal_lines l
  where l.company_id = v_company_id
    and l.journal_id = v_journal_id;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must be balanced';
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
  set posted_to_finance = true,
      finance_journal_id = v_journal_id,
      finance_posted_at = now(),
      finance_posted_by_user_id = v_actor,
      finance_post_status = 'posted'
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
) returns public.erp_fin_journals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_status text;
  v_reference_type text;
  v_reference_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Void reason is required';
  end if;

  select j.status, j.reference_type, j.reference_id
    into v_status, v_reference_type, v_reference_id
    from public.erp_fin_journals j
    where j.id = p_journal_id
      and j.company_id = v_company_id
    for update;

  if not found then
    raise exception 'Journal not found';
  end if;

  if v_status <> 'posted' then
    raise exception 'Only posted journals can be voided';
  end if;

  update public.erp_fin_journals
  set status = 'void',
      voided_at = now(),
      voided_by_user_id = v_actor,
      void_reason = p_reason
  where id = p_journal_id
    and company_id = v_company_id;

  update public.erp_payroll_finance_posts
  set status = 'void'
  where company_id = v_company_id
    and finance_doc_type = 'journal'
    and finance_doc_id = p_journal_id;

  if v_reference_type = 'payroll_run' and v_reference_id is not null then
    update public.erp_payroll_runs
    set finance_post_status = 'voided'
    where id = v_reference_id
      and company_id = v_company_id;
  end if;

  return (
    select j
    from public.erp_fin_journals j
    where j.id = p_journal_id
      and j.company_id = v_company_id
  );
end;
$$;

revoke all on function public.erp_fin_journal_void(uuid, text) from public;
grant execute on function public.erp_fin_journal_void(uuid, text) to authenticated;

create or replace function public.erp_fin_journals_list(
  p_from date,
  p_to date,
  p_status text default null,
  p_search text default null
) returns table(
  id uuid,
  doc_no text,
  journal_date date,
  status text,
  reference_type text,
  reference_id uuid,
  total_debit numeric(14,2),
  total_credit numeric(14,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_reader();
  end if;

  return query
  select
    j.id,
    j.doc_no,
    j.journal_date,
    j.status,
    j.reference_type,
    j.reference_id,
    j.total_debit,
    j.total_credit
  from public.erp_fin_journals j
  where j.company_id = public.erp_current_company_id()
    and (p_from is null or j.journal_date >= p_from)
    and (p_to is null or j.journal_date <= p_to)
    and (p_status is null or p_status = '' or p_status = 'all' or j.status = p_status)
    and (
      p_search is null
      or p_search = ''
      or j.doc_no ilike ('%' || p_search || '%')
      or j.reference_id::text ilike ('%' || p_search || '%')
      or j.reference_type ilike ('%' || p_search || '%')
    )
  order by j.journal_date desc, j.doc_no desc;
end;
$$;

revoke all on function public.erp_fin_journals_list(date, date, text, text) from public;
grant execute on function public.erp_fin_journals_list(date, date, text, text) to authenticated;

create or replace function public.erp_fin_journal_get(
  p_journal_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_header jsonb;
  v_lines jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_reader();
  end if;

  select to_jsonb(j)
    into v_header
    from (
      select
        j.id,
        j.doc_no,
        j.journal_date,
        j.status,
        j.narration,
        j.reference_type,
        j.reference_id,
        j.total_debit,
        j.total_credit,
        j.created_at,
        j.created_by,
        j.voided_at,
        j.voided_by_user_id,
        j.void_reason
      from public.erp_fin_journals j
      where j.id = p_journal_id
        and j.company_id = public.erp_current_company_id()
    ) j;

  if v_header is null then
    raise exception 'Journal not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb)
    into v_lines
    from (
      select
        l.id,
        l.line_no,
        l.account_code,
        l.account_name,
        l.description,
        l.debit,
        l.credit
      from public.erp_fin_journal_lines l
      where l.journal_id = p_journal_id
        and l.company_id = public.erp_current_company_id()
      order by l.line_no
    ) l;

  return jsonb_build_object(
    'header', v_header,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.erp_fin_journal_get(uuid) from public;
grant execute on function public.erp_fin_journal_get(uuid) to authenticated;
