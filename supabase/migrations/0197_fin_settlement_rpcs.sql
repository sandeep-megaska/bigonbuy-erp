-- ---------------------------------------------------------------------
-- Settlement ledger RPCs
-- ---------------------------------------------------------------------

create or replace function public.erp_settlement_batch_create(
  p_source text,
  p_source_ref text,
  p_received_at timestamptz,
  p_raw jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  insert into public.erp_settlement_batches (
    company_id,
    source,
    source_ref,
    received_at,
    raw_payload,
    created_by
  ) values (
    v_company_id,
    p_source,
    p_source_ref,
    coalesce(p_received_at, now()),
    p_raw,
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_settlement_batch_create(text, text, timestamptz, jsonb) from public;
grant execute on function public.erp_settlement_batch_create(text, text, timestamptz, jsonb) to authenticated;

create or replace function public.erp_settlement_event_insert(
  p_batch_id uuid,
  p_platform text,
  p_event_type text,
  p_event_date date,
  p_amount numeric,
  p_currency text,
  p_reference_no text,
  p_party text,
  p_payload jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  insert into public.erp_settlement_events (
    company_id,
    platform,
    event_type,
    event_date,
    amount,
    currency,
    reference_no,
    party,
    batch_id,
    raw_payload,
    created_by
  ) values (
    v_company_id,
    p_platform,
    p_event_type,
    p_event_date,
    p_amount,
    coalesce(p_currency, 'INR'),
    nullif(p_reference_no, ''),
    p_party,
    p_batch_id,
    p_payload,
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_settlement_event_insert(uuid, text, text, date, numeric, text, text, text, jsonb) from public;
grant execute on function public.erp_settlement_event_insert(uuid, text, text, date, numeric, text, text, text, jsonb) to authenticated;

create or replace function public.erp_settlement_events_list(
  p_from date,
  p_to date,
  p_platform text default null,
  p_event_type text default null
) returns table (
  id uuid,
  platform text,
  event_type text,
  event_date date,
  amount numeric,
  currency text,
  reference_no text,
  party text,
  indifi_reference_no text,
  bank_reference_no text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    e.id,
    e.platform,
    e.event_type,
    e.event_date,
    e.amount,
    e.currency,
    e.reference_no,
    e.party,
    indifi.reference_no as indifi_reference_no,
    bank.reference_no as bank_reference_no,
    case
      when bank.id is not null then 'Matched'
      when indifi.id is not null then 'Pending Bank'
      else 'Pending'
    end as status
  from public.erp_settlement_events e
  left join lateral (
    select se.id, se.reference_no
    from public.erp_settlement_links l
    join public.erp_settlement_events se
      on se.id = l.to_event_id
     and se.is_void = false
    where l.from_event_id = e.id
      and l.link_type = 'settlement_to_indifi'
      and l.is_void = false
    order by l.created_at desc
    limit 1
  ) indifi on true
  left join lateral (
    select se.id, se.reference_no
    from public.erp_settlement_links l
    join public.erp_settlement_events se
      on se.id = l.to_event_id
     and se.is_void = false
    where indifi.id is not null
      and l.from_event_id = indifi.id
      and l.link_type = 'indifi_to_bank'
      and l.is_void = false
    order by l.created_at desc
    limit 1
  ) bank on true
  where e.company_id = public.erp_current_company_id()
    and e.is_void = false
    and e.event_date between p_from and p_to
    and (p_platform is null or e.platform = p_platform)
    and (p_event_type is null or e.event_type = p_event_type)
  order by e.event_date desc, e.created_at desc;
end;
$$;

revoke all on function public.erp_settlement_events_list(date, date, text, text) from public;
grant execute on function public.erp_settlement_events_list(date, date, text, text) to authenticated;

create or replace function public.erp_settlement_reconcile_run(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_created_a integer := 0;
  v_created_b integer := 0;
  v_pending_settlements integer := 0;
  v_pending_indifi integer := 0;
  v_mismatches integer := 0;
begin
  perform public.erp_require_finance_writer();

  with candidate as (
    select
      s.id as from_event_id,
      i.id as to_event_id,
      case
        when s.reference_no is not null and i.reference_no = s.reference_no then 100
        else 80
      end as confidence,
      case
        when s.reference_no is not null and i.reference_no = s.reference_no then 'ref_match'
        else 'amount_date_window'
      end as rule_used
    from public.erp_settlement_events s
    left join lateral (
      select i.*
      from public.erp_settlement_events i
      where i.company_id = s.company_id
        and i.event_type = 'INDIFI_DISBURSEMENT'
        and i.is_void = false
        and (
          (s.reference_no is not null and i.reference_no = s.reference_no)
          or (
            s.amount = i.amount
            and i.event_date between s.event_date - 5 and s.event_date + 5
          )
        )
      order by
        case
          when s.reference_no is not null and i.reference_no = s.reference_no then 1
          else 2
        end,
        abs(i.event_date - s.event_date),
        i.created_at
      limit 1
    ) i on true
    where s.company_id = v_company_id
      and s.event_type = 'AMAZON_SETTLEMENT'
      and s.is_void = false
      and s.event_date between p_from and p_to
      and not exists (
        select 1
        from public.erp_settlement_links l
        where l.company_id = v_company_id
          and l.link_type = 'settlement_to_indifi'
          and l.is_void = false
          and l.from_event_id = s.id
      )
  ), inserted as (
    insert into public.erp_settlement_links (
      company_id,
      from_event_id,
      to_event_id,
      link_type,
      confidence,
      rule_used,
      created_by
    )
    select
      v_company_id,
      c.from_event_id,
      c.to_event_id,
      'settlement_to_indifi',
      c.confidence,
      c.rule_used,
      auth.uid()
    from candidate c
    where c.to_event_id is not null
    returning id
  )
  select count(*) into v_created_a from inserted;

  with candidate as (
    select
      i.id as from_event_id,
      b.id as to_event_id,
      case
        when i.reference_no is not null and i.reference_no = b.reference_no then 100
        else 75
      end as confidence,
      case
        when i.reference_no is not null and i.reference_no = b.reference_no then 'ref_match'
        else 'amount_date_window'
      end as rule_used
    from public.erp_settlement_events i
    left join lateral (
      select b.*
      from public.erp_settlement_events b
      where b.company_id = i.company_id
        and b.event_type = 'BANK_CREDIT'
        and b.is_void = false
        and (
          (i.reference_no is not null and b.reference_no = i.reference_no)
          or (
            i.amount = b.amount
            and b.event_date between i.event_date - 3 and i.event_date + 3
          )
        )
      order by
        case
          when i.reference_no is not null and b.reference_no = i.reference_no then 1
          else 2
        end,
        abs(b.event_date - i.event_date),
        b.created_at
      limit 1
    ) b on true
    where i.company_id = v_company_id
      and i.event_type = 'INDIFI_DISBURSEMENT'
      and i.is_void = false
      and i.event_date between p_from and p_to
      and not exists (
        select 1
        from public.erp_settlement_links l
        where l.company_id = v_company_id
          and l.link_type = 'indifi_to_bank'
          and l.is_void = false
          and l.from_event_id = i.id
      )
  ), inserted as (
    insert into public.erp_settlement_links (
      company_id,
      from_event_id,
      to_event_id,
      link_type,
      confidence,
      rule_used,
      created_by
    )
    select
      v_company_id,
      c.from_event_id,
      c.to_event_id,
      'indifi_to_bank',
      c.confidence,
      c.rule_used,
      auth.uid()
    from candidate c
    where c.to_event_id is not null
    returning id
  )
  select count(*) into v_created_b from inserted;

  select count(*)
    into v_pending_settlements
  from public.erp_settlement_events s
  where s.company_id = v_company_id
    and s.event_type = 'AMAZON_SETTLEMENT'
    and s.is_void = false
    and s.event_date between p_from and p_to
    and not exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'settlement_to_indifi'
        and l.is_void = false
        and l.from_event_id = s.id
    );

  select count(*)
    into v_pending_indifi
  from public.erp_settlement_events i
  where i.company_id = v_company_id
    and i.event_type = 'INDIFI_DISBURSEMENT'
    and i.is_void = false
    and i.event_date between p_from and p_to
    and not exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'indifi_to_bank'
        and l.is_void = false
        and l.from_event_id = i.id
    );

  select coalesce(sum(dup_count - 1), 0)
    into v_mismatches
  from (
    select count(*) as dup_count
    from public.erp_settlement_events e
    where e.company_id = v_company_id
      and e.event_type = 'AMAZON_SETTLEMENT'
      and e.is_void = false
      and e.event_date between p_from and p_to
    group by e.event_type, e.amount, e.event_date
    having count(*) > 1
  ) duplicates;

  return jsonb_build_object(
    'created_links_count', v_created_a + v_created_b,
    'pending_counts', jsonb_build_object(
      'settlements', v_pending_settlements,
      'indifi', v_pending_indifi
    ),
    'mismatches', v_mismatches
  );
end;
$$;

revoke all on function public.erp_settlement_reconcile_run(date, date) from public;
grant execute on function public.erp_settlement_reconcile_run(date, date) to authenticated;

create or replace function public.erp_settlement_status_summary(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_settlements_total integer := 0;
  v_settlements_linked integer := 0;
  v_indifi_linked integer := 0;
  v_pending_settlements integer := 0;
  v_pending_indifi integer := 0;
  v_mismatches integer := 0;
begin
  perform public.erp_require_finance_reader();

  select count(*)
    into v_settlements_total
  from public.erp_settlement_events s
  where s.company_id = v_company_id
    and s.event_type = 'AMAZON_SETTLEMENT'
    and s.is_void = false
    and s.event_date between p_from and p_to;

  select count(*)
    into v_settlements_linked
  from public.erp_settlement_events s
  where s.company_id = v_company_id
    and s.event_type = 'AMAZON_SETTLEMENT'
    and s.is_void = false
    and s.event_date between p_from and p_to
    and exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'settlement_to_indifi'
        and l.is_void = false
        and l.from_event_id = s.id
    );

  select count(*)
    into v_indifi_linked
  from public.erp_settlement_events i
  where i.company_id = v_company_id
    and i.event_type = 'INDIFI_DISBURSEMENT'
    and i.is_void = false
    and i.event_date between p_from and p_to
    and exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'indifi_to_bank'
        and l.is_void = false
        and l.from_event_id = i.id
    );

  select count(*)
    into v_pending_settlements
  from public.erp_settlement_events s
  where s.company_id = v_company_id
    and s.event_type = 'AMAZON_SETTLEMENT'
    and s.is_void = false
    and s.event_date between p_from and p_to
    and not exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'settlement_to_indifi'
        and l.is_void = false
        and l.from_event_id = s.id
    );

  select count(*)
    into v_pending_indifi
  from public.erp_settlement_events i
  where i.company_id = v_company_id
    and i.event_type = 'INDIFI_DISBURSEMENT'
    and i.is_void = false
    and i.event_date between p_from and p_to
    and not exists (
      select 1
      from public.erp_settlement_links l
      where l.company_id = v_company_id
        and l.link_type = 'indifi_to_bank'
        and l.is_void = false
        and l.from_event_id = i.id
    );

  select coalesce(sum(dup_count - 1), 0)
    into v_mismatches
  from (
    select count(*) as dup_count
    from public.erp_settlement_events e
    where e.company_id = v_company_id
      and e.event_type = 'AMAZON_SETTLEMENT'
      and e.is_void = false
      and e.event_date between p_from and p_to
    group by e.event_type, e.amount, e.event_date
    having count(*) > 1
  ) duplicates;

  return jsonb_build_object(
    'settlements_total', v_settlements_total,
    'settlements_linked_to_indifi', v_settlements_linked,
    'indifi_linked_to_bank', v_indifi_linked,
    'pending_settlements', v_pending_settlements,
    'pending_indifi', v_pending_indifi,
    'mismatches', v_mismatches
  );
end;
$$;

revoke all on function public.erp_settlement_status_summary(date, date) from public;
grant execute on function public.erp_settlement_status_summary(date, date) to authenticated;
