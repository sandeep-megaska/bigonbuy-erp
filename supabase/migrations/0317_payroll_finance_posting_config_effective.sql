-- Payroll finance posting config alignment (Phase 1)

create or replace function public.erp_payroll_finance_posting_config_effective()
returns table(
  salary_expense_account_id uuid,
  payroll_payable_account_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    c.salary_expense_account_id,
    c.payroll_payable_account_id
  from public.erp_payroll_finance_posting_config c
  where c.company_id = public.erp_current_company_id();
end;
$$;

revoke all on function public.erp_payroll_finance_posting_config_effective() from public;
grant execute on function public.erp_payroll_finance_posting_config_effective() to authenticated;

create or replace function public.erp_payroll_finance_posting_preview(
  p_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_run record;
  v_is_finalized boolean := false;
  v_total_net numeric(14,2) := 0;
  v_total_earnings numeric(14,2) := 0;
  v_total_deductions numeric(14,2) := 0;
  v_config record;
  v_errors text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_can_post boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_reader();
  end if;

  select r.id, r.year, r.month, r.status, r.finalized_at
    into v_run
    from public.erp_payroll_runs r
    where r.id = p_run_id
      and r.company_id = v_company_id;

  if v_run.id is null then
    raise exception 'Payroll run not found';
  end if;

  v_is_finalized := public.erp_payroll_run_is_finalized(p_run_id);

  if not v_is_finalized then
    v_errors := array_append(v_errors, 'Payroll run must be finalized before posting.');
  end if;

  select
    coalesce(sum(coalesce(pi.net_pay, pi.gross - pi.deductions, 0)), 0),
    coalesce(sum(coalesce(pi.gross, 0)), 0),
    coalesce(sum(coalesce(pi.deductions, 0)), 0)
    into v_total_net, v_total_earnings, v_total_deductions
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_run_id;

  select
    salary_expense_account_id,
    payroll_payable_account_id
    into v_config
  from public.erp_payroll_finance_posting_config_effective();

  if v_config.salary_expense_account_id is null then
    v_errors := array_append(v_errors, 'Salary expense account is not configured.');
  end if;

  if v_config.payroll_payable_account_id is null then
    v_errors := array_append(v_errors, 'Payroll payable account is not configured.');
  end if;

  if v_total_net <= 0 then
    v_errors := array_append(v_errors, 'Net pay total is zero; nothing to post.');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'side', 'debit',
      'account_id', v_config.salary_expense_account_id,
      'account_name', null,
      'amount', v_total_net,
      'memo', 'Salary expense'
    ),
    jsonb_build_object(
      'side', 'credit',
      'account_id', v_config.payroll_payable_account_id,
      'account_name', null,
      'amount', v_total_net,
      'memo', 'Payroll payable'
    )
  );

  v_can_post := v_is_finalized
    and v_config.salary_expense_account_id is not null
    and v_config.payroll_payable_account_id is not null
    and v_total_net > 0;

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'year', v_run.year,
      'month', v_run.month,
      'status', v_run.status,
      'finalized_at', v_run.finalized_at
    ),
    'totals', jsonb_build_object(
      'net_pay', v_total_net,
      'earnings', v_total_earnings,
      'deductions', v_total_deductions
    ),
    'lines', v_lines,
    'errors', coalesce(to_jsonb(v_errors), '[]'::jsonb),
    'can_post', v_can_post
  );
end;
$$;

revoke all on function public.erp_payroll_finance_posting_preview(uuid) from public;
grant execute on function public.erp_payroll_finance_posting_preview(uuid) to authenticated;

create or replace function public.erp_payroll_finance_post_v2(
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
  v_salary_account_code text;
  v_salary_account_name text;
  v_payable_account_code text;
  v_payable_account_name text;
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
    salary_expense_account_id,
    payroll_payable_account_id
    into v_config
  from public.erp_payroll_finance_posting_config_effective();

  if v_config.salary_expense_account_id is null
    or v_config.payroll_payable_account_id is null then
    raise exception 'Payroll posting config missing (accounts not configured)';
  end if;

  select
    a.code,
    a.name
    into v_salary_account_code,
         v_salary_account_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id
    and a.id = v_config.salary_expense_account_id;

  select
    a.code,
    a.name
    into v_payable_account_code,
         v_payable_account_name
  from public.erp_gl_accounts a
  where a.company_id = v_company_id
    and a.id = v_config.payroll_payable_account_id;

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
      v_salary_account_code,
      v_salary_account_name,
      'Salary Expense',
      v_total_net,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_payable_account_code,
      v_payable_account_name,
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

revoke all on function public.erp_payroll_finance_post_v2(uuid, date, text, uuid) from public;
grant execute on function public.erp_payroll_finance_post_v2(uuid, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
