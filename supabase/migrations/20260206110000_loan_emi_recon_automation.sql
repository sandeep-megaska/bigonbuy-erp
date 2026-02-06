begin;

alter table public.erp_loan_payment_events
  add column if not exists expected_due_date date null,
  add column if not exists direction text not null default 'debit',
  add column if not exists match_score int null,
  add column if not exists matched_bank_transaction_id uuid null,
  add column if not exists source text not null default 'bank_autodetect',
  add column if not exists notes text null,
  add column if not exists raw jsonb null;

alter table public.erp_loan_payment_events
  alter column amount type numeric(12,2) using round(coalesce(amount, 0), 2);

alter table public.erp_loan_payment_events
  drop constraint if exists erp_loan_payment_events_status_check;

alter table public.erp_loan_payment_events
  add constraint erp_loan_payment_events_status_check
  check (status in ('unmatched', 'suggested', 'matched', 'posted', 'void', 'draft'));

alter table public.erp_loan_payment_events
  drop constraint if exists erp_loan_payment_events_direction_check;

alter table public.erp_loan_payment_events
  add constraint erp_loan_payment_events_direction_check
  check (direction in ('debit', 'credit'));

alter table public.erp_loan_payment_events
  drop constraint if exists erp_loan_payment_events_source_check;

alter table public.erp_loan_payment_events
  add constraint erp_loan_payment_events_source_check
  check (source in ('bank_autodetect', 'manual', 'import'));

create index if not exists erp_loan_payment_events_company_status_v2_idx
  on public.erp_loan_payment_events (company_id, status);

create index if not exists erp_loan_payment_events_company_loan_event_idx
  on public.erp_loan_payment_events (company_id, loan_id, event_date);

create index if not exists erp_loan_payment_events_company_amount_idx
  on public.erp_loan_payment_events (company_id, amount);

create index if not exists erp_loan_payment_events_company_match_bank_idx
  on public.erp_loan_payment_events (company_id, matched_bank_transaction_id)
  where matched_bank_transaction_id is not null;

create or replace function public.erp_loans_payment_events_list(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_status text default null,
  p_loan_id uuid default null
)
returns table (
  id uuid,
  company_id uuid,
  loan_id uuid,
  event_date date,
  expected_due_date date,
  amount numeric,
  direction text,
  status text,
  match_score int,
  matched_bank_transaction_id uuid,
  source text,
  notes text,
  raw jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  voided_at timestamptz,
  void_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company context';
  end if;

  return query
  select
    e.id,
    e.company_id,
    e.loan_id,
    e.event_date,
    e.expected_due_date,
    e.amount,
    e.direction,
    e.status,
    e.match_score,
    e.matched_bank_transaction_id,
    e.source,
    e.notes,
    e.raw,
    e.created_at,
    e.updated_at,
    e.voided_at,
    e.void_reason
  from public.erp_loan_payment_events e
  where e.company_id = p_company_id
    and e.is_void = false
    and (p_from is null or e.event_date >= p_from)
    and (p_to is null or e.event_date <= p_to)
    and (p_status is null or e.status = p_status)
    and (p_loan_id is null or e.loan_id = p_loan_id)
  order by e.event_date desc, e.created_at desc;
end;
$$;

create or replace function public.erp_loans_payment_events_suggest_matches(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_tolerance numeric := 1.00;
  v_date_window int := 7;
  v_low int := 35;
  v_auto int := 85;
  v_row record;
  v_event_id uuid;
  v_created int := 0;
  v_suggested int := 0;
  v_auto_matched int := 0;
  v_match jsonb;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company context';
  end if;

  for v_row in
    with schedules as (
      select s.id as schedule_id, s.loan_id, s.due_date, round(s.emi_amount::numeric,2) as emi_amount,
             lower(coalesce(l.lender_name, '')) as lender_name,
             lower(coalesce(l.loan_ref, '')) as loan_ref
      from public.erp_loan_schedules s
      join public.erp_loans l on l.id = s.loan_id and l.company_id = p_company_id
      where s.company_id = p_company_id
        and s.is_void = false
        and s.status in ('due')
        and (p_from is null or s.due_date >= p_from)
        and (p_to is null or s.due_date <= p_to)
    ),
    candidates as (
      select
        s.schedule_id,
        s.loan_id,
        s.due_date,
        s.emi_amount,
        t.id as bank_txn_id,
        coalesce(t.value_date, t.txn_date) as event_date,
        round(coalesce(nullif(t.debit, 0), t.credit)::numeric,2) as bank_amount,
        t.reference_no,
        t.description,
        (
          case when round(coalesce(nullif(t.debit, 0), t.credit)::numeric,2) = s.emi_amount then 25
               when abs(round(coalesce(nullif(t.debit, 0), t.credit)::numeric,2) - s.emi_amount) <= v_tolerance then 15
               else 0 end
          + case when abs((coalesce(t.value_date, t.txn_date) - s.due_date)) <= v_date_window then 10 else 0 end
          + case when lower(coalesce(t.description, '') || ' ' || coalesce(t.reference_no, '')) like '%' || s.lender_name || '%' and s.lender_name <> '' then 10
                 when lower(coalesce(t.description, '') || ' ' || coalesce(t.reference_no, '')) like '%' || s.loan_ref || '%' and s.loan_ref <> '' then 10
                 else 0 end
          + case when coalesce(s.loan_ref, '') <> '' and lower(coalesce(t.reference_no, '')) like '%' || s.loan_ref || '%' then 60 else 0 end
        )::int as score
      from schedules s
      join public.erp_bank_transactions t
        on t.company_id = p_company_id
       and t.is_void = false
       and coalesce(t.debit,0) > 0
       and (p_from is null or coalesce(t.value_date, t.txn_date) >= (p_from - v_date_window))
       and (p_to is null or coalesce(t.value_date, t.txn_date) <= (p_to + v_date_window))
       and abs(round(coalesce(nullif(t.debit, 0), t.credit)::numeric,2) - s.emi_amount) <= v_tolerance
      left join public.erp_bank_recon_links lnk
        on lnk.company_id = p_company_id
       and lnk.bank_txn_id = t.id
       and lnk.status = 'matched'
       and lnk.is_void = false
      where lnk.id is null
    )
    select distinct on (schedule_id)
      schedule_id, loan_id, due_date, emi_amount, bank_txn_id, event_date, bank_amount, reference_no, description, score
    from candidates
    order by schedule_id, score desc, event_date asc
  loop
    if v_row.score < v_low then
      continue;
    end if;

    insert into public.erp_loan_payment_events (
      company_id, loan_id, event_date, expected_due_date, amount, direction, status,
      match_score, matched_bank_transaction_id, source, notes, raw, source_type, source_id, created_by, updated_by
    ) values (
      p_company_id,
      v_row.loan_id,
      v_row.event_date,
      v_row.due_date,
      v_row.bank_amount,
      'debit',
      case when v_row.score >= v_auto then 'matched' else 'suggested' end,
      v_row.score,
      v_row.bank_txn_id,
      'bank_autodetect',
      case when v_row.score >= v_auto then 'Auto linked from bank transaction' else 'Suggested candidate from bank transaction' end,
      jsonb_build_object('bank_reference_no', v_row.reference_no, 'bank_description', v_row.description, 'schedule_id', v_row.schedule_id),
      'bank_txn',
      v_row.bank_txn_id,
      auth.uid(),
      auth.uid()
    )
    on conflict (company_id, source_type, source_id)
    do update set
      loan_id = excluded.loan_id,
      event_date = excluded.event_date,
      expected_due_date = excluded.expected_due_date,
      amount = excluded.amount,
      direction = excluded.direction,
      status = excluded.status,
      match_score = excluded.match_score,
      matched_bank_transaction_id = excluded.matched_bank_transaction_id,
      source = excluded.source,
      notes = excluded.notes,
      raw = excluded.raw,
      updated_at = now(),
      updated_by = excluded.updated_by
    returning id into v_event_id;

    v_created := v_created + 1;

    if v_row.score >= v_auto then
      select public.erp_loans_payment_events_link_bank_txn(p_company_id, v_event_id, v_row.bank_txn_id, v_row.score)
      into v_match;
      v_auto_matched := v_auto_matched + 1;
    else
      v_suggested := v_suggested + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_created,
    'suggested', v_suggested,
    'auto_matched', v_auto_matched,
    'tolerance', v_tolerance,
    'date_window_days', v_date_window
  );
end;
$$;

create or replace function public.erp_loans_payment_events_link_bank_txn(
  p_company_id uuid,
  p_event_id uuid,
  p_bank_transaction_id uuid,
  p_score int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event record;
  v_score int := greatest(coalesce(p_score, 0), 0);
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company context';
  end if;

  select e.*
    into v_event
  from public.erp_loan_payment_events e
  where e.id = p_event_id
    and e.company_id = p_company_id
    and e.is_void = false
  for update;

  if v_event.id is null then
    raise exception 'Loan payment event not found';
  end if;

  perform public.erp_bank_recon_match(
    p_bank_transaction_id,
    'loan_payment_event',
    p_event_id,
    case when v_score >= 85 then 'auto' else 'manual' end,
    format('Loan payment link score=%s', v_score)
  );

  update public.erp_loan_payment_events e
  set matched_bank_transaction_id = p_bank_transaction_id,
      match_score = v_score,
      status = case when e.status = 'posted' then 'posted' else 'matched' end,
      source = coalesce(e.source, 'bank_autodetect'),
      updated_at = now(),
      updated_by = auth.uid()
  where e.id = p_event_id
    and e.company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'event_id', p_event_id,
    'bank_transaction_id', p_bank_transaction_id,
    'score', v_score
  );
end;
$$;

create or replace function public.erp_loans_payment_events_mark_manual(
  p_company_id uuid,
  p_loan_id uuid,
  p_event_date date,
  p_amount numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event_id uuid;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company context';
  end if;

  perform 1
  from public.erp_loans l
  where l.id = p_loan_id
    and l.company_id = p_company_id
    and l.is_void = false;

  if not found then
    raise exception 'Loan not found';
  end if;

  insert into public.erp_loan_payment_events (
    company_id,
    loan_id,
    event_date,
    amount,
    direction,
    status,
    source,
    notes,
    source_type,
    source_id,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_loan_id,
    p_event_date,
    round(coalesce(p_amount, 0)::numeric, 2),
    'debit',
    'unmatched',
    'manual',
    nullif(btrim(p_notes), ''),
    'escrow_txn',
    gen_random_uuid(),
    auth.uid(),
    auth.uid()
  ) returning id into v_event_id;

  return jsonb_build_object('ok', true, 'event_id', v_event_id);
end;
$$;

revoke all on function public.erp_loans_payment_events_list(uuid, date, date, text, uuid) from public;
revoke all on function public.erp_loans_payment_events_suggest_matches(uuid, date, date) from public;
revoke all on function public.erp_loans_payment_events_link_bank_txn(uuid, uuid, uuid, int) from public;
revoke all on function public.erp_loans_payment_events_mark_manual(uuid, uuid, date, numeric, text) from public;

grant execute on function public.erp_loans_payment_events_list(uuid, date, date, text, uuid) to authenticated;
grant execute on function public.erp_loans_payment_events_suggest_matches(uuid, date, date) to authenticated;
grant execute on function public.erp_loans_payment_events_link_bank_txn(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.erp_loans_payment_events_mark_manual(uuid, uuid, date, numeric, text) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;

commit;
