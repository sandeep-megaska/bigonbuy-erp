-- Payroll -> Finance bridge (journals + posting tracking)

-- ---------------------------------------------------------------------
-- Finance journals (minimal header + lines)
-- ---------------------------------------------------------------------

create table if not exists public.erp_fin_journals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  doc_no text null,
  journal_date date not null default current_date,
  status text not null default 'posted',
  narration text null,
  reference_type text null,
  reference_id uuid null,
  total_debit numeric(14,2) not null default 0,
  total_credit numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid()
);

alter table public.erp_fin_journals
  add constraint erp_fin_journals_status_check
  check (status in ('posted', 'void'));

create index if not exists erp_fin_journals_company_date_idx
  on public.erp_fin_journals (company_id, journal_date desc);

create index if not exists erp_fin_journals_company_reference_idx
  on public.erp_fin_journals (company_id, reference_type, reference_id);

create table if not exists public.erp_fin_journal_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  journal_id uuid not null references public.erp_fin_journals (id) on delete cascade,
  line_no int not null default 1,
  account_code text null,
  account_name text null,
  description text null,
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint erp_fin_journal_lines_amount_check check (
    debit >= 0
    and credit >= 0
    and (debit = 0 or credit = 0)
  )
);

create index if not exists erp_fin_journal_lines_company_idx
  on public.erp_fin_journal_lines (company_id, journal_id);

-- ---------------------------------------------------------------------
-- Payroll posting config (account placeholders)
-- ---------------------------------------------------------------------

create table if not exists public.erp_payroll_posting_config (
  company_id uuid primary key default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  salary_expense_account_code text null,
  salary_expense_account_name text null,
  payroll_payable_account_code text null,
  payroll_payable_account_name text null,
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid()
);

-- ---------------------------------------------------------------------
-- Payroll -> Finance posting tracking
-- ---------------------------------------------------------------------

create table if not exists public.erp_payroll_finance_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  payroll_run_id uuid not null references public.erp_payroll_runs (id) on delete restrict,
  finance_doc_type text not null,
  finance_doc_id uuid not null,
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null,
  meta jsonb not null default '{}'::jsonb,
  constraint erp_payroll_finance_posts_status_check check (status in ('posted', 'void'))
);

create unique index if not exists erp_payroll_finance_posts_company_run_key
  on public.erp_payroll_finance_posts (company_id, payroll_run_id);

create index if not exists erp_payroll_finance_posts_company_doc_idx
  on public.erp_payroll_finance_posts (company_id, finance_doc_type, finance_doc_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.erp_fin_journals enable row level security;
alter table public.erp_fin_journals force row level security;
alter table public.erp_fin_journal_lines enable row level security;
alter table public.erp_fin_journal_lines force row level security;
alter table public.erp_payroll_posting_config enable row level security;
alter table public.erp_payroll_posting_config force row level security;
alter table public.erp_payroll_finance_posts enable row level security;
alter table public.erp_payroll_finance_posts force row level security;

do $$
begin
  drop policy if exists erp_fin_journals_select on public.erp_fin_journals;
  drop policy if exists erp_fin_journals_write on public.erp_fin_journals;
  drop policy if exists erp_fin_journal_lines_select on public.erp_fin_journal_lines;
  drop policy if exists erp_fin_journal_lines_write on public.erp_fin_journal_lines;
  drop policy if exists erp_payroll_posting_config_select on public.erp_payroll_posting_config;
  drop policy if exists erp_payroll_posting_config_write on public.erp_payroll_posting_config;
  drop policy if exists erp_payroll_finance_posts_select on public.erp_payroll_finance_posts;
  drop policy if exists erp_payroll_finance_posts_write on public.erp_payroll_finance_posts;

  create policy erp_fin_journals_select
    on public.erp_fin_journals
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

  create policy erp_fin_journals_write
    on public.erp_fin_journals
    for all
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
    )
    with check (
      company_id = public.erp_current_company_id()
    );

  create policy erp_fin_journal_lines_select
    on public.erp_fin_journal_lines
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

  create policy erp_fin_journal_lines_write
    on public.erp_fin_journal_lines
    for all
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
    )
    with check (
      company_id = public.erp_current_company_id()
    );

  create policy erp_payroll_posting_config_select
    on public.erp_payroll_posting_config
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
            and cu.role_key in ('owner', 'admin', 'finance', 'hr', 'payroll')
        )
      )
    );

  create policy erp_payroll_posting_config_write
    on public.erp_payroll_posting_config
    for all
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
    )
    with check (
      company_id = public.erp_current_company_id()
    );

  create policy erp_payroll_finance_posts_select
    on public.erp_payroll_finance_posts
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
            and cu.role_key in ('owner', 'admin', 'finance', 'hr', 'payroll')
        )
      )
    );

  create policy erp_payroll_finance_posts_write
    on public.erp_payroll_finance_posts
    for all
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
    )
    with check (
      company_id = public.erp_current_company_id()
    );
end
$$;

-- ---------------------------------------------------------------------
-- Document numbering: allow journals (JRN)
-- ---------------------------------------------------------------------

create or replace function public.erp_doc_allocate_number(p_doc_id uuid, p_doc_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_key text := upper(trim(p_doc_key));
  v_doc_date date;
  v_fiscal_year text;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_doc_id is null then
    raise exception 'doc_id is required';
  end if;

  if v_doc_key = '' then
    raise exception 'doc_key is required';
  end if;

  case v_doc_key
    when 'PO' then
      select order_date
        into v_doc_date
        from public.erp_purchase_orders
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Purchase order not found';
      end if;
    when 'GRN' then
      select received_at::date
        into v_doc_date
        from public.erp_grns
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'GRN not found';
      end if;
    when 'CN', 'DN' then
      select note_date
        into v_doc_date
        from public.erp_notes
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Note not found';
      end if;
    when 'JRN' then
      select journal_date
        into v_doc_date
        from public.erp_fin_journals
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Journal not found';
      end if;
    else
      raise exception 'Unsupported document key: %', v_doc_key;
  end case;

  if v_doc_date is null then
    v_doc_date := current_date;
  end if;

  v_fiscal_year := public.erp_fiscal_year(v_doc_date);

  insert into public.erp_doc_sequences (company_id, fiscal_year, doc_key, next_seq)
  values (v_company_id, v_fiscal_year, v_doc_key, 1)
  on conflict (company_id, fiscal_year, doc_key) do nothing;

  select next_seq
    into v_seq
    from public.erp_doc_sequences
    where company_id = v_company_id
      and fiscal_year = v_fiscal_year
      and doc_key = v_doc_key
    for update;

  update public.erp_doc_sequences
  set next_seq = next_seq + 1
  where company_id = v_company_id
    and fiscal_year = v_fiscal_year
    and doc_key = v_doc_key;

  return v_fiscal_year || '/' || v_doc_key || '/' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_doc_allocate_number(uuid, text) from public;
grant execute on function public.erp_doc_allocate_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Payroll -> Finance posting RPCs
-- ---------------------------------------------------------------------

create or replace function public.erp_payroll_posting_config_upsert(
  p_salary_expense_account_code text,
  p_salary_expense_account_name text,
  p_payroll_payable_account_code text,
  p_payroll_payable_account_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  insert into public.erp_payroll_posting_config (
    company_id,
    salary_expense_account_code,
    salary_expense_account_name,
    payroll_payable_account_code,
    payroll_payable_account_name,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    nullif(trim(p_salary_expense_account_code), ''),
    nullif(trim(p_salary_expense_account_name), ''),
    nullif(trim(p_payroll_payable_account_code), ''),
    nullif(trim(p_payroll_payable_account_name), ''),
    now(),
    auth.uid()
  )
  on conflict (company_id)
  do update set
    salary_expense_account_code = excluded.salary_expense_account_code,
    salary_expense_account_name = excluded.salary_expense_account_name,
    payroll_payable_account_code = excluded.payroll_payable_account_code,
    payroll_payable_account_name = excluded.payroll_payable_account_name,
    updated_at = now(),
    updated_by = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.erp_payroll_posting_config_upsert(text, text, text, text) from public;
grant execute on function public.erp_payroll_posting_config_upsert(text, text, text, text) to authenticated;

create or replace function public.erp_payroll_finance_posting_preview(
  p_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_run record;
  v_already_posted boolean := false;
  v_existing_doc_id uuid;
  v_total_net numeric(14,2) := 0;
  v_employee_count int := 0;
  v_is_finalized boolean := false;
  v_config record;
  v_missing_config boolean := false;
  v_lines jsonb := '[]'::jsonb;
  v_debit numeric(14,2) := 0;
  v_credit numeric(14,2) := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  select r.id, r.year, r.month, r.status, r.finalized_at
    into v_run
    from public.erp_payroll_runs r
   where r.id = p_run_id
     and r.company_id = v_company_id;

  if v_run.id is null then
    raise exception 'Payroll run not found';
  end if;

  v_is_finalized := public.erp_payroll_run_is_finalized(p_run_id);

  select p.finance_doc_id
    into v_existing_doc_id
    from public.erp_payroll_finance_posts p
    where p.company_id = v_company_id
      and p.payroll_run_id = p_run_id;

  v_already_posted := v_existing_doc_id is not null;

  select
    coalesce(sum(coalesce(pi.net_pay, pi.gross - pi.deductions, 0)), 0),
    count(*)::int
    into v_total_net, v_employee_count
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_run_id;

  select
    salary_expense_account_code,
    salary_expense_account_name,
    payroll_payable_account_code,
    payroll_payable_account_name
    into v_config
  from public.erp_payroll_posting_config c
  where c.company_id = v_company_id;

  v_missing_config := v_config.salary_expense_account_name is null
    or v_config.payroll_payable_account_name is null;

  v_debit := v_total_net;
  v_credit := v_total_net;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'line_no', 1,
      'account_code', coalesce(v_config.salary_expense_account_code, ''),
      'account_name', coalesce(v_config.salary_expense_account_name, 'Salary Expense'),
      'debit', v_debit,
      'credit', 0
    ),
    jsonb_build_object(
      'line_no', 2,
      'account_code', coalesce(v_config.payroll_payable_account_code, ''),
      'account_name', coalesce(v_config.payroll_payable_account_name, 'Payroll Payable'),
      'debit', 0,
      'credit', v_credit
    )
  );

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'year', v_run.year,
      'month', v_run.month,
      'status', v_run.status,
      'finalized_at', v_run.finalized_at
    ),
    'totals', jsonb_build_object(
      'employee_count', v_employee_count,
      'total_net_pay', v_total_net,
      'debit_total', v_debit,
      'credit_total', v_credit
    ),
    'lines', v_lines,
    'validation', jsonb_build_object(
      'is_finalized', v_is_finalized,
      'already_posted', v_already_posted,
      'finance_doc_id', v_existing_doc_id,
      'missing_config', v_missing_config,
      'can_post', v_is_finalized and not v_already_posted and not v_missing_config
    )
  );
end;
$$;

revoke all on function public.erp_payroll_finance_posting_preview(uuid) from public;
grant execute on function public.erp_payroll_finance_posting_preview(uuid) to authenticated;

create or replace function public.erp_payroll_finance_post(
  p_run_id uuid,
  p_post_date date default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_run record;
  v_existing_doc_id uuid;
  v_total_net numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_config record;
  v_post_date date := coalesce(p_post_date, current_date);
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select r.id, r.year, r.month, r.status
    into v_run
    from public.erp_payroll_runs r
    where r.id = p_run_id
      and r.company_id = v_company_id
    for update;

  if v_run.id is null then
    raise exception 'Payroll run not found';
  end if;

  if not public.erp_payroll_run_is_finalized(p_run_id) then
    raise exception 'Payroll run must be finalized before posting';
  end if;

  select p.finance_doc_id
    into v_existing_doc_id
    from public.erp_payroll_finance_posts p
    where p.company_id = v_company_id
      and p.payroll_run_id = p_run_id;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    salary_expense_account_code,
    salary_expense_account_name,
    payroll_payable_account_code,
    payroll_payable_account_name
    into v_config
  from public.erp_payroll_posting_config c
  where c.company_id = v_company_id;

  if v_config.salary_expense_account_name is null
    or v_config.payroll_payable_account_name is null then
    raise exception 'Payroll posting config missing (accounts not configured)';
  end if;

  select
    coalesce(sum(coalesce(pi.net_pay, pi.gross - pi.deductions, 0)), 0)
    into v_total_net
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_run_id;

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    v_post_date,
    'posted',
    coalesce(p_notes, format('Payroll run %s-%s', v_run.year, lpad(v_run.month::text, 2, '0'))),
    'payroll_run',
    p_run_id,
    v_total_net,
    v_total_net,
    v_actor
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_config.salary_expense_account_code,
      v_config.salary_expense_account_name,
      'Salary Expense',
      v_total_net,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_config.payroll_payable_account_code,
      v_config.payroll_payable_account_name,
      'Payroll Payable',
      0,
      v_total_net
    );

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_payroll_finance_posts (
    company_id,
    payroll_run_id,
    finance_doc_type,
    finance_doc_id,
    status,
    posted_at,
    posted_by_user_id,
    meta
  ) values (
    v_company_id,
    p_run_id,
    'journal',
    v_journal_id,
    'posted',
    now(),
    v_actor,
    jsonb_build_object('journal_no', v_doc_no)
  );

  return v_journal_id;
end;
$$;

revoke all on function public.erp_payroll_finance_post(uuid, date, text) from public;
grant execute on function public.erp_payroll_finance_post(uuid, date, text) to authenticated;

create or replace function public.erp_payroll_finance_posting_get(
  p_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_post record;
  v_doc_no text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  select p.*, j.doc_no
    into v_post
    from public.erp_payroll_finance_posts p
    left join public.erp_fin_journals j
      on j.id = p.finance_doc_id
     and j.company_id = v_company_id
    where p.company_id = v_company_id
      and p.payroll_run_id = p_run_id;

  if v_post.id is null then
    return jsonb_build_object('posted', false);
  end if;

  v_doc_no := v_post.doc_no;

  return jsonb_build_object(
    'posted', true,
    'finance_doc_id', v_post.finance_doc_id,
    'finance_doc_type', v_post.finance_doc_type,
    'posted_at', v_post.posted_at,
    'posted_by_user_id', v_post.posted_by_user_id,
    'journal_no', v_doc_no,
    'link', format('/erp/finance/journals/%s', v_post.finance_doc_id)
  );
end;
$$;

revoke all on function public.erp_payroll_finance_posting_get(uuid) from public;
grant execute on function public.erp_payroll_finance_posting_get(uuid) to authenticated;

notify pgrst, 'reload schema';
