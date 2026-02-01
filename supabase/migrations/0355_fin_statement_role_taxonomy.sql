-- 0355_fin_statement_role_taxonomy.sql
-- Finance Intelligence v1 (statement taxonomy + reporting RPCs)

create table if not exists public.erp_fin_role_taxonomy (
  role text primary key,
  statement_section text not null,
  statement_group text not null,
  statement_subgroup text null,
  normal_balance text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);

alter table public.erp_fin_role_taxonomy
  add constraint erp_fin_role_taxonomy_section_check
  check (statement_section in ('pnl', 'bs', 'cashflow'));

alter table public.erp_fin_role_taxonomy
  add constraint erp_fin_role_taxonomy_normal_balance_check
  check (normal_balance in ('debit', 'credit'));

create index if not exists erp_fin_role_taxonomy_section_idx
  on public.erp_fin_role_taxonomy (statement_section, statement_group, sort_order);

alter table public.erp_fin_role_taxonomy enable row level security;
alter table public.erp_fin_role_taxonomy force row level security;

do $$
begin
  drop policy if exists erp_fin_role_taxonomy_select on public.erp_fin_role_taxonomy;
  drop policy if exists erp_fin_role_taxonomy_write on public.erp_fin_role_taxonomy;

  create policy erp_fin_role_taxonomy_select
    on public.erp_fin_role_taxonomy
    for select
    using (
      auth.role() = 'service_role'
      or exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_fin_role_taxonomy_write
    on public.erp_fin_role_taxonomy
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
end;
$$;

insert into public.erp_fin_role_taxonomy (role, statement_section, statement_group, statement_subgroup, normal_balance, sort_order)
values
  ('bank_main', 'bs', 'asset', 'cash', 'debit', 10),
  ('vendor_payable', 'bs', 'liability', 'trade_payable', 'credit', 20),
  ('vendor_advance', 'bs', 'asset', 'advances', 'debit', 30),
  ('inventory_asset', 'bs', 'asset', 'inventory', 'debit', 40),
  ('gateway_clearing', 'bs', 'asset', 'clearing', 'debit', 50),
  ('input_gst_cgst', 'bs', 'asset', 'input_gst', 'debit', 60),
  ('input_gst_sgst', 'bs', 'asset', 'input_gst', 'debit', 61),
  ('input_gst_igst', 'bs', 'asset', 'input_gst', 'debit', 62),
  ('gst_payable', 'bs', 'liability', 'gst_payable', 'credit', 70),
  ('fixed_asset', 'bs', 'asset', 'fixed_asset', 'debit', 80),
  ('loan_payable', 'bs', 'liability', 'loan_payable', 'credit', 90),
  ('equity_capital', 'bs', 'equity', 'capital', 'credit', 100),
  ('sales_revenue', 'pnl', 'revenue', 'sales', 'credit', 110),
  ('cogs_inventory', 'pnl', 'cogs', 'inventory', 'debit', 120),
  ('operating_expense', 'pnl', 'expense', 'operating', 'debit', 130),
  ('other_income', 'pnl', 'other_income', 'other_income', 'credit', 140),
  ('interest_income', 'pnl', 'interest', 'interest', 'credit', 150),
  ('depreciation_expense', 'pnl', 'depreciation', 'depreciation', 'debit', 160)
on conflict (role) do update
set statement_section = excluded.statement_section,
    statement_group = excluded.statement_group,
    statement_subgroup = excluded.statement_subgroup,
    normal_balance = excluded.normal_balance,
    sort_order = excluded.sort_order,
    is_active = true;

create or replace function public.erp_fin_role_taxonomy_list(
  p_company_id uuid
) returns table(
  role text,
  statement_section text,
  statement_group text,
  statement_subgroup text,
  normal_balance text,
  is_active boolean,
  sort_order int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    t.role,
    t.statement_section,
    t.statement_group,
    t.statement_subgroup,
    t.normal_balance,
    t.is_active,
    t.sort_order
  from public.erp_fin_role_taxonomy t
  order by t.statement_section, t.sort_order, t.statement_group, t.statement_subgroup;
end;
$$;

revoke all on function public.erp_fin_role_taxonomy_list(uuid) from public;
grant execute on function public.erp_fin_role_taxonomy_list(uuid) to authenticated;

create or replace function public.erp_fin_default_reporting_period(
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiscal_year text;
  v_period_month int;
  v_start_year int;
  v_month int;
  v_year int;
  v_start_date date;
  v_end_date date;
  v_locked record;
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  select l.fiscal_year, l.period_month
    into v_locked
    from public.erp_fin_period_locks l
   where l.company_id = p_company_id
     and l.is_locked = true
   order by substring(l.fiscal_year from 3 for 2)::int desc, l.period_month desc
   limit 1;

  if v_locked.fiscal_year is not null then
    v_fiscal_year := v_locked.fiscal_year;
    v_period_month := v_locked.period_month;

    v_start_year := 2000 + substring(v_fiscal_year from 3 for 2)::int;
    if v_period_month <= 9 then
      v_month := v_period_month + 3;
      v_year := v_start_year;
    else
      v_month := v_period_month - 9;
      v_year := v_start_year + 1;
    end if;

    v_start_date := make_date(v_year, v_month, 1);
    v_end_date := (date_trunc('month', v_start_date) + interval '1 month - 1 day')::date;
  else
    v_start_date := date_trunc('month', current_date)::date;
    v_end_date := current_date;
    v_fiscal_year := public.erp_fiscal_year(v_start_date);
    v_period_month := public.erp_fiscal_period_month(v_start_date);
  end if;

  return jsonb_build_object(
    'from_date', v_start_date,
    'to_date', v_end_date,
    'fiscal_year', v_fiscal_year,
    'period_month', v_period_month
  );
end;
$$;

revoke all on function public.erp_fin_default_reporting_period(uuid) from public;
grant execute on function public.erp_fin_default_reporting_period(uuid) to authenticated;

create or replace function public.erp_fin_period_status(
  p_company_id uuid,
  p_posting_date date
) returns table(
  is_locked boolean,
  fiscal_year text,
  period_month int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    public.erp_fin_period_is_locked(p_company_id, p_posting_date),
    public.erp_fiscal_year(p_posting_date),
    public.erp_fiscal_period_month(p_posting_date);
end;
$$;

revoke all on function public.erp_fin_period_status(uuid, date) from public;
grant execute on function public.erp_fin_period_status(uuid, date) to authenticated;

create or replace function public.erp_fin_pnl(
  p_company_id uuid,
  p_from date,
  p_to date
) returns table(
  statement_group text,
  statement_subgroup text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  -- Pattern matches finance ledger reports v1: join journal lines to GL accounts by account_code.
  return query
  with base_lines as (
    select
      l.debit,
      l.credit,
      l.account_code
    from public.erp_fin_journal_lines l
    join public.erp_fin_journals j
      on j.id = l.journal_id
     and j.company_id = l.company_id
    where j.company_id = p_company_id
      and j.status <> 'void'
      and j.journal_date between p_from and p_to
  ), mapped as (
    select
      t.statement_group,
      t.statement_subgroup,
      t.normal_balance,
      t.sort_order,
      l.debit,
      l.credit
    from base_lines l
    join public.erp_gl_accounts a
      on a.company_id = p_company_id
     and a.code = l.account_code
    join public.erp_fin_role_taxonomy t
      on t.role = a.control_role
     and t.statement_section = 'pnl'
     and t.is_active
  )
  select
    m.statement_group,
    m.statement_subgroup,
    sum(
      case
        when m.normal_balance = 'credit' then m.credit - m.debit
        else m.debit - m.credit
      end
    ) as amount
  from mapped m
  group by m.statement_group, m.statement_subgroup
  order by min(m.sort_order), m.statement_group, m.statement_subgroup;
end;
$$;

revoke all on function public.erp_fin_pnl(uuid, date, date) from public;
grant execute on function public.erp_fin_pnl(uuid, date, date) to authenticated;

create or replace function public.erp_fin_pnl_drilldown(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_statement_group text,
  p_statement_subgroup text default null
) returns table(
  posting_date date,
  journal_id uuid,
  journal_number text,
  description text,
  account_id uuid,
  debit numeric,
  credit numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    j.journal_date as posting_date,
    j.id as journal_id,
    j.doc_no as journal_number,
    coalesce(l.description, j.narration) as description,
    a.id as account_id,
    l.debit,
    l.credit
  from public.erp_fin_journal_lines l
  join public.erp_fin_journals j
    on j.id = l.journal_id
   and j.company_id = l.company_id
  join public.erp_gl_accounts a
    on a.company_id = j.company_id
   and a.code = l.account_code
  join public.erp_fin_role_taxonomy t
    on t.role = a.control_role
   and t.statement_section = 'pnl'
   and t.is_active
  where j.company_id = p_company_id
    and j.status <> 'void'
    and j.journal_date between p_from and p_to
    and t.statement_group = p_statement_group
    and (p_statement_subgroup is null or t.statement_subgroup = p_statement_subgroup)
  order by j.journal_date, j.doc_no, l.id;
end;
$$;

revoke all on function public.erp_fin_pnl_drilldown(uuid, date, date, text, text) from public;
grant execute on function public.erp_fin_pnl_drilldown(uuid, date, date, text, text) to authenticated;

create or replace function public.erp_fin_balance_sheet(
  p_company_id uuid,
  p_as_of date
) returns table(
  statement_group text,
  statement_subgroup text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  -- Pattern matches finance ledger reports v1: join journal lines to GL accounts by account_code.
  return query
  with base_lines as (
    select
      l.debit,
      l.credit,
      l.account_code
    from public.erp_fin_journal_lines l
    join public.erp_fin_journals j
      on j.id = l.journal_id
     and j.company_id = l.company_id
    where j.company_id = p_company_id
      and j.status <> 'void'
      and j.journal_date <= p_as_of
  ), mapped as (
    select
      t.statement_group,
      t.statement_subgroup,
      t.normal_balance,
      t.sort_order,
      l.debit,
      l.credit
    from base_lines l
    join public.erp_gl_accounts a
      on a.company_id = p_company_id
     and a.code = l.account_code
    join public.erp_fin_role_taxonomy t
      on t.role = a.control_role
     and t.statement_section = 'bs'
     and t.is_active
  )
  select
    m.statement_group,
    m.statement_subgroup,
    sum(
      case
        when m.normal_balance = 'credit' then m.credit - m.debit
        else m.debit - m.credit
      end
    ) as amount
  from mapped m
  group by m.statement_group, m.statement_subgroup
  order by min(m.sort_order), m.statement_group, m.statement_subgroup;
end;
$$;

revoke all on function public.erp_fin_balance_sheet(uuid, date) from public;
grant execute on function public.erp_fin_balance_sheet(uuid, date) to authenticated;

create or replace function public.erp_fin_balance_sheet_drilldown(
  p_company_id uuid,
  p_as_of date,
  p_statement_group text,
  p_statement_subgroup text default null
) returns table(
  posting_date date,
  journal_id uuid,
  journal_number text,
  description text,
  account_id uuid,
  debit numeric,
  credit numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    j.journal_date as posting_date,
    j.id as journal_id,
    j.doc_no as journal_number,
    coalesce(l.description, j.narration) as description,
    a.id as account_id,
    l.debit,
    l.credit
  from public.erp_fin_journal_lines l
  join public.erp_fin_journals j
    on j.id = l.journal_id
   and j.company_id = l.company_id
  join public.erp_gl_accounts a
    on a.company_id = j.company_id
   and a.code = l.account_code
  join public.erp_fin_role_taxonomy t
    on t.role = a.control_role
   and t.statement_section = 'bs'
   and t.is_active
  where j.company_id = p_company_id
    and j.status <> 'void'
    and j.journal_date <= p_as_of
    and t.statement_group = p_statement_group
    and (p_statement_subgroup is null or t.statement_subgroup = p_statement_subgroup)
  order by j.journal_date, j.doc_no, l.id;
end;
$$;

revoke all on function public.erp_fin_balance_sheet_drilldown(uuid, date, text, text) from public;
grant execute on function public.erp_fin_balance_sheet_drilldown(uuid, date, text, text) to authenticated;

create or replace function public.erp_fin_cash_flow(
  p_company_id uuid,
  p_from date,
  p_to date
) returns table(
  cashflow_group text,
  cashflow_subgroup text,
  cash_in numeric,
  cash_out numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  with bank_journals as (
    select distinct j.id
    from public.erp_fin_journals j
    join public.erp_fin_journal_lines l
      on l.journal_id = j.id
     and l.company_id = j.company_id
    join public.erp_gl_accounts a
      on a.company_id = j.company_id
     and a.code = l.account_code
    where j.company_id = p_company_id
      and j.status <> 'void'
      and j.journal_date between p_from and p_to
      and a.control_role = 'bank_main'
  ), counterpart as (
    select
      l.debit,
      l.credit,
      a.control_role,
      t.statement_section,
      t.statement_subgroup
    from bank_journals bj
    join public.erp_fin_journals j
      on j.id = bj.id
    join public.erp_fin_journal_lines l
      on l.journal_id = j.id
     and l.company_id = j.company_id
    join public.erp_gl_accounts a
      on a.company_id = j.company_id
     and a.code = l.account_code
    left join public.erp_fin_role_taxonomy t
      on t.role = a.control_role
     and t.is_active
    where a.control_role is distinct from 'bank_main'
  ), classified as (
    select
      case
        when statement_section = 'pnl' then 'operating'
        when control_role in (
          'inventory_asset',
          'vendor_payable',
          'vendor_advance',
          'input_gst_cgst',
          'input_gst_sgst',
          'input_gst_igst',
          'gst_payable',
          'gateway_clearing'
        ) then 'operating'
        when control_role = 'fixed_asset' then 'investing'
        when control_role in ('loan_payable', 'equity_capital') then 'financing'
        else 'unclassified'
      end as cashflow_group,
      coalesce(statement_subgroup, control_role, 'unclassified') as cashflow_subgroup,
      -1 * (debit - credit) as cash_amount
    from counterpart
  )
  select
    c.cashflow_group,
    c.cashflow_subgroup,
    sum(case when c.cash_amount > 0 then c.cash_amount else 0 end) as cash_in,
    sum(case when c.cash_amount < 0 then abs(c.cash_amount) else 0 end) as cash_out
  from classified c
  group by c.cashflow_group, c.cashflow_subgroup
  order by c.cashflow_group, c.cashflow_subgroup;
end;
$$;

revoke all on function public.erp_fin_cash_flow(uuid, date, date) from public;
grant execute on function public.erp_fin_cash_flow(uuid, date, date) to authenticated;

create or replace function public.erp_fin_cash_flow_drilldown(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_cashflow_group text,
  p_cashflow_subgroup text
) returns table(
  posting_date date,
  journal_id uuid,
  journal_number text,
  description text,
  bank_amount numeric,
  counterparty_role text,
  counterparty_account_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  with bank_journals as (
    select distinct j.id
    from public.erp_fin_journals j
    join public.erp_fin_journal_lines l
      on l.journal_id = j.id
     and l.company_id = j.company_id
    join public.erp_gl_accounts a
      on a.company_id = j.company_id
     and a.code = l.account_code
    where j.company_id = p_company_id
      and j.status <> 'void'
      and j.journal_date between p_from and p_to
      and a.control_role = 'bank_main'
  ), counterpart as (
    select
      j.journal_date,
      j.id as journal_id,
      j.doc_no,
      coalesce(l.description, j.narration) as description,
      a.control_role,
      a.id as account_id,
      t.statement_section,
      t.statement_subgroup,
      -1 * (l.debit - l.credit) as cash_amount
    from bank_journals bj
    join public.erp_fin_journals j
      on j.id = bj.id
    join public.erp_fin_journal_lines l
      on l.journal_id = j.id
     and l.company_id = j.company_id
    join public.erp_gl_accounts a
      on a.company_id = j.company_id
     and a.code = l.account_code
    left join public.erp_fin_role_taxonomy t
      on t.role = a.control_role
     and t.is_active
    where a.control_role is distinct from 'bank_main'
  ), classified as (
    select
      journal_date,
      journal_id,
      doc_no,
      description,
      account_id,
      control_role,
      cash_amount,
      case
        when statement_section = 'pnl' then 'operating'
        when control_role in (
          'inventory_asset',
          'vendor_payable',
          'vendor_advance',
          'input_gst_cgst',
          'input_gst_sgst',
          'input_gst_igst',
          'gst_payable',
          'gateway_clearing'
        ) then 'operating'
        when control_role = 'fixed_asset' then 'investing'
        when control_role in ('loan_payable', 'equity_capital') then 'financing'
        else 'unclassified'
      end as cashflow_group,
      coalesce(statement_subgroup, control_role, 'unclassified') as cashflow_subgroup
    from counterpart
  )
  select
    c.journal_date as posting_date,
    c.journal_id,
    c.doc_no as journal_number,
    c.description,
    c.cash_amount as bank_amount,
    c.control_role as counterparty_role,
    c.account_id as counterparty_account_id
  from classified c
  where c.cashflow_group = p_cashflow_group
    and c.cashflow_subgroup = p_cashflow_subgroup
  order by c.journal_date, c.journal_number;
end;
$$;

revoke all on function public.erp_fin_cash_flow_drilldown(uuid, date, date, text, text) from public;
grant execute on function public.erp_fin_cash_flow_drilldown(uuid, date, date, text, text) to authenticated;

create or replace function public.erp_fin_coa_control_roles_list()
returns table(
  role_key text,
  account_id uuid,
  account_code text,
  account_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with roles(role_key) as (
    values
      ('bank_main'),
      ('vendor_payable'),
      ('vendor_advance'),
      ('tds_payable'),
      ('input_gst_cgst'),
      ('input_gst_sgst'),
      ('input_gst_igst'),
      ('inventory_asset'),
      ('gateway_clearing'),
      ('gst_payable'),
      ('sales_revenue'),
      ('cogs_inventory'),
      ('operating_expense'),
      ('other_income'),
      ('interest_income'),
      ('depreciation_expense'),
      ('fixed_asset'),
      ('loan_payable'),
      ('equity_capital')
  )
  select
    r.role_key,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name
  from roles r
  left join public.erp_gl_accounts a
    on a.company_id = public.erp_current_company_id()
    and a.control_role = r.role_key
  order by r.role_key;
end;
$$;

create or replace function public.erp_fin_coa_control_role_set(
  p_role text,
  p_account_id uuid,
  p_is_control boolean default true
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := nullif(trim(lower(p_role)), '');
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_gl_accounts;
  v_allowed boolean := false;
  v_account_exists boolean := false;
begin
  perform public.erp_require_finance_writer();

  if v_role is null then
    raise exception 'control role is required';
  end if;

  v_allowed := v_role = any (array[
    'bank_main',
    'vendor_payable',
    'vendor_advance',
    'tds_payable',
    'input_gst_cgst',
    'input_gst_sgst',
    'input_gst_igst',
    'inventory_asset',
    'gateway_clearing',
    'gst_payable',
    'sales_revenue',
    'cogs_inventory',
    'operating_expense',
    'other_income',
    'interest_income',
    'depreciation_expense',
    'fixed_asset',
    'loan_payable',
    'equity_capital'
  ]);

  if not v_allowed then
    raise exception 'unsupported control role: %', v_role;
  end if;

  if p_account_id is null then
    raise exception 'account_id is required for role %', v_role;
  end if;

  select true
    into v_account_exists
    from public.erp_gl_accounts a
   where a.company_id = v_company_id
     and a.id = p_account_id;

  if not v_account_exists then
    raise exception 'account not found for role %', v_role;
  end if;

  update public.erp_gl_accounts
     set control_role = null,
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and control_role = v_role
     and id <> p_account_id;

  update public.erp_gl_accounts
     set control_role = v_role,
         is_control_account = coalesce(p_is_control, true),
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and id = p_account_id
  returning * into v_row;

  return v_row;
end;
$$;
