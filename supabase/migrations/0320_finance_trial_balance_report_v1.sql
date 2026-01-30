create or replace function public.erp_fin_trial_balance(
  p_from date,
  p_to date,
  p_include_void boolean default false,
  p_include_inactive boolean default false,
  p_q text default null
)
returns table(
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  normal_balance text,
  debit_total numeric,
  credit_total numeric,
  net numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    a.id as account_id,
    a.code as account_code,
    a.name as account_name,
    a.account_type,
    a.normal_balance,
    coalesce(sum(l.debit), 0) as debit_total,
    coalesce(sum(l.credit), 0) as credit_total,
    coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as net
  from public.erp_gl_accounts a
  left join (
    select
      l.account_code,
      l.company_id,
      l.debit,
      l.credit
    from public.erp_fin_journal_lines l
    join public.erp_fin_journals j
      on j.id = l.journal_id
      and j.company_id = l.company_id
      and j.journal_date between p_from and p_to
      and (p_include_void or j.status <> 'void')
    where j.company_id = public.erp_current_company_id()
  ) l
    on l.company_id = a.company_id
    and l.account_code = a.code
  where a.company_id = public.erp_current_company_id()
    and (p_include_inactive or a.is_active)
    and (
      p_q is null
      or a.code ilike ('%' || p_q || '%')
      or a.name ilike ('%' || p_q || '%')
    )
  group by a.id, a.code, a.name, a.account_type, a.normal_balance
  order by a.code;
end;
$$;

revoke all on function public.erp_fin_trial_balance(date, date, boolean, boolean, text) from public;
grant execute on function public.erp_fin_trial_balance(date, date, boolean, boolean, text) to authenticated;
