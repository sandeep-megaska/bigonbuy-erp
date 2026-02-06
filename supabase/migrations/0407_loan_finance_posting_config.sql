begin;

create table if not exists public.erp_loan_finance_posting_config (
  company_id uuid primary key default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  loan_principal_account_id uuid not null,
  interest_expense_account_id uuid not null,
  bank_account_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

alter table public.erp_loan_finance_posting_config enable row level security;
alter table public.erp_loan_finance_posting_config force row level security;

do $$
begin
  drop policy if exists erp_loan_finance_posting_config_select on public.erp_loan_finance_posting_config;
  drop policy if exists erp_loan_finance_posting_config_write on public.erp_loan_finance_posting_config;

  create policy erp_loan_finance_posting_config_select
    on public.erp_loan_finance_posting_config
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

  create policy erp_loan_finance_posting_config_write
    on public.erp_loan_finance_posting_config
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
    with check (company_id = public.erp_current_company_id());
end
$$;

create or replace function public.erp_loan_finance_posting_config_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_config record;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_config
  from public.erp_loan_finance_posting_config c
  where c.company_id = v_company_id;

  return jsonb_build_object(
    'company_id', v_company_id,
    'loan_principal_account_id', v_config.loan_principal_account_id,
    'interest_expense_account_id', v_config.interest_expense_account_id,
    'bank_account_id', v_config.bank_account_id,
    'updated_at', v_config.updated_at,
    'updated_by', v_config.updated_by
  );
end;
$$;

revoke all on function public.erp_loan_finance_posting_config_get() from public;
grant execute on function public.erp_loan_finance_posting_config_get() to authenticated;

create or replace function public.erp_loan_finance_posting_config_upsert(
  p_loan_principal_account_id uuid,
  p_interest_expense_account_id uuid,
  p_bank_account_id uuid,
  p_updated_by uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_writer();

  insert into public.erp_loan_finance_posting_config (
    company_id,
    loan_principal_account_id,
    interest_expense_account_id,
    bank_account_id,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    p_loan_principal_account_id,
    p_interest_expense_account_id,
    p_bank_account_id,
    now(),
    coalesce(p_updated_by, auth.uid())
  )
  on conflict (company_id)
  do update set
    loan_principal_account_id = excluded.loan_principal_account_id,
    interest_expense_account_id = excluded.interest_expense_account_id,
    bank_account_id = excluded.bank_account_id,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.erp_loan_finance_posting_config_upsert(uuid, uuid, uuid, uuid) from public;
grant execute on function public.erp_loan_finance_posting_config_upsert(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.erp_loan_schedule_generate(
  p_loan_id uuid,
  p_start_date date,
  p_months integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_loan record;
  v_opening numeric(14,2);
  v_rate_monthly numeric := 0;
  v_emi numeric(14,2);
  v_interest numeric(14,2);
  v_principal numeric(14,2);
  v_closing numeric(14,2);
  v_due_date date;
  v_inserted_count integer := 0;
  i integer;
begin
  perform public.erp_require_finance_writer();

  if p_months is null or p_months <= 0 then
    raise exception 'p_months must be > 0';
  end if;

  select *
    into v_loan
  from public.erp_loans l
  where l.id = p_loan_id
    and l.company_id = v_company_id
    and l.is_void = false
  for update;

  if v_loan.id is null then
    raise exception 'Loan not found';
  end if;

  if v_loan.loan_type <> 'term_loan' then
    raise exception 'Schedule generation is only supported for term_loan';
  end if;

  v_opening := coalesce(nullif(v_loan.disbursed_amount, 0), v_loan.sanction_amount, 0);
  if v_opening <= 0 then
    raise exception 'Loan principal must be > 0';
  end if;

  v_rate_monthly := coalesce(v_loan.interest_rate_annual, 0) / 12 / 100;

  if coalesce(v_loan.emi_amount, 0) > 0 then
    v_emi := v_loan.emi_amount;
  elsif v_rate_monthly > 0 then
    v_emi := round((v_opening * v_rate_monthly * power(1 + v_rate_monthly, p_months)) / (power(1 + v_rate_monthly, p_months) - 1), 2);
  else
    v_emi := round(v_opening / p_months, 2);
  end if;

  for i in 1..p_months loop
    v_due_date := (p_start_date + ((i - 1) || ' months')::interval)::date;
    v_interest := round(v_opening * v_rate_monthly, 2);
    v_principal := round(v_emi - v_interest, 2);

    if i = p_months or v_principal > v_opening then
      v_principal := v_opening;
      v_interest := round(v_emi - v_principal, 2);
      if v_interest < 0 then
        v_interest := 0;
        v_emi := v_principal;
      end if;
    end if;

    v_closing := round(v_opening - v_principal, 2);

    insert into public.erp_loan_schedules (
      company_id,
      loan_id,
      due_date,
      opening_principal,
      emi_amount,
      principal_component,
      interest_component,
      closing_principal,
      status,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_loan.id,
      v_due_date,
      v_opening,
      round(v_principal + v_interest, 2),
      v_principal,
      v_interest,
      v_closing,
      'due',
      auth.uid(),
      auth.uid()
    )
    on conflict (company_id, loan_id, due_date) do nothing;

    if found then
      v_inserted_count := v_inserted_count + 1;
    end if;

    v_opening := v_closing;
    exit when v_opening <= 0;
  end loop;

  return v_inserted_count;
end;
$$;

revoke all on function public.erp_loan_schedule_generate(uuid, date, integer) from public;
grant execute on function public.erp_loan_schedule_generate(uuid, date, integer) to authenticated;

create or replace function public.erp_loan_schedule_posting_preview(
  p_schedule_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_schedule record;
  v_config record;
  v_principal_acc record;
  v_interest_acc record;
  v_bank_acc record;
  v_warnings text[] := '{}'::text[];
  v_can_post boolean := true;
  v_lines jsonb;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
begin
  perform public.erp_require_finance_reader();

  select s.*, l.lender_name, l.loan_ref
    into v_schedule
  from public.erp_loan_schedules s
  join public.erp_loans l
    on l.id = s.loan_id
   and l.company_id = s.company_id
  where s.id = p_schedule_id
    and s.company_id = v_company_id
    and s.is_void = false;

  if v_schedule.id is null then
    raise exception 'Loan schedule not found';
  end if;

  select *
    into v_config
  from public.erp_loan_finance_posting_config c
  where c.company_id = v_company_id;

  if v_config.company_id is null then
    v_warnings := array_append(v_warnings, 'Loan posting config missing.');
  end if;

  if round(v_schedule.emi_amount, 2) <> round(v_schedule.principal_component + v_schedule.interest_component, 2) then
    v_warnings := array_append(v_warnings, 'EMI split mismatch: principal + interest must equal EMI amount.');
  end if;

  select id, code, name into v_principal_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and a.id = v_config.loan_principal_account_id;

  select id, code, name into v_interest_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and a.id = v_config.interest_expense_account_id;

  select id, code, name into v_bank_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id and a.id = v_config.bank_account_id;

  if v_principal_acc.id is null then
    v_warnings := array_append(v_warnings, 'Loan principal account not found.');
  end if;
  if v_interest_acc.id is null then
    v_warnings := array_append(v_warnings, 'Interest expense account not found.');
  end if;
  if v_bank_acc.id is null then
    v_warnings := array_append(v_warnings, 'Bank account not found.');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_interest_acc.id,
      'account_code', v_interest_acc.code,
      'account_name', v_interest_acc.name,
      'debit', round(v_schedule.interest_component, 2),
      'credit', 0,
      'description', 'Loan interest expense'
    ),
    jsonb_build_object(
      'account_id', v_principal_acc.id,
      'account_code', v_principal_acc.code,
      'account_name', v_principal_acc.name,
      'debit', round(v_schedule.principal_component, 2),
      'credit', 0,
      'description', 'Loan principal repayment'
    ),
    jsonb_build_object(
      'account_id', v_bank_acc.id,
      'account_code', v_bank_acc.code,
      'account_name', v_bank_acc.name,
      'debit', 0,
      'credit', round(v_schedule.emi_amount, 2),
      'description', 'Bank payment for EMI'
    )
  );

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_total_debit, v_total_credit
  from jsonb_array_elements(v_lines) x;

  if round(v_total_debit,2) <> round(v_total_credit,2) then
    v_warnings := array_append(v_warnings, 'Preview lines are not balanced.');
  end if;

  v_can_post := array_length(v_warnings, 1) is null;

  return jsonb_build_object(
    'can_post', v_can_post,
    'warnings', to_jsonb(coalesce(v_warnings, '{}'::text[])),
    'schedule', jsonb_build_object(
      'id', v_schedule.id,
      'loan_id', v_schedule.loan_id,
      'lender_name', v_schedule.lender_name,
      'loan_ref', v_schedule.loan_ref,
      'due_date', v_schedule.due_date,
      'emi_amount', v_schedule.emi_amount,
      'principal_component', v_schedule.principal_component,
      'interest_component', v_schedule.interest_component
    ),
    'lines', v_lines,
    'totals', jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit)
  );
end;
$$;

revoke all on function public.erp_loan_schedule_posting_preview(uuid) from public;
grant execute on function public.erp_loan_schedule_posting_preview(uuid) to authenticated;

create or replace function public.erp_loan_schedule_post_to_finance(
  p_actor_user_id uuid,
  p_schedule_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_schedule record;
  v_existing record;
  v_preview jsonb;
  v_journal_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
begin
  perform public.erp_require_finance_writer();

  select s.*, l.lender_name, l.loan_ref
    into v_schedule
  from public.erp_loan_schedules s
  join public.erp_loans l
    on l.id = s.loan_id
   and l.company_id = s.company_id
  where s.id = p_schedule_id
    and s.company_id = v_company_id
    and s.is_void = false
    and s.status = 'due'
  for update;

  if v_schedule.id is null then
    raise exception 'Schedule not found or not postable';
  end if;

  select p.journal_id, j.doc_no
    into v_existing
  from public.erp_loan_finance_posts p
  left join public.erp_fin_journals j
    on j.id = p.journal_id
   and j.company_id = p.company_id
  where p.company_id = v_company_id
    and p.schedule_id = p_schedule_id;

  if v_existing.journal_id is not null then
    return jsonb_build_object(
      'schedule_id', p_schedule_id,
      'journal_id', v_existing.journal_id,
      'journal_no', v_existing.doc_no,
      'idempotent', true
    );
  end if;

  v_preview := public.erp_loan_schedule_posting_preview(p_schedule_id);
  if not coalesce((v_preview->>'can_post')::boolean, false)
     or jsonb_array_length(coalesce(v_preview->'warnings', '[]'::jsonb)) > 0 then
    raise exception 'Loan schedule preview has warnings; posting blocked';
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
    v_schedule.due_date,
    'posted',
    format('Loan EMI %s %s Due %s', coalesce(v_schedule.lender_name, ''), coalesce(v_schedule.loan_ref, ''), v_schedule.due_date),
    'loan_schedule',
    p_schedule_id,
    0,
    0,
    coalesce(p_actor_user_id, auth.uid())
  ) returning id into v_journal_id;

  for v_line in select * from jsonb_array_elements(v_preview->'lines') loop
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
      coalesce((v_line->>'line_no')::int, 1),
      nullif(v_line->>'account_code', ''),
      nullif(v_line->>'account_name', ''),
      nullif(v_line->>'description', ''),
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0)
    );
  end loop;

  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_total_debit, v_total_credit
  from public.erp_fin_journal_lines
  where company_id = v_company_id
    and journal_id = v_journal_id;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'Loan schedule journal is not balanced';
  end if;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where company_id = v_company_id
    and id = v_journal_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where company_id = v_company_id
    and id = v_journal_id;

  begin
    insert into public.erp_loan_finance_posts (
      company_id,
      schedule_id,
      journal_id,
      posted_at,
      posted_by_user_id
    ) values (
      v_company_id,
      p_schedule_id,
      v_journal_id,
      now(),
      coalesce(p_actor_user_id, auth.uid())
    );
  exception when unique_violation then
    select p.journal_id, j.doc_no
      into v_existing
    from public.erp_loan_finance_posts p
    left join public.erp_fin_journals j
      on j.id = p.journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.schedule_id = p_schedule_id;

    return jsonb_build_object(
      'schedule_id', p_schedule_id,
      'journal_id', v_existing.journal_id,
      'journal_no', v_existing.doc_no,
      'idempotent', true
    );
  end;

  return jsonb_build_object(
    'schedule_id', p_schedule_id,
    'journal_id', v_journal_id,
    'journal_no', v_doc_no,
    'idempotent', false
  );
end;
$$;

revoke all on function public.erp_loan_schedule_post_to_finance(uuid, uuid) from public;
grant execute on function public.erp_loan_schedule_post_to_finance(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
