begin;

create table if not exists public.erp_loan_payment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  loan_id uuid not null references public.erp_loans (id) on delete restrict,
  event_date date not null,
  amount numeric(14,2) not null,
  principal_amount numeric(14,2) null,
  interest_amount numeric(14,2) null,
  source_type text not null,
  source_id uuid not null,
  status text not null default 'draft',
  posted_journal_id uuid null references public.erp_fin_journals (id) on delete restrict,
  posted_at timestamptz null,
  posted_by_user_id uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_loan_payment_events_status_check check (status in ('draft', 'posted', 'void')),
  constraint erp_loan_payment_events_source_type_check check (source_type in ('bank_txn', 'escrow_txn', 'settlement_deduction'))
);

create unique index if not exists erp_loan_payment_events_company_source_uniq
  on public.erp_loan_payment_events (company_id, source_type, source_id);

create index if not exists erp_loan_payment_events_company_loan_date_idx
  on public.erp_loan_payment_events (company_id, loan_id, event_date desc);

create index if not exists erp_loan_payment_events_company_source_idx
  on public.erp_loan_payment_events (company_id, source_type, source_id);

create index if not exists erp_loan_payment_events_company_status_idx
  on public.erp_loan_payment_events (company_id, status);

alter table public.erp_loan_payment_events enable row level security;
alter table public.erp_loan_payment_events force row level security;

do $$
begin
  drop policy if exists erp_loan_payment_events_select on public.erp_loan_payment_events;
  drop policy if exists erp_loan_payment_events_write on public.erp_loan_payment_events;

  create policy erp_loan_payment_events_select
    on public.erp_loan_payment_events
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

  create policy erp_loan_payment_events_write
    on public.erp_loan_payment_events
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

create or replace function public.erp_loan_payment_event_preview_post_to_finance(
  p_payment_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event record;
  v_loan record;
  v_config record;
  v_principal_acc record;
  v_interest_acc record;
  v_bank_acc record;
  v_warnings text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_split_delta numeric := 0;
begin
  perform public.erp_require_finance_reader();

  select e.*
    into v_event
  from public.erp_loan_payment_events e
  where e.id = p_payment_event_id
    and e.company_id = v_company_id;

  if v_event.id is null then
    raise exception 'Loan payment event not found';
  end if;

  if v_event.is_void then
    v_warnings := array_append(v_warnings, 'Payment event is void.');
  end if;

  if v_event.status = 'posted' then
    v_warnings := array_append(v_warnings, 'Payment event already posted; post endpoint is idempotent.');
  end if;

  select l.*
    into v_loan
  from public.erp_loans l
  where l.id = v_event.loan_id
    and l.company_id = v_company_id
    and l.is_void = false;

  if v_loan.id is null then
    v_warnings := array_append(v_warnings, 'Loan not found or void.');
  end if;

  if v_event.principal_amount is null or v_event.interest_amount is null then
    v_warnings := array_append(v_warnings, 'Principal and interest split is required.');
  end if;

  v_split_delta := abs(
    round(coalesce(v_event.principal_amount, 0) + coalesce(v_event.interest_amount, 0), 2)
    - round(coalesce(v_event.amount, 0), 2)
  );

  if v_split_delta > 0.01 then
    v_warnings := array_append(v_warnings, 'Split mismatch: principal + interest must equal amount.');
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
    v_warnings := array_append(v_warnings, 'Repayment account not found.');
  end if;

  if round(coalesce(v_event.principal_amount, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'label', 'Principal',
      'account_id', v_principal_acc.id,
      'account_code', v_principal_acc.code,
      'account_name', v_principal_acc.name,
      'debit', round(v_event.principal_amount, 2),
      'credit', 0,
      'description', 'Loan principal repayment'
    ));
  end if;

  if round(coalesce(v_event.interest_amount, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'label', 'Interest',
      'account_id', v_interest_acc.id,
      'account_code', v_interest_acc.code,
      'account_name', v_interest_acc.name,
      'debit', round(v_event.interest_amount, 2),
      'credit', 0,
      'description', 'Loan interest expense'
    ));
  end if;

  if round(coalesce(v_event.amount, 0), 2) > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'label', 'Repayment',
      'account_id', v_bank_acc.id,
      'account_code', v_bank_acc.code,
      'account_name', v_bank_acc.name,
      'debit', 0,
      'credit', round(v_event.amount, 2),
      'description', 'Loan repayment outflow'
    ));
  end if;

  select coalesce(sum((x->>'debit')::numeric),0), coalesce(sum((x->>'credit')::numeric),0)
    into v_total_debit, v_total_credit
  from jsonb_array_elements(v_lines) x;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    v_warnings := array_append(v_warnings, 'Preview lines are not balanced.');
  end if;

  return jsonb_build_object(
    'can_post', coalesce(array_length(v_warnings, 1), 0) = 0,
    'warnings', to_jsonb(coalesce(v_warnings, '{}'::text[])),
    'lines', v_lines,
    'totals', jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit)
  );
end;
$$;

revoke all on function public.erp_loan_payment_event_preview_post_to_finance(uuid) from public;
grant execute on function public.erp_loan_payment_event_preview_post_to_finance(uuid) to authenticated;

create or replace function public.erp_loan_payment_event_post_to_finance(
  p_actor_user_id uuid,
  p_payment_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event record;
  v_loan record;
  v_preview jsonb;
  v_journal_id uuid;
  v_journal_no text;
  v_line jsonb;
  v_line_no integer := 1;
begin
  perform public.erp_require_finance_writer();

  select e.*
    into v_event
  from public.erp_loan_payment_events e
  where e.id = p_payment_event_id
    and e.company_id = v_company_id
  for update;

  if v_event.id is null then
    raise exception 'Loan payment event not found';
  end if;

  if v_event.is_void then
    raise exception 'Loan payment event is void';
  end if;

  if v_event.posted_journal_id is not null then
    select j.doc_no
      into v_journal_no
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.id = v_event.posted_journal_id;

    return jsonb_build_object(
      'payment_event_id', v_event.id,
      'journal_id', v_event.posted_journal_id,
      'journal_no', v_journal_no,
      'idempotent', true
    );
  end if;

  perform public.erp__loan_assert_period_open(v_company_id, v_event.event_date);

  v_preview := public.erp_loan_payment_event_preview_post_to_finance(p_payment_event_id);

  if not coalesce((v_preview ->> 'can_post')::boolean, false)
     or jsonb_array_length(coalesce(v_preview -> 'warnings', '[]'::jsonb)) > 0 then
    raise exception 'Loan payment event preview has warnings; posting blocked';
  end if;

  select l.*
    into v_loan
  from public.erp_loans l
  where l.id = v_event.loan_id
    and l.company_id = v_company_id;

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
    v_event.event_date,
    'posted',
    format('Loan repayment - %s - %s', coalesce(v_loan.loan_ref, v_loan.lender_name, v_event.loan_id::text), v_event.source_type),
    'loan_payment_event',
    v_event.id,
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
      coalesce(nullif(v_line ->> 'description', ''), nullif(v_line ->> 'label', ''), 'Loan repayment'),
      round(coalesce((v_line ->> 'debit')::numeric, 0), 2),
      round(coalesce((v_line ->> 'credit')::numeric, 0), 2)
    );

    v_line_no := v_line_no + 1;
  end loop;

  v_journal_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals j
  set doc_no = v_journal_no
  where j.company_id = v_company_id
    and j.id = v_journal_id;

  begin
    update public.erp_loan_payment_events e
    set posted_journal_id = v_journal_id,
        posted_at = now(),
        posted_by_user_id = coalesce(p_actor_user_id, auth.uid()),
        status = 'posted',
        updated_at = now(),
        updated_by = coalesce(p_actor_user_id, auth.uid())
    where e.company_id = v_company_id
      and e.id = v_event.id
      and e.posted_journal_id is null;

    if not found then
      select e.posted_journal_id, j.doc_no
        into v_journal_id, v_journal_no
      from public.erp_loan_payment_events e
      left join public.erp_fin_journals j
        on j.company_id = e.company_id
       and j.id = e.posted_journal_id
      where e.company_id = v_company_id
        and e.id = v_event.id;

      return jsonb_build_object(
        'payment_event_id', v_event.id,
        'journal_id', v_journal_id,
        'journal_no', v_journal_no,
        'idempotent', true
      );
    end if;
  exception
    when unique_violation then
      select e.posted_journal_id, j.doc_no
        into v_journal_id, v_journal_no
      from public.erp_loan_payment_events e
      left join public.erp_fin_journals j
        on j.company_id = e.company_id
       and j.id = e.posted_journal_id
      where e.company_id = v_company_id
        and e.id = v_event.id;

      return jsonb_build_object(
        'payment_event_id', v_event.id,
        'journal_id', v_journal_id,
        'journal_no', v_journal_no,
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'payment_event_id', v_event.id,
    'journal_id', v_journal_id,
    'journal_no', v_journal_no,
    'idempotent', false
  );
end;
$$;

revoke all on function public.erp_loan_payment_event_post_to_finance(uuid, uuid) from public;
grant execute on function public.erp_loan_payment_event_post_to_finance(uuid, uuid) to authenticated;

create or replace function public.erp_loan_repayment_suggest_from_bank(
  p_from date,
  p_to date,
  p_limit integer default 50,
  p_offset integer default 0
) returns setof jsonb
language sql
security definer
set search_path = public
as $$
  with loan_base as (
    select
      l.id,
      l.lender_name,
      coalesce(l.emi_amount, 0) as emi_amount,
      l.repayment_day
    from public.erp_loans l
    where l.company_id = public.erp_current_company_id()
      and l.is_void = false
      and l.status in ('active', 'closed')
  ),
  txns as (
    select
      t.id as bank_txn_id,
      t.txn_date,
      coalesce(nullif(btrim(t.description), ''), nullif(btrim(t.reference_no), ''), '(no description)') as description,
      coalesce(t.debit, 0) as debit,
      lower(coalesce(t.description, '') || ' ' || coalesce(t.reference_no, '')) as text_blob
    from public.erp_bank_transactions t
    where t.company_id = public.erp_current_company_id()
      and t.is_void = false
      and t.txn_date >= coalesce(p_from, current_date - interval '30 days')
      and t.txn_date <= coalesce(p_to, current_date)
      and coalesce(t.debit, 0) > 0
      and not exists (
        select 1
        from public.erp_bank_recon_links l
        where l.company_id = t.company_id
          and l.bank_txn_id = t.id
          and l.status = 'matched'
          and l.is_void = false
      )
  ),
  scored as (
    select
      tx.bank_txn_id,
      tx.txn_date,
      tx.description,
      tx.debit as amount,
      lb.id as loan_id,
      (
        case when tx.text_blob ~ '(emi|ecs|nach|ach|loan|auto[ -]?debit)' then 35 else 0 end
        + case when lb.lender_name is not null and lb.lender_name <> '' and tx.text_blob like '%' || lower(lb.lender_name) || '%' then 35 else 0 end
        + case when lb.emi_amount > 0 and abs(tx.debit - lb.emi_amount) <= 5 then 20
               when lb.emi_amount > 0 and abs(tx.debit - lb.emi_amount) <= 25 then 10
               else 0 end
        + case when lb.repayment_day between 1 and 28 and abs(extract(day from tx.txn_date)::int - lb.repayment_day) <= 2 then 10 else 0 end
      )::int as score,
      array_remove(array[
        case when tx.text_blob ~ '(emi|ecs|nach|ach|loan|auto[ -]?debit)' then 'keyword' end,
        case when lb.lender_name is not null and lb.lender_name <> '' and tx.text_blob like '%' || lower(lb.lender_name) || '%' then 'lender name' end,
        case when lb.emi_amount > 0 and abs(tx.debit - lb.emi_amount) <= 25 then 'amount proximity' end,
        case when lb.repayment_day between 1 and 28 and abs(extract(day from tx.txn_date)::int - lb.repayment_day) <= 2 then 'date window' end
      ], null) as reason_parts
    from txns tx
    left join loan_base lb on true
  ),
  ranked as (
    select
      s.*,
      row_number() over (partition by s.bank_txn_id order by s.score desc, s.loan_id nulls last) as rn
    from scored s
    where s.score > 0
  )
  select jsonb_build_object(
    'bank_txn_id', r.bank_txn_id,
    'txn_date', r.txn_date,
    'description', r.description,
    'amount', round(r.amount, 2),
    'loan_id', r.loan_id,
    'confidence', case when r.score >= 80 then 'high' when r.score >= 50 then 'medium' else 'low' end,
    'score', r.score,
    'reason', array_to_string(r.reason_parts, '+')
  )
  from ranked r
  where r.rn = 1
  order by r.score desc, r.txn_date desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.erp_loan_repayment_suggest_from_bank(date, date, integer, integer) from public;
grant execute on function public.erp_loan_repayment_suggest_from_bank(date, date, integer, integer) to authenticated;

create or replace function public.erp_loan_repayment_event_create_from_bank_txn(
  p_actor_user_id uuid,
  p_bank_txn_id uuid,
  p_loan_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := coalesce(p_actor_user_id, auth.uid());
  v_txn record;
  v_loan record;
  v_event_id uuid;
begin
  perform public.erp_require_finance_writer();

  select t.*
    into v_txn
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
  for update;

  if v_txn.id is null then
    raise exception 'Bank transaction not found';
  end if;

  select l.*
    into v_loan
  from public.erp_loans l
  where l.id = p_loan_id
    and l.company_id = v_company_id
    and l.is_void = false;

  if v_loan.id is null then
    raise exception 'Loan not found';
  end if;

  if coalesce(v_txn.debit, 0) <= 0 and coalesce(v_txn.credit, 0) <= 0 then
    raise exception 'Bank transaction amount is zero';
  end if;

  begin
    insert into public.erp_loan_payment_events (
      company_id,
      loan_id,
      event_date,
      amount,
      principal_amount,
      interest_amount,
      source_type,
      source_id,
      status,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_loan.id,
      v_txn.txn_date,
      round(coalesce(nullif(v_txn.debit, 0), v_txn.credit), 2),
      null,
      null,
      'bank_txn',
      v_txn.id,
      'draft',
      v_actor,
      v_actor
    )
    returning id into v_event_id;
  exception
    when unique_violation then
      select e.id
        into v_event_id
      from public.erp_loan_payment_events e
      where e.company_id = v_company_id
        and e.source_type = 'bank_txn'
        and e.source_id = v_txn.id
      limit 1;
  end;

  if v_event_id is null then
    raise exception 'Failed to create or locate loan payment event';
  end if;

  insert into public.erp_bank_recon_links (
    company_id,
    bank_txn_id,
    entity_type,
    entity_id,
    confidence,
    match_confidence,
    status,
    matched_at,
    matched_by_user_id,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_txn.id,
    'loan_payment_event',
    v_event_id,
    'manual',
    'manual',
    'matched',
    now(),
    v_actor,
    v_actor,
    v_actor
  )
  on conflict (company_id, bank_txn_id)
  where status = 'matched' and is_void = false
  do update
    set entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        confidence = excluded.confidence,
        match_confidence = excluded.match_confidence,
        status = 'matched',
        matched_at = now(),
        matched_by_user_id = excluded.matched_by_user_id,
        is_void = false,
        updated_at = now(),
        updated_by = excluded.updated_by;

  update public.erp_bank_transactions t
  set is_matched = true,
      matched_entity_type = 'loan_payment_event',
      matched_entity_id = v_event_id,
      match_confidence = 'manual',
      match_notes = coalesce(t.match_notes, 'loan repayment event'),
      updated_at = now(),
      updated_by = coalesce(v_actor, updated_by)
  where t.company_id = v_company_id
    and t.id = v_txn.id
    and t.is_void = false;

  return jsonb_build_object(
    'payment_event_id', v_event_id,
    'bank_txn_id', v_txn.id,
    'loan_id', v_loan.id
  );
end;
$$;

revoke all on function public.erp_loan_repayment_event_create_from_bank_txn(uuid, uuid, uuid) from public;
grant execute on function public.erp_loan_repayment_event_create_from_bank_txn(uuid, uuid, uuid) to authenticated;

create or replace function public.erp_bank_recon_match(
  p_bank_txn_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_confidence text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_txn record;
  v_link record;
  v_link_id uuid;
  v_confidence text := coalesce(nullif(btrim(p_confidence), ''), 'manual');
  v_notes text := nullif(btrim(p_notes), '');
  v_entity_type text := lower(btrim(p_entity_type));
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_actor is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if v_entity_type is null or v_entity_type = '' then
    raise exception 'entity_type is required';
  end if;

  if p_entity_id is null then
    raise exception 'entity_id is required';
  end if;

  select t.id, t.is_void, t.is_matched, t.matched_entity_type, t.matched_entity_id
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
  for update
  into v_txn;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  if v_txn.is_void then
    raise exception 'Bank transaction is void';
  end if;

  if v_txn.is_matched then
    if v_txn.matched_entity_type = v_entity_type and v_txn.matched_entity_id = p_entity_id then
      select l.id into v_link_id
      from public.erp_bank_recon_links l
      where l.company_id = v_company_id
        and l.bank_txn_id = v_txn.id
        and l.status = 'matched'
        and l.is_void = false
      order by l.matched_at desc
      limit 1;

      return jsonb_build_object('ok', true, 'bank_txn_id', v_txn.id, 'entity_type', v_entity_type, 'entity_id', p_entity_id, 'link_id', v_link_id);
    end if;

    raise exception 'Bank transaction already matched to another entity';
  end if;

  if v_entity_type = 'razorpay_settlement' then
    perform 1 from public.erp_razorpay_settlements s
    where s.id = p_entity_id and s.company_id = v_company_id and s.is_void = false;
    if not found then
      raise exception 'Razorpay settlement not found';
    end if;
  elsif v_entity_type = 'payout_placeholder' then
    perform 1 from public.erp_payout_placeholders p
    where p.id = p_entity_id and p.company_id = v_company_id and p.bank_txn_id = p_bank_txn_id;
    if not found then
      raise exception 'Payout placeholder not found for bank transaction';
    end if;
  elsif v_entity_type = 'loan_payment_event' then
    perform 1 from public.erp_loan_payment_events e
    where e.id = p_entity_id and e.company_id = v_company_id and e.is_void = false;
    if not found then
      raise exception 'Loan payment event not found';
    end if;
  else
    raise exception 'Unsupported entity type';
  end if;

  select l.id, l.bank_txn_id into v_link
  from public.erp_bank_recon_links l
  where l.company_id = v_company_id
    and l.entity_type = v_entity_type
    and l.entity_id = p_entity_id
    and l.status = 'matched'
    and l.is_void = false
  limit 1
  for update;

  if v_link.id is not null then
    if v_link.bank_txn_id = p_bank_txn_id then
      v_link_id := v_link.id;
      update public.erp_bank_transactions t
      set is_matched = true,
          matched_entity_type = v_entity_type,
          matched_entity_id = p_entity_id,
          match_confidence = v_confidence,
          match_notes = v_notes,
          updated_at = now(),
          updated_by = coalesce(v_actor, updated_by)
      where t.id = p_bank_txn_id
        and t.company_id = v_company_id
        and t.is_void = false;

      return jsonb_build_object('ok', true, 'bank_txn_id', p_bank_txn_id, 'entity_type', v_entity_type, 'entity_id', p_entity_id, 'link_id', v_link_id);
    end if;

    raise exception 'Entity already matched to another bank transaction';
  end if;

  insert into public.erp_bank_recon_links (
    company_id, bank_txn_id, entity_type, entity_id,
    confidence, notes, match_confidence, match_notes,
    status, matched_by_user_id, created_by, updated_by
  ) values (
    v_company_id, p_bank_txn_id, v_entity_type, p_entity_id,
    v_confidence, v_notes, v_confidence, v_notes,
    'matched', v_actor, v_actor, v_actor
  )
  returning id into v_link_id;

  update public.erp_bank_transactions t
  set is_matched = true,
      matched_entity_type = v_entity_type,
      matched_entity_id = p_entity_id,
      match_confidence = v_confidence,
      match_notes = v_notes,
      updated_at = now(),
      updated_by = coalesce(v_actor, updated_by)
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false;

  return jsonb_build_object('ok', true, 'bank_txn_id', p_bank_txn_id, 'entity_type', v_entity_type, 'entity_id', p_entity_id, 'link_id', v_link_id);
end;
$$;

revoke all on function public.erp_bank_recon_match(uuid, text, uuid, text, text) from public;
grant execute on function public.erp_bank_recon_match(uuid, text, uuid, text, text) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end $$;

commit;
