-- 0333_bank_recon_razorpay_phase2f.sql
-- Phase 2F: Bank reconciliation links for Razorpay settlements

begin;

create table if not exists public.erp_bank_recon_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  bank_txn_id uuid not null references public.erp_bank_transactions (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  confidence text not null default 'manual',
  notes text null,
  status text not null default 'matched',
  matched_at timestamptz not null default now(),
  matched_by_user_id uuid null,
  unmatched_at timestamptz null,
  unmatched_by_user_id uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

create unique index if not exists erp_bank_recon_links_company_bank_txn_active_unique
  on public.erp_bank_recon_links (company_id, bank_txn_id)
  where status = 'matched'
    and is_void = false;

create unique index if not exists erp_bank_recon_links_company_entity_active_unique
  on public.erp_bank_recon_links (company_id, entity_type, entity_id)
  where status = 'matched'
    and is_void = false;

alter table public.erp_bank_recon_links enable row level security;
alter table public.erp_bank_recon_links force row level security;

drop function if exists public.erp_bank_txn_match_suggest_razorpay(uuid, int);

create or replace function public.erp_bank_txn_match_suggest_razorpay(
  p_bank_txn_id uuid,
  p_date_window_days int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_txn record;
  v_match_date date;
  v_date_from date;
  v_date_to date;
  v_bank_amount numeric;
  v_window int := coalesce(p_date_window_days, 3);
  v_has_razorpay_ref boolean := false;
  v_ref_text text;
begin
  perform public.erp_require_finance_reader();

  select
    t.id,
    t.txn_date,
    t.value_date,
    t.credit,
    t.debit,
    t.amount,
    t.reference_no,
    t.description,
    t.is_matched,
    t.matched_entity_type,
    t.matched_entity_id,
    t.match_confidence,
    t.match_notes
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
  into v_txn;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  v_match_date := coalesce(v_txn.value_date, v_txn.txn_date);
  v_date_from := v_match_date - v_window;
  v_date_to := v_match_date + v_window;
  v_bank_amount := coalesce(v_txn.credit, 0);
  v_ref_text := lower(coalesce(v_txn.reference_no, '') || ' ' || coalesce(v_txn.description, ''));
  v_has_razorpay_ref := v_ref_text like '%razorpay%';

  if v_txn.is_matched then
    return jsonb_build_object(
      'bank_txn', jsonb_build_object(
        'id', v_txn.id,
        'txn_date', v_txn.txn_date,
        'credit', v_txn.credit,
        'debit', v_txn.debit,
        'amount', v_txn.amount,
        'reference_no', v_txn.reference_no,
        'description', v_txn.description,
        'matched_entity_type', v_txn.matched_entity_type,
        'matched_entity_id', v_txn.matched_entity_id,
        'match_confidence', v_txn.match_confidence,
        'match_notes', v_txn.match_notes
      ),
      'current_match', jsonb_build_object(
        'entity_type', v_txn.matched_entity_type,
        'entity_id', v_txn.matched_entity_id,
        'confidence', v_txn.match_confidence,
        'notes', v_txn.match_notes
      ),
      'suggestions', '[]'::jsonb
    );
  end if;

  if v_bank_amount <= 0 then
    return jsonb_build_object(
      'bank_txn', jsonb_build_object(
        'id', v_txn.id,
        'txn_date', v_txn.txn_date,
        'credit', v_txn.credit,
        'debit', v_txn.debit,
        'amount', v_txn.amount,
        'reference_no', v_txn.reference_no,
        'description', v_txn.description
      ),
      'suggestions', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'bank_txn', jsonb_build_object(
      'id', v_txn.id,
      'txn_date', v_txn.txn_date,
      'credit', v_txn.credit,
      'debit', v_txn.debit,
      'amount', v_txn.amount,
      'reference_no', v_txn.reference_no,
      'description', v_txn.description
    ),
    'suggestions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'settlement_db_id', suggestion.settlement_db_id,
            'settlement_id', suggestion.settlement_id,
            'settled_at', suggestion.settled_at,
            'amount', suggestion.amount,
            'utr', suggestion.utr,
            'posted_journal_doc_no', suggestion.posted_journal_doc_no,
            'score', suggestion.score,
            'reason', suggestion.reason
          )
          order by suggestion.score desc, suggestion.settled_at desc
        )
        from (
          select
            s.id as settlement_db_id,
            s.razorpay_settlement_id as settlement_id,
            coalesce(s.settled_at, s.created_at)::date as settled_at,
            s.amount,
            s.settlement_utr as utr,
            j.doc_no as posted_journal_doc_no,
            (
              60
              + case
                when coalesce(s.settled_at, s.created_at)::date = v_match_date then 20
                when coalesce(s.settled_at, s.created_at)::date between v_date_from and v_date_to then 10
                else 0
              end
              + case when v_has_razorpay_ref then 10 else 0 end
              + case
                when v_ref_text like '%' || lower(s.razorpay_settlement_id) || '%'
                  or (
                    s.settlement_utr is not null
                    and v_ref_text like '%' || lower(s.settlement_utr) || '%'
                  )
                  then 10
                else 0
              end
            )::int as score,
            array_to_string(
              array_remove(
                array[
                  'Amount match',
                  case
                    when coalesce(s.settled_at, s.created_at)::date = v_match_date then 'Date exact'
                    when coalesce(s.settled_at, s.created_at)::date between v_date_from and v_date_to then 'Date within window'
                    else null
                  end,
                  case when v_has_razorpay_ref then 'Reference mentions Razorpay' else null end,
                  case
                    when v_ref_text like '%' || lower(s.razorpay_settlement_id) || '%'
                      or (
                        s.settlement_utr is not null
                        and v_ref_text like '%' || lower(s.settlement_utr) || '%'
                      )
                      then 'Reference matches settlement/UTR'
                    else null
                  end
                ],
                null
              ),
              '; '
            ) as reason
          from public.erp_razorpay_settlements s
          left join public.erp_razorpay_settlement_posts p
            on p.company_id = s.company_id
           and p.razorpay_settlement_id = s.razorpay_settlement_id
           and p.is_void = false
          left join public.erp_fin_journals j
            on j.company_id = s.company_id
           and j.id = p.finance_journal_id
          left join public.erp_bank_recon_links l
            on l.company_id = s.company_id
           and l.entity_type = 'razorpay_settlement'
           and l.entity_id = s.id
           and l.status = 'matched'
           and l.is_void = false
          where s.company_id = v_company_id
            and s.is_void = false
            and s.amount = v_bank_amount
            and coalesce(s.settled_at, s.created_at)::date between v_date_from and v_date_to
            and l.id is null
          order by score desc, settled_at desc
          limit 20
        ) suggestion
      ),
      '[]'::jsonb
    )
  );
end;
$$;

drop function if exists public.erp_bank_txn_match_confirm(uuid, uuid, text, text);

create or replace function public.erp_bank_txn_match_confirm(
  p_bank_txn_id uuid,
  p_settlement_db_id uuid,
  p_confidence text default 'manual',
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
  v_settlement record;
  v_link_id uuid;
  v_confidence text := coalesce(nullif(btrim(p_confidence), ''), 'manual');
  v_notes text := nullif(btrim(p_notes), '');
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_actor is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select
    t.id,
    t.is_void,
    t.is_matched,
    t.matched_entity_type,
    t.matched_entity_id
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
    select l.id
      into v_link_id
      from public.erp_bank_recon_links l
     where l.company_id = v_company_id
       and l.bank_txn_id = v_txn.id
       and l.status = 'matched'
       and l.is_void = false
     limit 1;

    return jsonb_build_object(
      'ok', true,
      'bank_txn_id', v_txn.id,
      'entity_id', v_txn.matched_entity_id,
      'entity_type', v_txn.matched_entity_type,
      'link_id', v_link_id
    );
  end if;

  select s.id, s.is_void
    into v_settlement
    from public.erp_razorpay_settlements s
   where s.id = p_settlement_db_id
     and s.company_id = v_company_id
     and s.is_void = false;

  if not found then
    raise exception 'Razorpay settlement not found';
  end if;

  select l.id
    into v_link_id
    from public.erp_bank_recon_links l
   where l.company_id = v_company_id
     and l.entity_type = 'razorpay_settlement'
     and l.entity_id = p_settlement_db_id
     and l.status = 'matched'
     and l.is_void = false
   limit 1;

  if v_link_id is not null then
    raise exception 'Settlement already matched';
  end if;

  insert into public.erp_bank_recon_links (
    company_id,
    bank_txn_id,
    entity_type,
    entity_id,
    confidence,
    notes,
    status,
    matched_by_user_id,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_txn.id,
    'razorpay_settlement',
    p_settlement_db_id,
    v_confidence,
    v_notes,
    'matched',
    v_actor,
    v_actor,
    v_actor
  ) returning id into v_link_id;

  update public.erp_bank_transactions t
     set is_matched = true,
         matched_entity_type = 'razorpay_settlement',
         matched_entity_id = p_settlement_db_id,
         match_confidence = v_confidence,
         match_notes = v_notes,
         updated_at = now(),
         updated_by = coalesce(v_actor, updated_by)
   where t.id = v_txn.id
     and t.company_id = v_company_id
     and t.is_void = false
     and t.is_matched = false;

  return jsonb_build_object(
    'ok', true,
    'bank_txn_id', v_txn.id,
    'entity_id', p_settlement_db_id,
    'entity_type', 'razorpay_settlement',
    'link_id', v_link_id
  );
end;
$$;

drop function if exists public.erp_bank_txn_match_unmatch(uuid, text);

create or replace function public.erp_bank_txn_match_unmatch(
  p_bank_txn_id uuid,
  p_reason text default null
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
  v_reason text := nullif(btrim(p_reason), '');
  v_notes text;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_actor is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select
    t.id,
    t.is_void,
    t.is_matched
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

  if v_txn.is_matched = false then
    return jsonb_build_object(
      'ok', true,
      'bank_txn_id', v_txn.id,
      'entity_id', null,
      'entity_type', null,
      'link_id', null
    );
  end if;

  select l.id, l.notes
    into v_link
    from public.erp_bank_recon_links l
   where l.company_id = v_company_id
     and l.bank_txn_id = v_txn.id
     and l.status = 'matched'
     and l.is_void = false
   order by l.matched_at desc
   limit 1
   for update;

  v_notes := v_link.notes;
  if v_reason is not null then
    v_notes :=
      case
        when v_notes is null or btrim(v_notes) = '' then v_reason
        else v_notes || E'\n' || '[UNMATCH ' || now()::text || '] ' || v_reason
      end;
  end if;

  if v_link.id is not null then
    update public.erp_bank_recon_links
       set status = 'unmatched',
           notes = v_notes,
           unmatched_at = now(),
           unmatched_by_user_id = v_actor,
           updated_at = now(),
           updated_by = coalesce(v_actor, updated_by)
     where id = v_link.id;
  end if;

  update public.erp_bank_transactions t
     set is_matched = false,
         matched_entity_type = null,
         matched_entity_id = null,
         match_confidence = null,
         match_notes = v_reason,
         updated_at = now(),
         updated_by = coalesce(v_actor, updated_by)
   where t.id = v_txn.id
     and t.company_id = v_company_id
     and t.is_void = false;

  return jsonb_build_object(
    'ok', true,
    'bank_txn_id', v_txn.id,
    'entity_id', null,
    'entity_type', null,
    'link_id', v_link.id
  );
end;
$$;

revoke all on function public.erp_bank_txn_match_suggest_razorpay(uuid, int) from public;
revoke all on function public.erp_bank_txn_match_confirm(uuid, uuid, text, text) from public;
revoke all on function public.erp_bank_txn_match_unmatch(uuid, text) from public;

grant execute on function public.erp_bank_txn_match_suggest_razorpay(uuid, int) to authenticated;
grant execute on function public.erp_bank_txn_match_confirm(uuid, uuid, text, text) to authenticated;
grant execute on function public.erp_bank_txn_match_unmatch(uuid, text) to authenticated;

commit;
