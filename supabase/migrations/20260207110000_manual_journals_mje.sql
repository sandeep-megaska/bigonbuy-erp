-- Manual journals (MJE) support on canonical finance journal tables.

begin;

alter table public.erp_fin_journals
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists voided_by uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists reversal_of_journal_id uuid null references public.erp_fin_journals(id) on delete set null,
  add column if not exists client_key text;

create unique index if not exists erp_fin_journals_company_client_key_unique
  on public.erp_fin_journals (company_id, client_key)
  where client_key is not null;

create index if not exists erp_fin_journals_company_reference_date_idx
  on public.erp_fin_journals (company_id, reference_type, journal_date desc);

create or replace function public.erp_fin_manual_journal_create(
  p_company_id uuid,
  p_journal_date date,
  p_memo text,
  p_lines jsonb,
  p_currency text default null,
  p_client_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_effective_company_id uuid := coalesce(p_company_id, v_company_id);
  v_journal_id uuid;
  v_existing_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_line_count int := 0;
  v_line jsonb;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_account_code text;
  v_account_name text;
  v_line_memo text;
  v_line_no int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_effective_company_id is distinct from v_company_id and auth.role() <> 'service_role' then
    raise exception 'Company scope mismatch';
  end if;

  if p_journal_date is null then
    raise exception 'Journal date is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one journal line is required';
  end if;

  if p_client_key is not null and btrim(p_client_key) <> '' then
    select j.id
      into v_existing_id
      from public.erp_fin_journals j
      where j.company_id = v_effective_company_id
        and j.client_key = btrim(p_client_key)
      limit 1;

    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_count := v_line_count + 1;
    v_line_no := v_line_count;
    v_account_code := nullif(btrim(coalesce(v_line->>'account_code', '')), '');
    v_account_name := nullif(btrim(coalesce(v_line->>'account_name', '')), '');
    v_line_memo := nullif(btrim(coalesce(v_line->>'memo', v_line->>'description', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);

    if v_debit < 0 or v_credit < 0 then
      raise exception 'Line % has negative amount', v_line_no;
    end if;

    if (v_debit = 0 and v_credit = 0) or (v_debit > 0 and v_credit > 0) then
      raise exception 'Line % must contain either debit or credit amount', v_line_no;
    end if;

    if v_account_code is null and v_account_name is null then
      raise exception 'Line % requires account_code or account_name', v_line_no;
    end if;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must balance';
  end if;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    total_debit,
    total_credit,
    created_by,
    created_at,
    client_key
  ) values (
    v_effective_company_id,
    p_journal_date,
    'posted',
    nullif(btrim(p_memo), ''),
    'manual_journal',
    v_total_debit,
    v_total_credit,
    v_actor,
    now(),
    nullif(btrim(p_client_key), '')
  ) returning id into v_journal_id;

  v_line_no := 0;
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    v_account_code := nullif(btrim(coalesce(v_line->>'account_code', '')), '');
    v_account_name := nullif(btrim(coalesce(v_line->>'account_name', '')), '');
    v_line_memo := nullif(btrim(coalesce(v_line->>'memo', v_line->>'description', '')), '');
    v_debit := coalesce(nullif(v_line->>'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line->>'credit', '')::numeric, 0);

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
      v_effective_company_id,
      v_journal_id,
      v_line_no,
      v_account_code,
      v_account_name,
      v_line_memo,
      v_debit,
      v_credit
    );
  end loop;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_effective_company_id;

  return v_journal_id;
end;
$$;

revoke all on function public.erp_fin_manual_journal_create(uuid, date, text, jsonb, text, text) from public;
grant execute on function public.erp_fin_manual_journal_create(uuid, date, text, jsonb, text, text) to authenticated;

create or replace function public.erp_fin_manual_journal_void(
  p_company_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_void_date date default current_date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_effective_company_id uuid := coalesce(p_company_id, v_company_id);
  v_journal record;
  v_reversal_journal_id uuid;
  v_doc_no text;
  v_line record;
  v_reversal_total_debit numeric(14,2) := 0;
  v_reversal_total_credit numeric(14,2) := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_effective_company_id is distinct from v_company_id and auth.role() <> 'service_role' then
    raise exception 'Company scope mismatch';
  end if;

  select j.*
    into v_journal
    from public.erp_fin_journals j
    where j.company_id = v_effective_company_id
      and j.id = p_journal_id
    for update;

  if v_journal.id is null then
    raise exception 'Manual journal not found';
  end if;

  if v_journal.reference_type <> 'manual_journal' then
    raise exception 'Only manual journals can be voided';
  end if;

  if v_journal.status <> 'posted' then
    raise exception 'Only posted journals can be voided';
  end if;

  if v_journal.voided_at is not null then
    raise exception 'Journal is already voided';
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
    created_by,
    reversal_of_journal_id
  ) values (
    v_effective_company_id,
    coalesce(p_void_date, current_date),
    'posted',
    coalesce(nullif(btrim(p_reason), ''), 'Manual journal void reversal'),
    'manual_journal_reversal',
    v_journal.id,
    0,
    0,
    coalesce(v_actor, v_journal.created_by),
    v_journal.id
  ) returning id into v_reversal_journal_id;

  for v_line in
    select *
    from public.erp_fin_journal_lines l
    where l.company_id = v_effective_company_id
      and l.journal_id = v_journal.id
    order by l.line_no
  loop
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
      v_effective_company_id,
      v_reversal_journal_id,
      v_line.line_no,
      v_line.account_code,
      v_line.account_name,
      coalesce(v_line.description, 'Manual journal reversal'),
      v_line.credit,
      v_line.debit
    );

    v_reversal_total_debit := v_reversal_total_debit + coalesce(v_line.credit, 0);
    v_reversal_total_credit := v_reversal_total_credit + coalesce(v_line.debit, 0);
  end loop;

  if v_reversal_total_debit <> v_reversal_total_credit then
    raise exception 'Reversal journal totals must balance';
  end if;

  update public.erp_fin_journals
  set total_debit = v_reversal_total_debit,
      total_credit = v_reversal_total_credit
  where id = v_reversal_journal_id
    and company_id = v_effective_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_reversal_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_reversal_journal_id
    and company_id = v_effective_company_id;

  update public.erp_fin_journals
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = nullif(btrim(p_reason), '')
  where id = v_journal.id
    and company_id = v_effective_company_id;

  return v_reversal_journal_id;
end;
$$;

revoke all on function public.erp_fin_manual_journal_void(uuid, uuid, text, date) from public;
grant execute on function public.erp_fin_manual_journal_void(uuid, uuid, text, date) to authenticated;

create or replace function public.erp_fin_manual_journal_get(
  p_company_id uuid,
  p_journal_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_effective_company_id uuid := coalesce(p_company_id, v_company_id);
  v_header jsonb;
  v_lines jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_reader();
  end if;

  if v_effective_company_id is distinct from v_company_id and auth.role() <> 'service_role' then
    raise exception 'Company scope mismatch';
  end if;

  select to_jsonb(j)
    into v_header
    from (
      select
        j.id,
        j.doc_no,
        j.journal_date,
        j.status,
        j.narration,
        j.reference_type,
        j.reference_id,
        j.total_debit,
        j.total_credit,
        j.created_at,
        j.created_by,
        j.voided_at,
        j.voided_by,
        j.void_reason,
        j.reversal_of_journal_id
      from public.erp_fin_journals j
      where j.company_id = v_effective_company_id
        and j.id = p_journal_id
        and j.reference_type in ('manual_journal', 'manual_journal_reversal')
    ) j;

  if v_header is null then
    raise exception 'Manual journal not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]'::jsonb)
    into v_lines
    from (
      select
        l.id,
        l.line_no,
        l.account_code,
        l.account_name,
        l.description,
        l.debit,
        l.credit
      from public.erp_fin_journal_lines l
      where l.company_id = v_effective_company_id
        and l.journal_id = p_journal_id
      order by l.line_no
    ) l;

  return jsonb_build_object(
    'header', v_header,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.erp_fin_manual_journal_get(uuid, uuid) from public;
grant execute on function public.erp_fin_manual_journal_get(uuid, uuid) to authenticated;

commit;
