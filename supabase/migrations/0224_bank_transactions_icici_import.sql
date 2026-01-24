-- 0224_bank_transactions_icici_import.sql
-- Phase-2D-A: Bank transactions base + ICICI import RPC + list + void
-- Notes:
-- - Assumes finance gates exist from Phase-2C:
--     public.erp_require_finance_writer()
--     public.erp_require_finance_reader()
-- - No deletes; void instead
-- - RPC-only writes (no insert/update policies)

begin;

-- =========================
-- Table: erp_bank_transactions
-- =========================
create table if not exists public.erp_bank_transactions (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null default public.erp_current_company_id(),
  source text not null,
  account_ref text null,

  txn_date date not null,
  value_date date null,

  description text not null,
  reference_no text null,

  debit numeric not null default 0,
  credit numeric not null default 0,

  amount numeric generated always as (credit - debit) stored,

  balance numeric null,
  currency text not null default 'INR',

  dedupe_key text not null,

  raw_payload jsonb not null default '{}'::jsonb,

  import_batch_id uuid null,

  is_matched boolean not null default false,
  matched_entity_type text null,
  matched_entity_id uuid null,
  match_confidence text null,
  match_notes text null,

  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,

  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);

comment on table public.erp_bank_transactions is
'Bank statement transactions ingested from external sources (starting with ICICI). No deletes; void instead.';

-- =========================
-- Indexes
-- =========================
create index if not exists erp_bank_transactions_company_txn_date_idx
  on public.erp_bank_transactions(company_id, txn_date);

create index if not exists erp_bank_transactions_company_source_idx
  on public.erp_bank_transactions(company_id, source);

create index if not exists erp_bank_transactions_company_ref_idx
  on public.erp_bank_transactions(company_id, reference_no);

create index if not exists erp_bank_transactions_company_matched_idx
  on public.erp_bank_transactions(company_id, is_matched);

-- Unique dedupe key per company for active (not void) rows
-- Use DROP + CREATE to avoid DO blocks and to keep it deterministic.
drop index if exists public.erp_bank_transactions_company_dedupe_uq;
create unique index erp_bank_transactions_company_dedupe_uq
  on public.erp_bank_transactions(company_id, dedupe_key)
  where is_void = false;

-- =========================
-- RLS + Policy
-- =========================
alter table public.erp_bank_transactions enable row level security;

-- Deterministic policy creation (no DO): DROP IF EXISTS then CREATE
drop policy if exists erp_bank_transactions_select_company on public.erp_bank_transactions;

create policy erp_bank_transactions_select_company
on public.erp_bank_transactions
for select
to authenticated
using (company_id = public.erp_current_company_id());

-- =========================
-- Helper: parse numeric safely (commas, blanks, (123.45))
-- =========================
create or replace function public.erp_bank_parse_numeric(p_text text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_text is null then
    return 0;
  end if;

  v := btrim(p_text);

  if v = '' then
    return 0;
  end if;

  v := replace(v, ',', '');

  if left(v, 1) = '(' and right(v, 1) = ')' then
    v := '-' || substring(v from 2 for char_length(v) - 2);
  end if;

  return v::numeric;
exception when others then
  return 0;
end;
$$;

-- =========================
-- Helper: parse date formats (yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd-Mon-yyyy)
-- =========================
create or replace function public.erp_bank_parse_date(p_text text)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
  d date;
begin
  if p_text is null then
    return null;
  end if;

  v := btrim(p_text);
  if v = '' then
    return null;
  end if;

  -- ISO / implicit
  begin
    d := v::date;
    return d;
  exception when others then
    null;
  end;

  -- dd/mm/yyyy
  begin
    d := to_date(v, 'DD/MM/YYYY');
    return d;
  exception when others then
    null;
  end;

  -- dd-mm-yyyy
  begin
    d := to_date(v, 'DD-MM-YYYY');
    return d;
  exception when others then
    null;
  end;

  -- dd-Mon-yyyy (case-insensitive month)
  begin
    d := to_date(initcap(lower(v)), 'DD-Mon-YYYY');
    return d;
  exception when others then
    null;
  end;

  return null;
end;
$$;

-- =========================
-- RPC: Import ICICI rows (normalized JSONB array from UI)
-- Returns: { inserted, skipped, errors, error_rows }
-- =========================
drop function if exists public.erp_bank_txn_import_icici_csv(jsonb, text, text);

create function public.erp_bank_txn_import_icici_csv(
  p_rows jsonb,
  p_source text default 'icici',
  p_account_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_user_id uuid := auth.uid();

  v_inserted int := 0;
  v_skipped int := 0;
  v_errors int := 0;

  r jsonb;

  v_txn_date date;
  v_value_date date;
  v_desc text;
  v_ref text;
  v_debit numeric;
  v_credit numeric;
  v_balance numeric;
  v_currency text;
  v_raw jsonb;

  v_dedupe_key text;
  v_exists boolean;

  v_error_rows jsonb := '[]'::jsonb;
begin
  perform public.erp_require_finance_writer();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_txn_date := public.erp_bank_parse_date(r->>'txn_date');
      v_value_date := public.erp_bank_parse_date(r->>'value_date');

      v_desc := coalesce(nullif(btrim(r->>'description'), ''), '(no description)');
      v_ref := nullif(btrim(r->>'reference_no'), '');

      v_debit := public.erp_bank_parse_numeric(r->>'debit');
      v_credit := public.erp_bank_parse_numeric(r->>'credit');
      v_balance := public.erp_bank_parse_numeric(r->>'balance');

      v_currency := coalesce(nullif(btrim(r->>'currency'), ''), 'INR');

      v_raw := coalesce(r->'raw', '{}'::jsonb);

      if v_txn_date is null then
        raise exception 'Missing/invalid txn_date';
      end if;

      v_dedupe_key := md5(
        concat_ws('|',
          v_company_id::text,
          coalesce(p_source, 'icici'),
          v_txn_date::text,
          coalesce(v_desc, ''),
          coalesce(v_ref, ''),
          v_debit::text,
          v_credit::text,
          coalesce(v_balance::text, '')
        )
      );

      select exists(
        select 1
        from public.erp_bank_transactions t
        where t.company_id = v_company_id
          and t.dedupe_key = v_dedupe_key
          and t.is_void = false
      ) into v_exists;

      if v_exists then
        v_skipped := v_skipped + 1;
      else
        insert into public.erp_bank_transactions (
          company_id,
          source,
          account_ref,
          txn_date,
          value_date,
          description,
          reference_no,
          debit,
          credit,
          balance,
          currency,
          dedupe_key,
          raw_payload,
          created_by,
          updated_by
        ) values (
          v_company_id,
          coalesce(p_source, 'icici'),
          p_account_ref,
          v_txn_date,
          v_value_date,
          v_desc,
          v_ref,
          v_debit,
          v_credit,
          nullif(v_balance, 0),
          v_currency,
          v_dedupe_key,
          jsonb_build_object(
            'normalized', r,
            'raw', v_raw
          ),
          v_user_id,
          v_user_id
        );

        v_inserted := v_inserted + 1;
      end if;

    exception when others then
      v_errors := v_errors + 1;
      v_error_rows := v_error_rows || jsonb_build_array(
        jsonb_build_object(
          'row', r,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_rows', v_error_rows
  );
end;
$$;

-- =========================
-- RPC: List transactions (company-scoped)
-- =========================
drop function if exists public.erp_bank_txns_list(date, date, text);

create function public.erp_bank_txns_list(
  p_from date,
  p_to date,
  p_source text default null
)
returns table (
  id uuid,
  source text,
  account_ref text,
  txn_date date,
  value_date date,
  description text,
  reference_no text,
  debit numeric,
  credit numeric,
  amount numeric,
  balance numeric,
  currency text,
  is_matched boolean,
  matched_entity_type text,
  matched_entity_id uuid,
  match_confidence text,
  match_notes text,
  is_void boolean,
  void_reason text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.source,
    t.account_ref,
    t.txn_date,
    t.value_date,
    t.description,
    t.reference_no,
    t.debit,
    t.credit,
    t.amount,
    t.balance,
    t.currency,
    t.is_matched,
    t.matched_entity_type,
    t.matched_entity_id,
    t.match_confidence,
    t.match_notes,
    t.is_void,
    t.void_reason,
    t.created_at
  from public.erp_bank_transactions t
  where t.company_id = public.erp_current_company_id()
    and t.txn_date >= p_from
    and t.txn_date <= p_to
    and (p_source is null or t.source = p_source)
  order by t.txn_date desc, t.created_at desc;
$$;

-- =========================
-- RPC: Void a transaction (no deletes)
-- =========================
drop function if exists public.erp_bank_txn_void(uuid, text);

create function public.erp_bank_txn_void(
  p_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_user_id uuid := auth.uid();
  v_updated int;
begin
  perform public.erp_require_finance_writer();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.erp_bank_transactions t
  set
    is_void = true,
    void_reason = nullif(btrim(p_reason), ''),
    voided_at = now(),
    voided_by = v_user_id,
    updated_at = now(),
    updated_by = v_user_id
  where t.id = p_id
    and t.company_id = v_company_id
    and t.is_void = false;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- =========================
-- Grants
-- =========================
grant execute on function public.erp_bank_txn_import_icici_csv(jsonb, text, text) to authenticated;
grant execute on function public.erp_bank_txns_list(date, date, text) to authenticated;
grant execute on function public.erp_bank_txn_void(uuid, text) to authenticated;

commit;
