create table if not exists public.erp_payroll_payslips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  payroll_run_id uuid not null references public.erp_payroll_runs (id) on delete cascade,
  payroll_item_id uuid not null references public.erp_payroll_items (id) on delete cascade,
  employee_id uuid not null references public.erp_employees (id) on delete restrict,
  payslip_no text not null,
  period_year int not null,
  period_month int not null,
  status text not null default 'finalized',
  currency text null default 'INR',
  issued_at timestamptz not null default now(),
  issued_by uuid null,
  employee_name text null,
  employee_code text null,
  designation text null,
  department text null,
  bank_account_last4 text null,
  ctc_monthly numeric not null default 0,
  basic numeric not null default 0,
  hra numeric not null default 0,
  allowances numeric not null default 0,
  variable_earnings numeric not null default 0,
  deductions numeric not null default 0,
  gross numeric not null default 0,
  net_pay numeric not null default 0,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

alter table public.erp_payroll_payslips
  add constraint erp_payroll_payslips_status_check
  check (status in ('finalized', 'void'));

create unique index if not exists erp_payroll_payslips_company_run_item_key
  on public.erp_payroll_payslips (company_id, payroll_run_id, payroll_item_id);

create unique index if not exists erp_payroll_payslips_company_payslip_no_key
  on public.erp_payroll_payslips (company_id, payslip_no);

create index if not exists erp_payroll_payslips_employee_idx
  on public.erp_payroll_payslips (company_id, employee_id);

alter table public.erp_payroll_payslips enable row level security;
alter table public.erp_payroll_payslips force row level security;

do $$
begin
  drop policy if exists erp_payroll_payslips_select on public.erp_payroll_payslips;
  drop policy if exists erp_payroll_payslips_write on public.erp_payroll_payslips;

  create policy erp_payroll_payslips_select
    on public.erp_payroll_payslips
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.company_id = public.erp_current_company_id()
            and eu.employee_id = erp_payroll_payslips.employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_payroll_payslips_write
    on public.erp_payroll_payslips
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );
end
$$;

create table if not exists public.erp_payroll_payslip_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  payslip_id uuid not null references public.erp_payroll_payslips (id) on delete cascade,
  code text not null,
  name text null,
  units numeric null,
  rate numeric null,
  amount numeric not null default 0,
  line_type text not null default 'earning',
  created_at timestamptz not null default now()
);

alter table public.erp_payroll_payslip_lines
  add constraint erp_payroll_payslip_lines_type_check
  check (line_type in ('earning', 'deduction', 'info'));

create index if not exists erp_payroll_payslip_lines_company_idx
  on public.erp_payroll_payslip_lines (company_id, payslip_id);

alter table public.erp_payroll_payslip_lines enable row level security;
alter table public.erp_payroll_payslip_lines force row level security;

do $$
begin
  drop policy if exists erp_payroll_payslip_lines_select on public.erp_payroll_payslip_lines;
  drop policy if exists erp_payroll_payslip_lines_write on public.erp_payroll_payslip_lines;

  create policy erp_payroll_payslip_lines_select
    on public.erp_payroll_payslip_lines
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_payroll_payslips ps
          where ps.id = erp_payroll_payslip_lines.payslip_id
            and ps.company_id = public.erp_current_company_id()
            and (
              exists (
                select 1
                from public.erp_company_users cu
                where cu.company_id = public.erp_current_company_id()
                  and cu.user_id = auth.uid()
                  and coalesce(cu.is_active, true)
                  and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
              )
              or exists (
                select 1
                from public.erp_employee_users eu
                where eu.company_id = public.erp_current_company_id()
                  and eu.employee_id = ps.employee_id
                  and eu.user_id = auth.uid()
                  and coalesce(eu.is_active, true)
              )
            )
        )
      )
    );

  create policy erp_payroll_payslip_lines_write
    on public.erp_payroll_payslip_lines
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
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
        )
      )
    );
end
$$;

create table if not exists public.erp_payroll_payslip_seq (
  company_id uuid not null,
  year int not null,
  last_no int not null default 0,
  primary key (company_id, year)
);

create or replace function public.erp_next_payslip_no(p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_next_no int;
begin
  if v_company_id is null then
    raise exception 'Company context missing';
  end if;

  if p_year is null then
    raise exception 'p_year is required';
  end if;

  loop
    update public.erp_payroll_payslip_seq
      set last_no = last_no + 1
    where company_id = v_company_id
      and year = p_year
    returning last_no into v_next_no;

    if found then
      exit;
    end if;

    begin
      insert into public.erp_payroll_payslip_seq (company_id, year, last_no)
      values (v_company_id, p_year, 1)
      returning last_no into v_next_no;
      exit;
    exception when unique_violation then
      -- retry
    end;
  end loop;

  return 'PS-' || p_year || '-' || lpad(v_next_no::text, 4, '0');
end;
$$;

revoke all on function public.erp_next_payslip_no(int) from public;
grant execute on function public.erp_next_payslip_no(int) to authenticated;

create or replace function public.erp_payroll_run_finalize(p_payroll_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_year int;
  v_month int;
  v_month_start date;
  v_month_end date;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_run_id is null then
    raise exception 'payroll_run_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  select r.year, r.month
    into v_year, v_month
  from public.erp_payroll_runs r
  where r.id = p_payroll_run_id
    and r.company_id = v_company_id;

  if v_year is null then
    raise exception 'Payroll run not found';
  end if;

  update public.erp_payroll_runs r
  set status = 'finalized',
      finalized_at = now(),
      finalized_by = v_actor
  where r.id = p_payroll_run_id
    and r.company_id = v_company_id;

  v_month_start := make_date(v_year, v_month, 1);
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  with source_items as (
    select
      pi.id as payroll_item_id,
      pi.employee_id,
      coalesce(pi.salary_basic, 0) as salary_basic,
      coalesce(pi.salary_hra, 0) as salary_hra,
      coalesce(pi.salary_allowances, 0) as salary_allowances,
      coalesce(pi.deductions, 0) as deductions,
      coalesce(pi.gross, 0) as gross,
      coalesce(pi.net_pay, coalesce(pi.gross, 0) - coalesce(pi.deductions, 0)) as net_pay,
      pi.notes,
      e.full_name,
      e.employee_no,
      a.ctc_monthly,
      (
        select coalesce(sum(case when l.amount > 0 then l.amount else 0 end), 0)
        from public.erp_payroll_item_lines l
        where l.company_id = v_company_id
          and l.payroll_item_id = pi.id
          and l.code in ('OT', 'OT_NORMAL', 'OT_HOLIDAY', 'BONUS', 'INCENTIVE', 'COMMISSION', 'ARREAR', 'VARIABLE')
      ) as variable_earnings
    from public.erp_payroll_items pi
    join public.erp_employees e
      on e.id = pi.employee_id
     and e.company_id = v_company_id
    left join lateral (
      select a.ctc_monthly
      from public.erp_employee_salary_assignments a
      where a.company_id = v_company_id
        and a.employee_id = pi.employee_id
        and a.effective_from <= v_month_end
        and (a.effective_to is null or a.effective_to >= v_month_start)
      order by a.effective_from desc
      limit 1
    ) a on true
    where pi.company_id = v_company_id
      and pi.payroll_run_id = p_payroll_run_id
  ),
  inserted as (
    insert into public.erp_payroll_payslips (
      company_id,
      payroll_run_id,
      payroll_item_id,
      employee_id,
      payslip_no,
      period_year,
      period_month,
      status,
      issued_at,
      issued_by,
      employee_name,
      employee_code,
      ctc_monthly,
      basic,
      hra,
      allowances,
      variable_earnings,
      deductions,
      gross,
      net_pay,
      notes,
      created_at,
      created_by
    )
    select
      v_company_id,
      p_payroll_run_id,
      s.payroll_item_id,
      s.employee_id,
      public.erp_next_payslip_no(v_year),
      v_year,
      v_month,
      'finalized',
      now(),
      v_actor,
      s.full_name,
      s.employee_no,
      coalesce(s.ctc_monthly, 0),
      s.salary_basic,
      s.salary_hra,
      s.salary_allowances,
      coalesce(s.variable_earnings, 0),
      s.deductions,
      s.gross,
      s.net_pay,
      s.notes,
      now(),
      v_actor
    from source_items s
    where not exists (
      select 1
      from public.erp_payroll_payslips p
      where p.company_id = v_company_id
        and p.payroll_run_id = p_payroll_run_id
        and p.payroll_item_id = s.payroll_item_id
    )
    returning id, payroll_item_id
  )
  insert into public.erp_payroll_payslip_lines (
    company_id,
    payslip_id,
    code,
    name,
    units,
    rate,
    amount,
    line_type,
    created_at
  )
  select
    v_company_id,
    i.id,
    l.code,
    l.name,
    l.units,
    l.rate,
    l.amount,
    case
      when l.amount < 0 then 'deduction'
      else 'earning'
    end,
    now()
  from inserted i
  join public.erp_payroll_item_lines l
    on l.company_id = v_company_id
   and l.payroll_item_id = i.payroll_item_id;
end;
$$;

create or replace function public.erp_payslip_get(p_payslip_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_payslip public.erp_payroll_payslips;
  v_is_manager boolean;
  v_is_employee boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payslip_id is null then
    raise exception 'payslip_id is required';
  end if;

  select *
    into v_payslip
  from public.erp_payroll_payslips ps
  where ps.id = p_payslip_id
    and ps.company_id = v_company_id;

  if v_payslip.id is null then
    raise exception 'Payslip not found';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) into v_is_manager;

  select exists (
    select 1
    from public.erp_employee_users eu
    where eu.company_id = v_company_id
      and eu.employee_id = v_payslip.employee_id
      and eu.user_id = v_actor
      and coalesce(eu.is_active, true)
  ) into v_is_employee;

  if not v_is_manager and not v_is_employee then
    raise exception 'Not authorized';
  end if;

  return json_build_object(
    'payslip', to_jsonb(v_payslip),
    'earnings', coalesce(
      (
        select json_agg(
          json_build_object(
            'id', pl.id,
            'code', pl.code,
            'name', pl.name,
            'units', pl.units,
            'rate', pl.rate,
            'amount', pl.amount,
            'line_type', pl.line_type
          )
          order by pl.created_at
        )
        from public.erp_payroll_payslip_lines pl
        where pl.company_id = v_company_id
          and pl.payslip_id = v_payslip.id
          and pl.line_type = 'earning'
      ),
      '[]'::json
    ),
    'deductions', coalesce(
      (
        select json_agg(
          json_build_object(
            'id', pl.id,
            'code', pl.code,
            'name', pl.name,
            'units', pl.units,
            'rate', pl.rate,
            'amount', pl.amount,
            'line_type', pl.line_type
          )
          order by pl.created_at
        )
        from public.erp_payroll_payslip_lines pl
        where pl.company_id = v_company_id
          and pl.payslip_id = v_payslip.id
          and pl.line_type = 'deduction'
      ),
      '[]'::json
    )
  );
end;
$$;

revoke all on function public.erp_payslip_get(uuid) from public;
grant execute on function public.erp_payslip_get(uuid) to authenticated;

drop function if exists public.erp_my_payslips();
drop function if exists public.erp_my_payslips(int);
drop function if exists public.erp_my_payslips(int, int);

create or replace function public.erp_my_payslips(p_year int default null, p_month int default null)
returns table (
  payslip_id uuid,
  payroll_run_id uuid,
  payroll_item_id uuid,
  employee_id uuid,
  payslip_no text,
  period_year int,
  period_month int,
  status text,
  net_pay numeric,
  currency text,
  issued_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_employee_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select eu.employee_id
    into v_employee_id
  from public.erp_employee_users eu
  where eu.company_id = v_company_id
    and eu.user_id = v_actor
    and coalesce(eu.is_active, true)
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee profile not found';
  end if;

  return query
  select
    ps.id,
    ps.payroll_run_id,
    ps.payroll_item_id,
    ps.employee_id,
    ps.payslip_no,
    ps.period_year,
    ps.period_month,
    ps.status,
    ps.net_pay,
    ps.currency,
    ps.issued_at
  from public.erp_payroll_payslips ps
  where ps.company_id = v_company_id
    and ps.employee_id = v_employee_id
    and (p_year is null or ps.period_year = p_year)
    and (p_month is null or ps.period_month = p_month)
  order by ps.period_year desc, ps.period_month desc, ps.issued_at desc;
end;
$$;

revoke all on function public.erp_my_payslips(int, int) from public;
grant execute on function public.erp_my_payslips(int, int) to authenticated;

create or replace function public.erp_payroll_run_payslips(p_payroll_run_id uuid)
returns table (
  payslip_id uuid,
  payroll_item_id uuid,
  employee_id uuid,
  payslip_no text,
  net_pay numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_run_id is null then
    raise exception 'payroll_run_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    ps.id,
    ps.payroll_item_id,
    ps.employee_id,
    ps.payslip_no,
    ps.net_pay
  from public.erp_payroll_payslips ps
  where ps.company_id = v_company_id
    and ps.payroll_run_id = p_payroll_run_id
  order by ps.employee_name;
end;
$$;

revoke all on function public.erp_payroll_run_payslips(uuid) from public;
grant execute on function public.erp_payroll_run_payslips(uuid) to authenticated;

notify pgrst, 'reload schema';
