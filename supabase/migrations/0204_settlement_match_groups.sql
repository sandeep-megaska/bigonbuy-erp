-- 0204_settlement_match_groups.sql
-- Settlement matching groups, bank CSV import, and reconcile enhancements.

create table if not exists public.erp_settlement_match_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete restrict,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  cleared_at timestamptz null,
  note text null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

create table if not exists public.erp_settlement_match_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete restrict,
  group_id uuid not null references public.erp_settlement_match_groups (id) on delete restrict,
  settlement_event_id uuid not null references public.erp_settlement_events (id) on delete restrict,
  role text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null
);

create unique index if not exists erp_settlement_match_links_company_event_unique
  on public.erp_settlement_match_links (company_id, settlement_event_id);

create index if not exists erp_settlement_match_links_company_group_idx
  on public.erp_settlement_match_links (company_id, group_id);

create index if not exists erp_settlement_events_company_event_date_idx
  on public.erp_settlement_events (company_id, event_date);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.erp_settlement_match_groups enable row level security;
alter table public.erp_settlement_match_groups force row level security;
alter table public.erp_settlement_match_links enable row level security;
alter table public.erp_settlement_match_links force row level security;

do $$
begin
  drop policy if exists erp_settlement_match_groups_select on public.erp_settlement_match_groups;
  drop policy if exists erp_settlement_match_links_select on public.erp_settlement_match_links;

  create policy erp_settlement_match_groups_select
    on public.erp_settlement_match_groups
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

  create policy erp_settlement_match_links_select
    on public.erp_settlement_match_links
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
end;
$$;

-- ---------------------------------------------------------------------
-- Bank CSV import RPC
-- ---------------------------------------------------------------------

create or replace function public.erp_settlement_bank_csv_import(
  p_company_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(p_company_id, public.erp_current_company_id());
  v_batch_id uuid;
  v_total integer := 0;
  v_valid integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
begin
  perform public.erp_require_finance_writer_or_service();

  if auth.role() <> 'service_role' and v_company_id <> public.erp_current_company_id() then
    raise exception 'Invalid company id';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  v_total := jsonb_array_length(p_rows);

  insert into public.erp_settlement_batches (
    company_id,
    source,
    source_ref,
    received_at,
    raw_payload,
    created_by
  ) values (
    v_company_id,
    'bank_csv',
    null,
    now(),
    jsonb_build_object('row_count', v_total),
    auth.uid()
  ) returning id into v_batch_id;

  with input_rows as (
    select
      nullif(trim(coalesce(row->>'date', '')), '')::date as event_date,
      nullif(trim(coalesce(row->>'reference_no', row->>'ref_no', '')), '') as reference_no,
      nullif(trim(coalesce(row->>'narration', '')), '') as narration,
      nullif(trim(coalesce(row->>'amount', '')), '')::numeric as amount,
      row as payload,
      md5(lower(trim(coalesce(row->>'narration', '')))) as narration_hash
    from jsonb_array_elements(p_rows) row
  ),
  valid_rows as (
    select
      event_date,
      reference_no,
      narration,
      amount,
      payload,
      narration_hash
    from input_rows
    where event_date is not null
      and amount is not null
      and amount <> 0
  ),
  inserted as (
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
    )
    select
      v_company_id,
      'bank',
      'BANK_CREDIT',
      event_date,
      abs(amount),
      'INR',
      reference_no,
      'bank',
      v_batch_id,
      payload || jsonb_build_object('narration_hash', narration_hash),
      auth.uid()
    from valid_rows v
    where not exists (
      select 1
      from public.erp_settlement_events e
      where e.company_id = v_company_id
        and e.event_type = 'BANK_CREDIT'
        and e.is_void = false
        and e.event_date = v.event_date
        and e.amount = abs(v.amount)
        and (
          (v.reference_no is not null and e.reference_no = v.reference_no)
          or (
            v.reference_no is null
            and e.reference_no is null
            and coalesce(
              e.raw_payload->>'narration_hash',
              md5(lower(coalesce(e.raw_payload->>'narration', e.raw_payload->>'description', e.raw_payload->>'details', '')))
            ) = v.narration_hash
          )
        )
    )
    returning 1
  )
  select count(*) into v_valid from valid_rows;

  select count(*) into v_inserted from inserted;

  v_skipped := v_valid - v_inserted;
  v_errors := v_total - v_valid;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.erp_settlement_bank_csv_import(uuid, jsonb) from public;
grant execute on function public.erp_settlement_bank_csv_import(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Match group RPCs
-- ---------------------------------------------------------------------

create or replace function public.erp_settlement_match_group_create(
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  insert into public.erp_settlement_match_groups (
    company_id,
    status,
    opened_at,
    note,
    created_by,
    updated_by
  ) values (
    v_company_id,
    'open',
    now(),
    nullif(p_note, ''),
    auth.uid(),
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_settlement_match_group_create(text) from public;
grant execute on function public.erp_settlement_match_group_create(text) to authenticated;

create or replace function public.erp_settlement_match_link_add(
  p_group_id uuid,
  p_event_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event_company uuid;
begin
  perform public.erp_require_finance_writer();

  select company_id
    into v_event_company
  from public.erp_settlement_events
  where id = p_event_id
    and is_void = false;

  if v_event_company is null then
    raise exception 'Settlement event not found';
  end if;

  if v_event_company <> v_company_id then
    raise exception 'Event belongs to another company';
  end if;

  if not exists (
    select 1
    from public.erp_settlement_match_groups
    where id = p_group_id
      and company_id = v_company_id
  ) then
    raise exception 'Match group not found';
  end if;

  insert into public.erp_settlement_match_links (
    company_id,
    group_id,
    settlement_event_id,
    role,
    created_by
  ) values (
    v_company_id,
    p_group_id,
    p_event_id,
    p_role,
    auth.uid()
  );

  update public.erp_settlement_match_groups
     set updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_link_add(uuid, uuid, text) from public;
grant execute on function public.erp_settlement_match_link_add(uuid, uuid, text) to authenticated;

create or replace function public.erp_settlement_match_link_remove(
  p_group_id uuid,
  p_event_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_writer();

  delete from public.erp_settlement_match_links
   where company_id = v_company_id
     and group_id = p_group_id
     and settlement_event_id = p_event_id;

  update public.erp_settlement_match_groups
     set status = 'open',
         cleared_at = null,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_link_remove(uuid, uuid) from public;
grant execute on function public.erp_settlement_match_link_remove(uuid, uuid) to authenticated;

create or replace function public.erp_settlement_match_group_set_status(
  p_group_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text := lower(coalesce(p_status, ''));
  v_cleared_at timestamptz := null;
begin
  perform public.erp_require_finance_writer();

  if v_status not in ('open', 'cleared', 'void') then
    raise exception 'Invalid status';
  end if;

  if v_status = 'cleared' then
    v_cleared_at := now();
  end if;

  update public.erp_settlement_match_groups
     set status = v_status,
         cleared_at = v_cleared_at,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_group_set_status(uuid, text) from public;
grant execute on function public.erp_settlement_match_group_set_status(uuid, text) to authenticated;

create or replace function public.erp_settlement_match_group_note_set(
  p_group_id uuid,
  p_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_writer();

  update public.erp_settlement_match_groups
     set note = nullif(p_note, ''),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_group_note_set(uuid, text) from public;
grant execute on function public.erp_settlement_match_group_note_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Read RPCs
-- ---------------------------------------------------------------------

create or replace function public.erp_settlement_match_groups_list(
  p_from date,
  p_to date
) returns table (
  id uuid,
  status text,
  opened_at timestamptz,
  cleared_at timestamptz,
  note text,
  updated_at timestamptz,
  link_count integer,
  total_amount numeric
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
    g.id,
    g.status,
    g.opened_at,
    g.cleared_at,
    g.note,
    g.updated_at,
    count(l.id) as link_count,
    coalesce(sum(e.amount), 0) as total_amount
  from public.erp_settlement_match_groups g
  left join public.erp_settlement_match_links l
    on l.group_id = g.id
  left join public.erp_settlement_events e
    on e.id = l.settlement_event_id
   and e.is_void = false
  where g.company_id = public.erp_current_company_id()
    and (
      (p_from is null or p_to is null)
      or e.event_date between p_from and p_to
      or (e.event_date is null and g.opened_at::date between p_from and p_to)
    )
  group by g.id
  order by g.updated_at desc;
end;
$$;

revoke all on function public.erp_settlement_match_groups_list(date, date) from public;
grant execute on function public.erp_settlement_match_groups_list(date, date) to authenticated;

create or replace function public.erp_settlement_match_group_detail(
  p_group_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return (
    select jsonb_build_object(
      'group', jsonb_build_object(
        'id', g.id,
        'status', g.status,
        'opened_at', g.opened_at,
        'cleared_at', g.cleared_at,
        'note', g.note,
        'updated_at', g.updated_at
      ),
      'links', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', l.id,
            'role', l.role,
            'created_at', l.created_at,
            'event', jsonb_build_object(
              'id', e.id,
              'platform', e.platform,
              'event_type', e.event_type,
              'event_date', e.event_date,
              'amount', e.amount,
              'reference_no', e.reference_no,
              'party', e.party,
              'narration', coalesce(e.raw_payload->>'narration', e.raw_payload->>'description', e.raw_payload->>'details', '')
            )
          )
        ) filter (where l.id is not null),
        '[]'::jsonb
      )
    )
    from public.erp_settlement_match_groups g
    left join public.erp_settlement_match_links l
      on l.group_id = g.id
    left join public.erp_settlement_events e
      on e.id = l.settlement_event_id
     and e.is_void = false
    where g.id = p_group_id
      and g.company_id = public.erp_current_company_id()
    group by g.id
  );
end;
$$;

revoke all on function public.erp_settlement_match_group_detail(uuid) from public;
grant execute on function public.erp_settlement_match_group_detail(uuid) to authenticated;

create or replace function public.erp_settlement_unmatched_events_list(
  p_from date,
  p_to date,
  p_event_type text
) returns table (
  id uuid,
  event_date date,
  platform text,
  event_type text,
  amount numeric,
  reference_no text,
  party text,
  narration text
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
    e.event_date,
    e.platform,
    e.event_type,
    e.amount,
    e.reference_no,
    e.party,
    coalesce(e.raw_payload->>'narration', e.raw_payload->>'description', e.raw_payload->>'details', '') as narration
  from public.erp_settlement_events e
  where e.company_id = public.erp_current_company_id()
    and e.is_void = false
    and e.event_date between p_from and p_to
    and (p_event_type is null or e.event_type = p_event_type)
    and not exists (
      select 1
      from public.erp_settlement_match_links l
      where l.company_id = e.company_id
        and l.settlement_event_id = e.id
    )
  order by e.event_date desc, e.created_at desc;
end;
$$;

revoke all on function public.erp_settlement_unmatched_events_list(date, date, text) from public;
grant execute on function public.erp_settlement_unmatched_events_list(date, date, text) to authenticated;

create or replace function public.erp_settlement_daily_matrix(
  p_from date,
  p_to date
) returns table (
  event_date date,
  amazon_disbursed numeric,
  indifi_virtual_received numeric,
  indifi_out_to_bank numeric,
  bank_credits numeric,
  mismatch_amazon_indifi boolean,
  mismatch_indifi_bank boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with dates as (
    select generate_series(p_from, p_to, interval '1 day')::date as event_date
  ),
  totals as (
    select
      e.event_date,
      sum(e.amount) filter (where e.event_type = 'AMAZON_SETTLEMENT') as amazon_disbursed,
      sum(e.amount) filter (where e.event_type = 'INDIFI_VIRTUAL_RECEIPT') as indifi_virtual_received,
      sum(e.amount) filter (where e.event_type = 'INDIFI_RELEASE_TO_BANK') as indifi_out_to_bank,
      sum(e.amount) filter (where e.event_type = 'BANK_CREDIT') as bank_credits
    from public.erp_settlement_events e
    where e.company_id = public.erp_current_company_id()
      and e.is_void = false
      and e.event_date between p_from and p_to
    group by e.event_date
  )
  select
    d.event_date,
    coalesce(t.amazon_disbursed, 0) as amazon_disbursed,
    coalesce(t.indifi_virtual_received, 0) as indifi_virtual_received,
    coalesce(t.indifi_out_to_bank, 0) as indifi_out_to_bank,
    coalesce(t.bank_credits, 0) as bank_credits,
    coalesce(t.amazon_disbursed, 0) <> coalesce(t.indifi_virtual_received, 0) as mismatch_amazon_indifi,
    coalesce(t.indifi_out_to_bank, 0) <> coalesce(t.bank_credits, 0) as mismatch_indifi_bank
  from dates d
  left join totals t on t.event_date = d.event_date
  order by d.event_date desc;
end;
$$;

revoke all on function public.erp_settlement_daily_matrix(date, date) from public;
grant execute on function public.erp_settlement_daily_matrix(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Reconcile RPC (Phase-1: compute-only, no auto-link)
-- ---------------------------------------------------------------------

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
  v_mismatch_count integer := 0;
begin
  perform public.erp_require_finance_writer();

  select count(*)
    into v_mismatch_count
  from public.erp_settlement_daily_matrix(p_from, p_to) t
  where t.mismatch_amazon_indifi = true
     or t.mismatch_indifi_bank = true;

  return jsonb_build_object(
    'ok', true,
    'mismatch_days', v_mismatch_count
  );
end;
$$;

revoke all on function public.erp_settlement_reconcile_run(date, date) from public;
grant execute on function public.erp_settlement_reconcile_run(date, date) to authenticated;
