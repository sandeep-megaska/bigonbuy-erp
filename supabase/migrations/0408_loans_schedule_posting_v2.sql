begin;

alter table public.erp_loan_schedules
  add column if not exists line_no integer,
  add column if not exists posted_journal_id uuid null references public.erp_fin_journals(id) on delete set null;

with ranked as (
  select id,
         row_number() over (partition by company_id, loan_id order by due_date, created_at, id) as rn
  from public.erp_loan_schedules
)
update public.erp_loan_schedules s
set line_no = ranked.rn
from ranked
where ranked.id = s.id
  and s.line_no is null;

alter table public.erp_loan_schedules
  alter column line_no set not null;

alter table public.erp_loan_schedules
  drop constraint if exists erp_loan_schedules_status_check;

alter table public.erp_loan_schedules
  add constraint erp_loan_schedules_status_check
  check (status in ('due', 'posted', 'paid', 'void', 'skipped'));

alter table public.erp_loan_schedules
  drop constraint if exists erp_loan_schedules_split_check;

alter table public.erp_loan_schedules
  add constraint erp_loan_schedules_non_negative_check
  check (
    coalesce(emi_amount, 0) >= 0
    and coalesce(principal_component, 0) >= 0
    and coalesce(interest_component, 0) >= 0
  );

alter table public.erp_loan_schedules
  drop constraint if exists erp_loan_schedules_company_loan_line_no_uniq;

alter table public.erp_loan_schedules
  add constraint erp_loan_schedules_company_loan_line_no_uniq unique (company_id, loan_id, line_no);

create index if not exists erp_loan_schedules_company_loan_idx
  on public.erp_loan_schedules (company_id, loan_id);

create index if not exists erp_loan_schedules_company_status_idx
  on public.erp_loan_schedules (company_id, status);

create or replace function public.erp_loan_schedules_list(
  p_loan_id uuid
) returns table (
  id uuid,
  line_no integer,
  due_date date,
  emi_amount numeric,
  principal_component numeric,
  interest_component numeric,
  status text,
  notes text,
  journal_id uuid,
  journal_no text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.line_no,
    s.due_date,
    s.emi_amount,
    s.principal_component,
    s.interest_component,
    s.status,
    s.notes,
    fp.journal_id,
    j.doc_no as journal_no,
    s.created_at,
    s.updated_at
  from public.erp_loan_schedules s
  left join public.erp_loan_finance_posts fp
    on fp.company_id = s.company_id
   and fp.schedule_id = s.id
  left join public.erp_fin_journals j
    on j.company_id = fp.company_id
   and j.id = fp.journal_id
  where s.company_id = public.erp_current_company_id()
    and s.loan_id = p_loan_id
    and s.is_void = false
  order by s.line_no asc;
$$;

revoke all on function public.erp_loan_schedules_list(uuid) from public;
grant execute on function public.erp_loan_schedules_list(uuid) to authenticated;

create or replace function public.erp_loan_schedule_generate_simple(
  p_loan_id uuid,
  p_start_date date,
  p_months integer,
  p_emi_amount numeric,
  p_principal_total numeric,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_loan record;
  v_existing integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_due_date date;
  v_day integer;
  v_month_start date;
  v_max_day integer;
  v_principal_each numeric(14,2);
  v_principal_remaining numeric(14,2);
  v_principal_line numeric(14,2);
  v_line_no integer;
  i integer;
begin
  perform public.erp_require_finance_writer();

  if p_start_date is null then
    raise exception 'p_start_date is required';
  end if;
  if p_months is null or p_months <= 0 then
    raise exception 'p_months must be > 0';
  end if;
  if coalesce(p_emi_amount, 0) < 0 then
    raise exception 'p_emi_amount cannot be negative';
  end if;
  if p_principal_total is not null and p_principal_total < 0 then
    raise exception 'p_principal_total cannot be negative';
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

  select count(*) into v_existing
  from public.erp_loan_schedules s
  where s.company_id = v_company_id
    and s.loan_id = p_loan_id
    and s.is_void = false;

  if v_existing > 0 then
    return jsonb_build_object('inserted_count', 0, 'skipped_count', p_months);
  end if;

  v_line_no := 0;
  v_day := least(extract(day from p_start_date)::int, 28);

  if p_principal_total is not null and p_months > 0 then
    v_principal_each := round(p_principal_total / p_months, 2);
    v_principal_remaining := round(p_principal_total, 2);
  end if;

  for i in 1..p_months loop
    v_month_start := (date_trunc('month', p_start_date)::date + ((i - 1) || ' month')::interval)::date;
    v_max_day := extract(day from (date_trunc('month', v_month_start)::date + interval '1 month - 1 day'))::int;
    v_due_date := v_month_start + ((least(v_day, v_max_day) - 1) || ' day')::interval;

    v_principal_line := 0;
    if p_principal_total is not null then
      if i = p_months then
        v_principal_line := greatest(v_principal_remaining, 0);
      else
        v_principal_line := least(v_principal_each, greatest(v_principal_remaining, 0));
      end if;
      v_principal_remaining := round(v_principal_remaining - v_principal_line, 2);
    end if;

    begin
      v_line_no := v_line_no + 1;
      insert into public.erp_loan_schedules (
        company_id,
        loan_id,
        line_no,
        due_date,
        emi_amount,
        principal_component,
        interest_component,
        status,
        created_by,
        updated_by
      ) values (
        v_company_id,
        p_loan_id,
        v_line_no,
        v_due_date,
        round(coalesce(p_emi_amount, 0), 2),
        round(coalesce(v_principal_line, 0), 2),
        0,
        'due',
        coalesce(p_actor_user_id, auth.uid()),
        coalesce(p_actor_user_id, auth.uid())
      );
      v_inserted := v_inserted + 1;
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('inserted_count', v_inserted, 'skipped_count', v_skipped);
end;
$$;

revoke all on function public.erp_loan_schedule_generate_simple(uuid, date, integer, numeric, numeric, uuid) from public;
grant execute on function public.erp_loan_schedule_generate_simple(uuid, date, integer, numeric, numeric, uuid) to authenticated;

create or replace function public.erp_loan_schedule_line_upsert(
  p_schedule_id uuid,
  p_due_date date,
  p_emi_amount numeric,
  p_principal_component numeric,
  p_interest_component numeric,
  p_notes text,
  p_actor_user_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_schedule record;
  v_delta numeric;
begin
  perform public.erp_require_finance_writer();

  select *
    into v_schedule
  from public.erp_loan_schedules s
  where s.id = p_schedule_id
    and s.company_id = v_company_id
    and s.is_void = false
  for update;

  if v_schedule.id is null then
    raise exception 'Loan schedule not found';
  end if;

  if coalesce(p_emi_amount, 0) < 0
     or coalesce(p_principal_component, 0) < 0
     or coalesce(p_interest_component, 0) < 0 then
    raise exception 'Amounts must be non-negative';
  end if;

  v_delta := abs(round(coalesce(p_principal_component, 0) + coalesce(p_interest_component, 0), 2) - round(coalesce(p_emi_amount, 0), 2));
  if v_delta > 0.01 then
    raise exception 'principal_component + interest_component must equal emi_amount (±0.01)';
  end if;

  update public.erp_loan_schedules s
  set due_date = coalesce(p_due_date, s.due_date),
      emi_amount = round(coalesce(p_emi_amount, 0), 2),
      principal_component = round(coalesce(p_principal_component, 0), 2),
      interest_component = round(coalesce(p_interest_component, 0), 2),
      notes = p_notes,
      updated_at = now(),
      updated_by = coalesce(p_actor_user_id, auth.uid())
  where s.company_id = v_company_id
    and s.id = p_schedule_id;
end;
$$;

revoke all on function public.erp_loan_schedule_line_upsert(uuid, date, numeric, numeric, numeric, text, uuid) from public;
grant execute on function public.erp_loan_schedule_line_upsert(uuid, date, numeric, numeric, numeric, text, uuid) to authenticated;

create or replace function public.erp_loan_schedule_preview_post_to_finance(
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
  v_lines jsonb := '[]'::jsonb;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_split_delta numeric;
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

  if v_schedule.status not in ('due', 'posted') then
    v_warnings := array_append(v_warnings, 'Only due/posted schedules are postable.');
  end if;

  if v_schedule.status = 'posted' then
    v_warnings := array_append(v_warnings, 'Schedule is already marked posted; post endpoint is idempotent.');
  end if;

  if round(coalesce(v_schedule.emi_amount, 0), 2) <= 0 then
    v_warnings := array_append(v_warnings, 'EMI amount must be greater than zero.');
  end if;

  v_split_delta := abs(round(coalesce(v_schedule.principal_component, 0) + coalesce(v_schedule.interest_component, 0), 2) - round(coalesce(v_schedule.emi_amount, 0), 2));

  if round(coalesce(v_schedule.principal_component, 0), 2) = 0
     and round(coalesce(v_schedule.interest_component, 0), 2) = 0
     and round(coalesce(v_schedule.emi_amount, 0), 2) > 0 then
    v_warnings := array_append(v_warnings, 'Split missing: principal and interest components are zero.');
  elsif v_split_delta > 0.01 then
    v_warnings := array_append(v_warnings, 'EMI split mismatch: principal + interest must equal EMI amount.');
  end if;

  select *
    into v_config
  from public.erp_loan_finance_posting_config c
  where c.company_id = v_company_id;

  if v_config.company_id is null then
    v_warnings := array_append(v_warnings, 'Loan posting config missing.');
  end if;

  select id, code, name into v_principal_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id
    and a.id = v_config.loan_principal_account_id;

  select id, code, name into v_interest_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id
    and a.id = v_config.interest_expense_account_id;

  select id, code, name into v_bank_acc
  from public.erp_gl_accounts a
  where a.company_id = v_company_id
    and a.id = v_config.bank_account_id;

  if v_principal_acc.id is null then
    v_warnings := array_append(v_warnings, 'Loan principal account not found.');
  end if;
  if v_interest_acc.id is null then
    v_warnings := array_append(v_warnings, 'Interest expense account not found.');
  end if;
  if v_bank_acc.id is null then
    v_warnings := array_append(v_warnings, 'Bank account not found.');
  end if;

  if round(coalesce(v_schedule.interest_component, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_interest_acc.id,
      'account_code', v_interest_acc.code,
      'account_name', v_interest_acc.name,
      'debit', round(v_schedule.interest_component, 2),
      'credit', 0,
      'description', 'Loan interest expense'
    ));
  end if;

  if round(coalesce(v_schedule.principal_component, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_principal_acc.id,
      'account_code', v_principal_acc.code,
      'account_name', v_principal_acc.name,
      'debit', round(v_schedule.principal_component, 2),
      'credit', 0,
      'description', 'Loan principal repayment'
    ));
  end if;

  if round(coalesce(v_schedule.emi_amount, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_bank_acc.id,
      'account_code', v_bank_acc.code,
      'account_name', v_bank_acc.name,
      'debit', 0,
      'credit', round(v_schedule.emi_amount, 2),
      'description', 'Bank payment for EMI'
    ));
  end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_total_debit, v_total_credit
  from jsonb_array_elements(v_lines) x;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    v_warnings := array_append(v_warnings, 'Preview lines are not balanced.');
  end if;

  v_can_post := coalesce(array_length(v_warnings, 1), 0) = 0;

  return jsonb_build_object(
    'can_post', v_can_post,
    'warnings', to_jsonb(coalesce(v_warnings, '{}'::text[])),
    'totals', jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit),
    'lines', v_lines
  );
end;
$$;

revoke all on function public.erp_loan_schedule_preview_post_to_finance(uuid) from public;
grant execute on function public.erp_loan_schedule_preview_post_to_finance(uuid) to authenticated;

create or replace function public.erp__loan_assert_period_open(
  p_company_id uuid,
  p_posting_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_fin_period_lock_assert(p_company_id, p_posting_date);
end;
$$;

revoke all on function public.erp__loan_assert_period_open(uuid, date) from public;
grant execute on function public.erp__loan_assert_period_open(uuid, date) to authenticated;

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
  v_journal_no text;
  v_line jsonb;
  v_line_no integer := 1;
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
    and s.status in ('due', 'posted')
  for update;

  if v_schedule.id is null then
    raise exception 'Schedule not found or not postable';
  end if;

  select p.journal_id, j.doc_no
    into v_existing
  from public.erp_loan_finance_posts p
  left join public.erp_fin_journals j
    on j.company_id = p.company_id
   and j.id = p.journal_id
  where p.company_id = v_company_id
    and p.schedule_id = p_schedule_id
  limit 1;

  if v_existing.journal_id is not null then
    return jsonb_build_object(
      'schedule_id', p_schedule_id,
      'journal_id', v_existing.journal_id,
      'journal_no', v_existing.doc_no,
      'idempotent', true
    );
  end if;

  perform public.erp__loan_assert_period_open(v_company_id, v_schedule.due_date);

  v_preview := public.erp_loan_schedule_preview_post_to_finance(p_schedule_id);
  if not coalesce((v_preview ->> 'can_post')::boolean, false)
     or jsonb_array_length(coalesce(v_preview -> 'warnings', '[]'::jsonb)) > 0 then
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
    format('Loan EMI - %s - %s - %s', coalesce(v_schedule.lender_name, '-'), coalesce(v_schedule.loan_ref, '-'), v_schedule.due_date),
    'loan_schedule',
    p_schedule_id,
    round(coalesce((v_preview -> 'totals' ->> 'debit')::numeric, 0), 2),
    round(coalesce((v_preview -> 'totals' ->> 'credit')::numeric, 0), 2),
    coalesce(p_actor_user_id, auth.uid())
  ) returning id into v_journal_id;

  for v_line in
    select value
    from jsonb_array_elements(coalesce(v_preview -> 'lines', '[]'::jsonb))
  loop
    if coalesce((v_line ->> 'debit')::numeric, 0) = 0 and coalesce((v_line ->> 'credit')::numeric, 0) = 0 then
      continue;
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
      nullif(v_line ->> 'account_code', ''),
      nullif(v_line ->> 'account_name', ''),
      coalesce(nullif(v_line ->> 'description', ''), 'Loan EMI'),
      round(coalesce((v_line ->> 'debit')::numeric, 0), 2),
      round(coalesce((v_line ->> 'credit')::numeric, 0), 2)
    );

    v_line_no := v_line_no + 1;
  end loop;

  v_journal_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_journal_no
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
  exception
    when unique_violation then
      select p.journal_id, j.doc_no
        into v_existing
      from public.erp_loan_finance_posts p
      left join public.erp_fin_journals j
        on j.company_id = p.company_id
       and j.id = p.journal_id
      where p.company_id = v_company_id
        and p.schedule_id = p_schedule_id
      limit 1;

      return jsonb_build_object(
        'schedule_id', p_schedule_id,
        'journal_id', v_existing.journal_id,
        'journal_no', v_existing.doc_no,
        'idempotent', true
      );
  end;

  update public.erp_loan_schedules s
  set status = 'posted',
      posted_journal_id = v_journal_id,
      updated_at = now(),
      updated_by = coalesce(p_actor_user_id, auth.uid())
  where s.company_id = v_company_id
    and s.id = p_schedule_id;

  return jsonb_build_object(
    'schedule_id', p_schedule_id,
    'journal_id', v_journal_id,
    'journal_no', v_journal_no,
    'idempotent', false
  );
end;
$$;

revoke all on function public.erp_loan_schedule_post_to_finance(uuid, uuid) from public;
grant execute on function public.erp_loan_schedule_post_to_finance(uuid, uuid) to authenticated;

-- Backward-compatible wrappers for existing callers.
create or replace function public.erp_loan_schedule_posting_preview(
  p_schedule_id uuid
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.erp_loan_schedule_preview_post_to_finance(p_schedule_id);
$$;

revoke all on function public.erp_loan_schedule_posting_preview(uuid) from public;
grant execute on function public.erp_loan_schedule_posting_preview(uuid) to authenticated;

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
  v_result jsonb;
begin
  v_result := public.erp_loan_schedule_generate_simple(
    p_loan_id,
    p_start_date,
    p_months,
    0,
    null,
    auth.uid()
  );

  return coalesce((v_result ->> 'inserted_count')::int, 0);
end;
$$;

revoke all on function public.erp_loan_schedule_generate(uuid, date, integer) from public;
grant execute on function public.erp_loan_schedule_generate(uuid, date, integer) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;

commit;
