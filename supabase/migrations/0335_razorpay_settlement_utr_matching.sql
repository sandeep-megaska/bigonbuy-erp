-- 0335_razorpay_settlement_utr_matching.sql
-- Phase 2F: UTR matching improvements for Razorpay settlements

begin;

alter table public.erp_razorpay_settlements
  add column if not exists utr text;

update public.erp_razorpay_settlements
   set utr = settlement_utr
 where utr is null
   and settlement_utr is not null;

create index if not exists erp_razorpay_settlements_company_utr_idx
  on public.erp_razorpay_settlements (company_id, utr);

create index if not exists erp_razorpay_settlements_company_settled_amount_idx
  on public.erp_razorpay_settlements (company_id, settled_at, amount);

create or replace function public.erp_razorpay_settlements_upsert(
  p_razorpay_settlement_id text,
  p_settlement_utr text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_settled_at timestamptz,
  p_raw jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  insert into public.erp_razorpay_settlements (
    company_id,
    razorpay_settlement_id,
    settlement_utr,
    utr,
    amount,
    currency,
    status,
    settled_at,
    raw,
    fetched_at,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    is_void
  ) values (
    v_company_id,
    p_razorpay_settlement_id,
    p_settlement_utr,
    p_settlement_utr,
    p_amount,
    p_currency,
    p_status,
    p_settled_at,
    coalesce(p_raw, '{}'::jsonb),
    now(),
    now(),
    v_actor,
    now(),
    v_actor,
    false
  )
  on conflict (company_id, razorpay_settlement_id) where is_void = false
  do update set
    settlement_utr = excluded.settlement_utr,
    utr = excluded.utr,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    settled_at = excluded.settled_at,
    raw = excluded.raw,
    fetched_at = now(),
    updated_at = now(),
    updated_by_user_id = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_razorpay_settlements_upsert(text, text, numeric, text, text, timestamptz, jsonb) from public;
grant execute on function public.erp_razorpay_settlements_upsert(text, text, numeric, text, text, timestamptz, jsonb) to authenticated;

create or replace function public.erp_razorpay_settlement_upsert_from_csv(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_error_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_line int := 0;
  v_settlement_id text;
  v_amount numeric;
  v_settled_at timestamptz;
  v_status text;
  v_currency text;
  v_utr text;
  v_raw jsonb;
  v_inserted_flag boolean;
  v_reason text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_line := v_line + 1;
    v_reason := null;

    if v_row is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_settlement_id := nullif(trim(coalesce(v_row->>'settlement_id', v_row->>'razorpay_settlement_id', '')), '');

    if v_settlement_id is null then
      v_reason := 'settlement_id is required';
    end if;

    v_amount := null;
    v_settled_at := null;
    v_status := null;
    v_currency := null;
    v_utr := null;
    v_raw := coalesce(v_row->'raw', v_row, '{}'::jsonb);

    if v_reason is null then
      v_status := nullif(trim(coalesce(v_row->>'status', '')), '');
      v_currency := nullif(trim(coalesce(v_row->>'currency', '')), '');
      v_utr := nullif(trim(coalesce(v_row->>'utr', v_row->>'settlement_utr', '')), '');

      if coalesce(trim(v_row->>'amount'), '') <> '' then
        begin
          v_amount := (v_row->>'amount')::numeric;
        exception
          when others then
            v_reason := 'amount must be numeric';
        end;
      end if;

      if v_reason is null and coalesce(trim(v_row->>'settled_at'), '') <> '' then
        begin
          v_settled_at := (v_row->>'settled_at')::timestamptz;
        exception
          when others then
            v_reason := 'settled_at must be a valid timestamp';
        end;
      end if;
    end if;

    if v_reason is not null then
      v_errors := v_errors + 1;
      if jsonb_array_length(v_error_rows) < 50 then
        v_error_rows := v_error_rows || jsonb_build_array(
          jsonb_build_object(
            'line', v_line,
            'settlement_id', v_settlement_id,
            'reason', v_reason
          )
        );
      end if;
      continue;
    end if;

    insert into public.erp_razorpay_settlements (
      company_id,
      razorpay_settlement_id,
      settlement_utr,
      utr,
      amount,
      currency,
      status,
      settled_at,
      raw,
      fetched_at,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id,
      is_void
    ) values (
      v_company_id,
      v_settlement_id,
      v_utr,
      v_utr,
      v_amount,
      v_currency,
      v_status,
      v_settled_at,
      coalesce(v_raw, '{}'::jsonb),
      now(),
      now(),
      v_actor,
      now(),
      v_actor,
      false
    )
    on conflict (company_id, razorpay_settlement_id) where is_void = false
    do update set
      settlement_utr = excluded.settlement_utr,
      utr = excluded.utr,
      amount = excluded.amount,
      currency = excluded.currency,
      status = excluded.status,
      settled_at = excluded.settled_at,
      raw = coalesce(public.erp_razorpay_settlements.raw, '{}'::jsonb) || excluded.raw,
      fetched_at = now(),
      updated_at = now(),
      updated_by_user_id = v_actor
    returning (xmax = 0) into v_inserted_flag;

    if v_inserted_flag then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted_count', v_inserted,
    'updated_count', v_updated,
    'skipped_count', v_skipped,
    'errors', v_error_rows
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_upsert_from_csv(jsonb) from public;
grant execute on function public.erp_razorpay_settlement_upsert_from_csv(jsonb) to authenticated;

create or replace function public.erp_razorpay_settlements_suggest_for_bank_txn(
  p_bank_txn_id uuid,
  p_query text default null
)
returns table(
  settlement_db_id uuid,
  settlement_id text,
  utr text,
  amount numeric,
  settled_at timestamptz,
  status text,
  journal_id uuid,
  journal_doc_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_txn record;
  v_query text := nullif(btrim(p_query), '');
  v_ref text;
  v_match_count int;
  v_match_date date;
begin
  perform public.erp_require_finance_reader();

  select
    t.id,
    t.txn_date,
    t.value_date,
    t.credit,
    t.reference_no
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
    and t.is_void = false
  into v_txn;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  v_ref := nullif(btrim(v_txn.reference_no), '');
  v_match_date := coalesce(v_txn.value_date, v_txn.txn_date);

  select count(*)
    into v_match_count
    from public.erp_razorpay_settlements s
   where s.company_id = v_company_id
     and s.is_void = false
     and v_ref is not null
     and s.utr = v_ref;

  return query
  with base as (
    select
      s.id as settlement_db_id,
      s.razorpay_settlement_id as settlement_id,
      s.utr,
      s.amount,
      s.settled_at,
      s.status,
      p.finance_journal_id as journal_id,
      j.doc_no as journal_doc_no
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
      and l.id is null
      and (
        (v_match_count > 0 and v_ref is not null and s.utr = v_ref)
        or (
          v_match_count = 0
          and v_txn.credit is not null
          and s.amount between v_txn.credit - 1 and v_txn.credit + 1
          and s.settled_at is not null
          and s.settled_at::date between v_match_date - 7 and v_match_date + 7
        )
      )
  )
  select *
    from base
   where v_query is null
      or settlement_id ilike '%' || v_query || '%'
      or coalesce(utr, '') ilike '%' || v_query || '%'
   order by settled_at desc nulls last
   limit 20;
end;
$$;

revoke all on function public.erp_razorpay_settlements_suggest_for_bank_txn(uuid, text) from public;
grant execute on function public.erp_razorpay_settlements_suggest_for_bank_txn(uuid, text) to authenticated;

commit;
