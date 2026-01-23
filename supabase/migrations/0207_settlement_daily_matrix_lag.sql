-- ---------------------------------------------------------------------
-- Lag-aware settlement matrix helpers
-- ---------------------------------------------------------------------

create or replace function public.erp_next_working_day(
  p_day date,
  p_n int default 1
) returns date
language plpgsql
immutable
as $$
declare
  v_day date := p_day;
  v_remaining int := coalesce(p_n, 1);
begin
  if v_remaining <= 0 then
    return v_day;
  end if;

  while v_remaining > 0 loop
    v_day := v_day + 1;
    if extract(isodow from v_day) between 1 and 5 then
      v_remaining := v_remaining - 1;
    end if;
  end loop;

  return v_day;
end;
$$;

revoke all on function public.erp_next_working_day(date, int) from public;
grant execute on function public.erp_next_working_day(date, int) to authenticated;

create or replace function public.erp_settlement_daily_matrix_lag(
  p_from date,
  p_to date,
  p_lag_working_days int default 1
) returns table (
  base_date date,
  compare_date date,
  amazon_disbursed numeric,
  indifi_virtual_received_on_compare_date numeric,
  indifi_out_to_bank numeric,
  bank_credits_on_compare_date numeric,
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
    select generate_series(p_from, p_to, interval '1 day')::date as base_date
  ),
  compare_dates as (
    select
      d.base_date,
      public.erp_next_working_day(d.base_date, coalesce(p_lag_working_days, 1)) as compare_date
    from dates d
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
      and e.event_date between p_from and (p_to + interval '10 days')
    group by e.event_date
  )
  select
    c.base_date,
    c.compare_date,
    coalesce(base_totals.amazon_disbursed, 0) as amazon_disbursed,
    coalesce(compare_totals.indifi_virtual_received, 0) as indifi_virtual_received_on_compare_date,
    coalesce(base_totals.indifi_out_to_bank, 0) as indifi_out_to_bank,
    coalesce(compare_totals.bank_credits, 0) as bank_credits_on_compare_date,
    coalesce(base_totals.amazon_disbursed, 0) <> coalesce(compare_totals.indifi_virtual_received, 0) as mismatch_amazon_indifi,
    coalesce(base_totals.indifi_out_to_bank, 0) <> coalesce(compare_totals.bank_credits, 0) as mismatch_indifi_bank
  from compare_dates c
  left join totals base_totals on base_totals.event_date = c.base_date
  left join totals compare_totals on compare_totals.event_date = c.compare_date
  order by c.base_date desc;
end;
$$;

revoke all on function public.erp_settlement_daily_matrix_lag(date, date, int) from public;
grant execute on function public.erp_settlement_daily_matrix_lag(date, date, int) to authenticated;
