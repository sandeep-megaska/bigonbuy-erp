-- Payroll finance posting config (Phase 1 preview-only)

create table if not exists public.erp_payroll_finance_posting_config (
  company_id uuid primary key default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  salary_expense_account_id uuid null,
  payroll_payable_account_id uuid null,
  default_cost_center_id uuid null,
  updated_at timestamptz not null default now()
);

alter table public.erp_payroll_finance_posting_config enable row level security;
alter table public.erp_payroll_finance_posting_config force row level security;

do $$
begin
  drop policy if exists erp_payroll_finance_posting_config_select on public.erp_payroll_finance_posting_config;
  drop policy if exists erp_payroll_finance_posting_config_write on public.erp_payroll_finance_posting_config;

  create policy erp_payroll_finance_posting_config_select
    on public.erp_payroll_finance_posting_config
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
            and cu.role_key in ('owner', 'admin', 'finance', 'hr')
        )
      )
    );

  create policy erp_payroll_finance_posting_config_write
    on public.erp_payroll_finance_posting_config
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

create or replace function public.erp_payroll_finance_posting_config_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_config record;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = v_actor
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner', 'admin', 'finance', 'hr')
    )
  ) then
    raise exception 'Not authorized';
  end if;

  select
    salary_expense_account_id,
    payroll_payable_account_id,
    default_cost_center_id,
    updated_at
    into v_config
  from public.erp_payroll_finance_posting_config c
  where c.company_id = v_company_id;

  return jsonb_build_object(
    'company_id', v_company_id,
    'salary_expense_account_id', v_config.salary_expense_account_id,
    'payroll_payable_account_id', v_config.payroll_payable_account_id,
    'default_cost_center_id', v_config.default_cost_center_id,
    'updated_at', v_config.updated_at
  );
end;
$$;

revoke all on function public.erp_payroll_finance_posting_config_get() from public;
grant execute on function public.erp_payroll_finance_posting_config_get() to authenticated;

create or replace function public.erp_payroll_finance_posting_config_upsert(
  p_salary_expense_account_id uuid,
  p_payroll_payable_account_id uuid,
  p_default_cost_center_id uuid default null
) returns void
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

  insert into public.erp_payroll_finance_posting_config (
    company_id,
    salary_expense_account_id,
    payroll_payable_account_id,
    default_cost_center_id,
    updated_at
  ) values (
    v_company_id,
    p_salary_expense_account_id,
    p_payroll_payable_account_id,
    p_default_cost_center_id,
    now()
  )
  on conflict (company_id)
  do update set
    salary_expense_account_id = excluded.salary_expense_account_id,
    payroll_payable_account_id = excluded.payroll_payable_account_id,
    default_cost_center_id = excluded.default_cost_center_id,
    updated_at = now();
end;
$$;

revoke all on function public.erp_payroll_finance_posting_config_upsert(uuid, uuid, uuid) from public;
grant execute on function public.erp_payroll_finance_posting_config_upsert(uuid, uuid, uuid) to authenticated;

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
  v_is_finalized boolean := false;
  v_total_net numeric(14,2) := 0;
  v_total_earnings numeric(14,2) := 0;
  v_total_deductions numeric(14,2) := 0;
  v_config record;
  v_errors text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_can_post boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.erp_company_users cu
      where cu.company_id = v_company_id
        and cu.user_id = v_actor
        and coalesce(cu.is_active, true)
        and cu.role_key in ('owner', 'admin', 'finance', 'hr', 'payroll')
    )
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

  if not v_is_finalized then
    v_errors := array_append(v_errors, 'Payroll run must be finalized before posting.');
  end if;

  select
    coalesce(sum(coalesce(pi.net_pay, pi.gross - pi.deductions, 0)), 0),
    coalesce(sum(coalesce(pi.gross, 0)), 0),
    coalesce(sum(coalesce(pi.deductions, 0)), 0)
    into v_total_net, v_total_earnings, v_total_deductions
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.payroll_run_id = p_run_id;

  select
    salary_expense_account_id,
    payroll_payable_account_id,
    default_cost_center_id
    into v_config
  from public.erp_payroll_finance_posting_config c
  where c.company_id = v_company_id;

  if v_config.salary_expense_account_id is null then
    v_errors := array_append(v_errors, 'Salary expense account is not configured.');
  end if;

  if v_config.payroll_payable_account_id is null then
    v_errors := array_append(v_errors, 'Payroll payable account is not configured.');
  end if;

  if v_total_net <= 0 then
    v_errors := array_append(v_errors, 'Net pay total is zero; nothing to post.');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'side', 'debit',
      'account_id', v_config.salary_expense_account_id,
      'account_name', null,
      'amount', v_total_net,
      'memo', 'Salary expense'
    ),
    jsonb_build_object(
      'side', 'credit',
      'account_id', v_config.payroll_payable_account_id,
      'account_name', null,
      'amount', v_total_net,
      'memo', 'Payroll payable'
    )
  );

  v_can_post := v_is_finalized
    and v_config.salary_expense_account_id is not null
    and v_config.payroll_payable_account_id is not null
    and v_total_net > 0;

  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'year', v_run.year,
      'month', v_run.month,
      'status', v_run.status,
      'finalized_at', v_run.finalized_at
    ),
    'totals', jsonb_build_object(
      'net_pay', v_total_net,
      'earnings', v_total_earnings,
      'deductions', v_total_deductions
    ),
    'lines', v_lines,
    'errors', coalesce(to_jsonb(v_errors), '[]'::jsonb),
    'can_post', v_can_post
  );
end;
$$;

revoke all on function public.erp_payroll_finance_posting_preview(uuid) from public;
grant execute on function public.erp_payroll_finance_posting_preview(uuid) to authenticated;

notify pgrst, 'reload schema';
