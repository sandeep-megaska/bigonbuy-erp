begin;

create table if not exists public.erp_marketplace_payout_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  channel_code text not null,
  payout_ref text not null,
  payout_date date not null,
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  status text not null default 'unmatched' check (status in ('unmatched','suggested','matched','posted','void')),
  match_score int null,
  raw jsonb null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  constraint erp_marketplace_payout_events_company_channel_ref_key unique (company_id, channel_code, payout_ref)
);

create index if not exists erp_marketplace_payout_events_company_channel_date_idx
  on public.erp_marketplace_payout_events (company_id, channel_code, payout_date desc);

create index if not exists erp_marketplace_payout_events_company_status_idx
  on public.erp_marketplace_payout_events (company_id, status);

alter table public.erp_marketplace_payout_events enable row level security;
alter table public.erp_marketplace_payout_events force row level security;

do $$
begin
  drop policy if exists erp_marketplace_payout_events_select on public.erp_marketplace_payout_events;
  drop policy if exists erp_marketplace_payout_events_write on public.erp_marketplace_payout_events;

  create policy erp_marketplace_payout_events_select
    on public.erp_marketplace_payout_events
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_marketplace_payout_events_write
    on public.erp_marketplace_payout_events
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1 from public.erp_company_users cu
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
          select 1 from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end;
$$;

create or replace function public.erp_marketplace_payout_events_list(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_channel_code text default null,
  p_status text default null
)
returns setof public.erp_marketplace_payout_events
language sql
security definer
set search_path = public
as $$
  select e.*
  from public.erp_marketplace_payout_events e
  where e.company_id = p_company_id
    and e.is_void = false
    and (p_from is null or e.payout_date >= p_from)
    and (p_to is null or e.payout_date <= p_to)
    and (p_channel_code is null or e.channel_code = lower(btrim(p_channel_code)))
    and (p_status is null or e.status = lower(btrim(p_status)))
  order by e.payout_date desc, e.created_at desc;
$$;

revoke all on function public.erp_marketplace_payout_events_list(uuid, date, date, text, text) from public;
grant execute on function public.erp_marketplace_payout_events_list(uuid, date, date, text, text) to authenticated, service_role;

create or replace function public.erp_marketplace_payout_events_import_amazon(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  for v_row in
    select
      b.id,
      b.batch_ref,
      coalesce(b.deposit_date, b.period_end, b.period_start, b.uploaded_at::date) as payout_date,
      coalesce(b.net_payout, 0)::numeric(12,2) as amount,
      coalesce(nullif(b.currency, ''), 'INR') as currency,
      b.status,
      b.channel_id
    from public.erp_marketplace_settlement_batches b
    left join public.erp_sales_channels sc
      on sc.id = b.channel_id
     and sc.company_id = b.company_id
    where b.company_id = p_company_id
      and coalesce(b.is_void, false) = false
      and coalesce(sc.code, 'amazon') = 'amazon'
      and coalesce(b.deposit_date, b.period_end, b.period_start, b.uploaded_at::date) between p_from and p_to
      and coalesce(b.net_payout, 0) > 0
  loop
    insert into public.erp_marketplace_payout_events (
      company_id, channel_code, payout_ref, payout_date, amount, currency, status, raw, updated_at, updated_by
    ) values (
      p_company_id,
      'amazon',
      coalesce(nullif(v_row.batch_ref, ''), v_row.id::text),
      v_row.payout_date,
      v_row.amount,
      v_row.currency,
      case when v_row.status = 'posted' then 'posted' else 'unmatched' end,
      jsonb_build_object('source_table', 'erp_marketplace_settlement_batches', 'source_id', v_row.id, 'channel_id', v_row.channel_id),
      now(),
      auth.uid()
    )
    on conflict (company_id, channel_code, payout_ref)
    do update set
      payout_date = excluded.payout_date,
      amount = excluded.amount,
      currency = excluded.currency,
      raw = coalesce(public.erp_marketplace_payout_events.raw, '{}'::jsonb) || excluded.raw,
      updated_at = now(),
      updated_by = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.erp_marketplace_payout_events_import_amazon(uuid, date, date) from public;
grant execute on function public.erp_marketplace_payout_events_import_amazon(uuid, date, date) to authenticated, service_role;

create or replace function public.erp_marketplace_payout_events_import_razorpay(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  for v_row in
    select
      s.id,
      s.razorpay_settlement_id,
      s.settlement_utr,
      coalesce(s.settled_at::date, s.created_at::date) as payout_date,
      coalesce(s.amount, 0)::numeric(12,2) as amount,
      coalesce(nullif(s.currency, ''), 'INR') as currency,
      s.status
    from public.erp_razorpay_settlements s
    where s.company_id = p_company_id
      and s.is_void = false
      and coalesce(s.settled_at::date, s.created_at::date) between p_from and p_to
      and coalesce(s.amount, 0) > 0
  loop
    insert into public.erp_marketplace_payout_events (
      company_id, channel_code, payout_ref, payout_date, amount, currency, status, raw, updated_at, updated_by
    ) values (
      p_company_id,
      'razorpay',
      coalesce(nullif(v_row.razorpay_settlement_id, ''), v_row.id::text),
      v_row.payout_date,
      v_row.amount,
      v_row.currency,
      case when lower(coalesce(v_row.status, '')) = 'posted' then 'posted' else 'unmatched' end,
      jsonb_build_object('source_table', 'erp_razorpay_settlements', 'source_id', v_row.id, 'settlement_utr', v_row.settlement_utr),
      now(),
      auth.uid()
    )
    on conflict (company_id, channel_code, payout_ref)
    do update set
      payout_date = excluded.payout_date,
      amount = excluded.amount,
      currency = excluded.currency,
      raw = coalesce(public.erp_marketplace_payout_events.raw, '{}'::jsonb) || excluded.raw,
      updated_at = now(),
      updated_by = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.erp_marketplace_payout_events_import_razorpay(uuid, date, date) from public;
grant execute on function public.erp_marketplace_payout_events_import_razorpay(uuid, date, date) to authenticated, service_role;

create or replace function public.erp_marketplace_payout_events_suggest_matches(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  event_id uuid,
  bank_transaction_id uuid,
  score int,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_candidate record;
  v_score int;
begin
  for v_event in
    select e.*
    from public.erp_marketplace_payout_events e
    where e.company_id = p_company_id
      and e.is_void = false
      and e.status in ('unmatched', 'suggested')
      and e.payout_date between p_from and p_to
  loop
    select
      t.id as bank_txn_id,
      case
        when upper(coalesce(t.description, '') || ' ' || coalesce(t.reference_no, '')) like '%' || upper(v_event.payout_ref) || '%' then 95
        when abs(coalesce(t.credit, 0) - v_event.amount) <= 1 then 80
        else 60
      end as calc_score,
      case
        when upper(coalesce(t.description, '') || ' ' || coalesce(t.reference_no, '')) like '%' || upper(v_event.payout_ref) || '%' then 'Narration/ref match + amount window'
        when abs(coalesce(t.credit, 0) - v_event.amount) <= 1 then 'Near amount + date window'
        else 'Date window candidate'
      end as calc_reason
    into v_candidate
    from public.erp_bank_transactions t
    left join public.erp_bank_recon_links l
      on l.bank_txn_id = t.id
     and l.company_id = p_company_id
     and l.status = 'matched'
     and l.is_void = false
    where t.company_id = p_company_id
      and t.is_void = false
      and coalesce(t.credit, 0) > 0
      and l.id is null
      and t.txn_date between (v_event.payout_date - interval '3 days')::date and (v_event.payout_date + interval '3 days')::date
      and abs(coalesce(t.credit, 0) - v_event.amount) <= greatest(1, v_event.amount * 0.01)
    order by calc_score desc, abs(coalesce(t.credit, 0) - v_event.amount), abs(t.txn_date - v_event.payout_date)
    limit 1;

    if v_candidate.bank_txn_id is not null then
      v_score := coalesce(v_candidate.calc_score, 60);

      update public.erp_marketplace_payout_events e
         set status = case when e.status = 'posted' then 'posted' else 'suggested' end,
             match_score = v_score,
             raw = coalesce(e.raw, '{}'::jsonb) || jsonb_build_object('suggested_bank_transaction_id', v_candidate.bank_txn_id, 'suggest_reason', v_candidate.calc_reason),
             updated_at = now(),
             updated_by = auth.uid()
       where e.id = v_event.id;

      event_id := v_event.id;
      bank_transaction_id := v_candidate.bank_txn_id;
      score := v_score;
      reason := v_candidate.calc_reason;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.erp_marketplace_payout_events_suggest_matches(uuid, date, date) from public;
grant execute on function public.erp_marketplace_payout_events_suggest_matches(uuid, date, date) to authenticated, service_role;

create or replace function public.erp_marketplace_payout_events_link_bank_txn(
  p_company_id uuid,
  p_event_id uuid,
  p_bank_transaction_id uuid,
  p_score int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_event record;
  v_txn record;
  v_link_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select * into v_event
  from public.erp_marketplace_payout_events e
  where e.id = p_event_id
    and e.company_id = p_company_id
    and e.is_void = false
  for update;

  if not found then
    raise exception 'Payout event not found';
  end if;

  select * into v_txn
  from public.erp_bank_transactions t
  where t.id = p_bank_transaction_id
    and t.company_id = p_company_id
    and t.is_void = false
  for update;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  if coalesce(v_txn.credit, 0) <= 0 then
    raise exception 'Bank transaction must be a credit';
  end if;

  if exists (
    select 1 from public.erp_bank_recon_links l
    where l.company_id = p_company_id
      and l.bank_txn_id = p_bank_transaction_id
      and l.status = 'matched'
      and l.is_void = false
  ) then
    raise exception 'Bank transaction already matched';
  end if;

  insert into public.erp_bank_recon_links (
    company_id,
    bank_txn_id,
    entity_type,
    entity_id,
    confidence,
    notes,
    match_confidence,
    match_notes,
    status,
    matched_at,
    matched_by_user_id,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_bank_transaction_id,
    'marketplace_payout_event',
    p_event_id,
    'suggested',
    format('Payout event %s (%s)', v_event.payout_ref, v_event.channel_code),
    'suggested',
    format('Score %s', coalesce(p_score, 0)),
    'matched',
    now(),
    v_actor,
    v_actor,
    v_actor
  )
  returning id into v_link_id;

  update public.erp_bank_transactions t
     set is_matched = true,
         matched_entity_type = 'marketplace_payout_event',
         matched_entity_id = p_event_id,
         match_confidence = 'suggested',
         match_notes = format('Payout event %s (%s)', v_event.payout_ref, v_event.channel_code),
         updated_at = now(),
         updated_by = coalesce(v_actor, t.updated_by)
   where t.id = p_bank_transaction_id
     and t.company_id = p_company_id;

  update public.erp_marketplace_payout_events e
     set status = case when e.status = 'posted' then 'posted' else 'matched' end,
         match_score = p_score,
         raw = coalesce(e.raw, '{}'::jsonb) || jsonb_build_object('matched_bank_transaction_id', p_bank_transaction_id, 'bank_recon_link_id', v_link_id),
         updated_at = now(),
         updated_by = v_actor
   where e.id = p_event_id
     and e.company_id = p_company_id;

  return v_link_id;
end;
$$;

revoke all on function public.erp_marketplace_payout_events_link_bank_txn(uuid, uuid, uuid, int) from public;
grant execute on function public.erp_marketplace_payout_events_link_bank_txn(uuid, uuid, uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
