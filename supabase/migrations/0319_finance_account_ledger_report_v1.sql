-- Finance account ledger report v1 (updates to picklist + ledger RPCs)

-- Drop older signature to avoid ambiguity
drop function if exists public.erp_gl_accounts_picklist(text);

create or replace function public.erp_gl_accounts_picklist(
  p_q text default null,
  p_include_inactive boolean default false
)
returns table(
  id uuid,
  code text,
  name text,
  account_type text,
  normal_balance text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    a.id,
    a.code,
    a.name,
    a.account_type,
    a.normal_balance,
    a.is_active
  from public.erp_gl_accounts a
  where a.company_id = public.erp_current_company_id()
    and (p_include_inactive or a.is_active)
    and (
      p_q is null
      or a.code ilike ('%' || p_q || '%')
      or a.name ilike ('%' || p_q || '%')
    )
  order by a.code;
end;
$$;

revoke all on function public.erp_gl_accounts_picklist(text, boolean) from public;
grant execute on function public.erp_gl_accounts_picklist(text, boolean) to authenticated;


-- =========================================================
-- Account Ledger Statement
-- =========================================================

create or replace function public.erp_fin_account_ledger(
  p_account_id uuid,
  p_from date,
  p_to date,
  p_include_void boolean default false
)
returns table(
  journal_id uuid,
  doc_no text,
  journal_date date,
  status text,
  reference_type text,
  reference_id uuid,
  line_id uuid,
  memo text,
  debit numeric,
  credit numeric,
  net numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    j.id as journal_id,
    j.doc_no,
    j.journal_date,
    j.status as status,
    j.reference_type,
    j.reference_id,
    l.id as line_id,
    coalesce(l.description, j.narration) as memo,
    l.debit,
    l.credit,
    (l.debit - l.credit) as net,
    l.created_at as created_at
  from public.erp_fin_journal_lines l
  join public.erp_fin_journals j
    on j.id = l.journal_id
    and j.company_id = l.company_id
  join public.erp_gl_accounts a
    on a.company_id = l.company_id
    and a.code = l.account_code
  where j.company_id = public.erp_current_company_id()
    and l.company_id = public.erp_current_company_id()
    and a.company_id = public.erp_current_company_id()
    and a.id = p_account_id
    and j.journal_date between p_from and p_to
    and (p_include_void or j.status <> 'void')
  order by j.journal_date asc, j.doc_no asc, l.created_at asc, l.id asc;
end;
$$;

revoke all on function public.erp_fin_account_ledger(uuid, date, date, boolean) from public;
grant execute on function public.erp_fin_account_ledger(uuid, date, date, boolean) to authenticated;
