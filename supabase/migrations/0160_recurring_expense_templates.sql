-- Recurring expense templates + generator (Phase 1.5)

-- ---------------------------------------------------------------------
-- Recurring templates
-- ---------------------------------------------------------------------

create table if not exists public.erp_recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  name text not null,
  category_id uuid not null references public.erp_expense_categories (id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'INR',
  channel_id uuid null references public.erp_sales_channels (id) on delete set null,
  warehouse_id uuid null references public.erp_warehouses (id) on delete set null,
  vendor_id uuid null references public.erp_vendors (id) on delete set null,
  payee_name text null,
  reference text null,
  description text null,
  day_of_month int not null default 1,
  recurrence text not null default 'monthly',
  start_month date not null default date_trunc('month', current_date)::date,
  end_month date null,
  is_active boolean not null default true,
  last_generated_month date null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint erp_recurring_expense_templates_day_check check (day_of_month between 1 and 28),
  constraint erp_recurring_expense_templates_recurrence_check check (recurrence in ('monthly'))
);

create index if not exists erp_recurring_expense_templates_company_active_idx
  on public.erp_recurring_expense_templates (company_id, is_active);

create index if not exists erp_recurring_expense_templates_company_category_idx
  on public.erp_recurring_expense_templates (company_id, category_id);

create index if not exists erp_recurring_expense_templates_company_warehouse_idx
  on public.erp_recurring_expense_templates (company_id, warehouse_id);

create index if not exists erp_recurring_expense_templates_company_channel_idx
  on public.erp_recurring_expense_templates (company_id, channel_id);

-- ---------------------------------------------------------------------
-- Recurring runs (audit + idempotency guard)
-- ---------------------------------------------------------------------

create table if not exists public.erp_recurring_expense_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  template_id uuid not null references public.erp_recurring_expense_templates (id) on delete cascade,
  month date not null,
  expense_id uuid null references public.erp_expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_recurring_expense_runs_unique unique (company_id, template_id, month)
);

create index if not exists erp_recurring_expense_runs_company_month_idx
  on public.erp_recurring_expense_runs (company_id, month);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.erp_recurring_expense_templates enable row level security;
alter table public.erp_recurring_expense_templates force row level security;
alter table public.erp_recurring_expense_runs enable row level security;
alter table public.erp_recurring_expense_runs force row level security;

do $$
begin
  drop policy if exists erp_recurring_expense_templates_select on public.erp_recurring_expense_templates;
  drop policy if exists erp_recurring_expense_templates_write on public.erp_recurring_expense_templates;
  drop policy if exists erp_recurring_expense_runs_select on public.erp_recurring_expense_runs;
  drop policy if exists erp_recurring_expense_runs_write on public.erp_recurring_expense_runs;

  create policy erp_recurring_expense_templates_select
    on public.erp_recurring_expense_templates
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

  create policy erp_recurring_expense_templates_write
    on public.erp_recurring_expense_templates
    for all
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_recurring_expense_runs_select
    on public.erp_recurring_expense_runs
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

  create policy erp_recurring_expense_runs_write
    on public.erp_recurring_expense_runs
    for all
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );
end;
$$;

-- ---------------------------------------------------------------------
-- Template CRUD helpers
-- ---------------------------------------------------------------------

create or replace function public.erp_recurring_expense_templates_list()
returns table (
  id uuid,
  name text,
  category_id uuid,
  category_name text,
  amount numeric,
  currency text,
  channel_id uuid,
  channel_name text,
  warehouse_id uuid,
  warehouse_name text,
  vendor_id uuid,
  vendor_name text,
  payee_name text,
  reference text,
  description text,
  day_of_month int,
  recurrence text,
  start_month date,
  end_month date,
  is_active boolean,
  last_generated_month date
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
    t.id,
    t.name,
    t.category_id,
    c.name as category_name,
    t.amount,
    t.currency,
    t.channel_id,
    ch.name as channel_name,
    t.warehouse_id,
    w.name as warehouse_name,
    t.vendor_id,
    v.legal_name as vendor_name,
    t.payee_name,
    t.reference,
    t.description,
    t.day_of_month,
    t.recurrence,
    t.start_month,
    t.end_month,
    t.is_active,
    t.last_generated_month
  from public.erp_recurring_expense_templates t
  join public.erp_expense_categories c on c.id = t.category_id
  left join public.erp_sales_channels ch on ch.id = t.channel_id
  left join public.erp_warehouses w on w.id = t.warehouse_id
  left join public.erp_vendors v on v.id = t.vendor_id
  where t.company_id = public.erp_current_company_id()
  order by t.is_active desc, t.name;
end;
$$;

revoke all on function public.erp_recurring_expense_templates_list() from public;
grant execute on function public.erp_recurring_expense_templates_list() to authenticated;

create or replace function public.erp_recurring_expense_template_upsert(
  p_id uuid,
  p_name text,
  p_category_id uuid,
  p_amount numeric,
  p_currency text,
  p_channel_id uuid,
  p_warehouse_id uuid,
  p_vendor_id uuid,
  p_payee_name text,
  p_reference text,
  p_description text,
  p_day_of_month int,
  p_recurrence text,
  p_start_month date,
  p_end_month date,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_day int := least(greatest(coalesce(p_day_of_month, 1), 1), 28);
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be >= 0';
  end if;

  if p_recurrence is null or p_recurrence <> 'monthly' then
    raise exception 'Only monthly recurrence is supported';
  end if;

  if p_start_month is null then
    raise exception 'Start month is required';
  end if;

  if p_end_month is not null and p_end_month < p_start_month then
    raise exception 'End month must be after start month';
  end if;

  if not exists (
    select 1
    from public.erp_expense_categories c
    where c.id = p_category_id
      and c.company_id = v_company_id
  ) then
    raise exception 'Invalid category';
  end if;

  if p_channel_id is not null and exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = 'erp_sales_channels'
  ) then
    if not exists (
      select 1
      from public.erp_sales_channels ch
      where ch.id = p_channel_id
        and ch.company_id = v_company_id
    ) then
      raise exception 'Invalid channel';
    end if;
  end if;

  if p_warehouse_id is not null then
    if not exists (
      select 1
      from public.erp_warehouses w
      where w.id = p_warehouse_id
        and w.company_id = v_company_id
    ) then
      raise exception 'Invalid warehouse';
    end if;
  end if;

  if p_vendor_id is not null then
    if not exists (
      select 1
      from public.erp_vendors v
      where v.id = p_vendor_id
        and v.company_id = v_company_id
    ) then
      raise exception 'Invalid vendor';
    end if;
  end if;

  if p_id is null then
    insert into public.erp_recurring_expense_templates (
      company_id,
      name,
      category_id,
      amount,
      currency,
      channel_id,
      warehouse_id,
      vendor_id,
      payee_name,
      reference,
      description,
      day_of_month,
      recurrence,
      start_month,
      end_month,
      is_active,
      created_by,
      updated_at
    )
    values (
      v_company_id,
      p_name,
      p_category_id,
      p_amount,
      coalesce(nullif(p_currency, ''), 'INR'),
      p_channel_id,
      p_warehouse_id,
      p_vendor_id,
      case when p_vendor_id is not null then null else nullif(p_payee_name, '') end,
      nullif(p_reference, ''),
      nullif(p_description, ''),
      v_day,
      p_recurrence,
      date_trunc('month', p_start_month)::date,
      case when p_end_month is null then null else date_trunc('month', p_end_month)::date end,
      coalesce(p_is_active, true),
      auth.uid(),
      now()
    )
    returning id into v_id;
  else
    update public.erp_recurring_expense_templates
    set
      name = p_name,
      category_id = p_category_id,
      amount = p_amount,
      currency = coalesce(nullif(p_currency, ''), 'INR'),
      channel_id = p_channel_id,
      warehouse_id = p_warehouse_id,
      vendor_id = p_vendor_id,
      payee_name = case when p_vendor_id is not null then null else nullif(p_payee_name, '') end,
      reference = nullif(p_reference, ''),
      description = nullif(p_description, ''),
      day_of_month = v_day,
      recurrence = p_recurrence,
      start_month = date_trunc('month', p_start_month)::date,
      end_month = case when p_end_month is null then null else date_trunc('month', p_end_month)::date end,
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_id
      and company_id = v_company_id
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'Template not found or not updated';
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_recurring_expense_template_upsert(
  uuid, text, uuid, numeric, text, uuid, uuid, uuid, text, text, text, int, text, date, date, boolean
) from public;
grant execute on function public.erp_recurring_expense_template_upsert(
  uuid, text, uuid, numeric, text, uuid, uuid, uuid, text, text, text, int, text, date, date, boolean
) to authenticated;

-- ---------------------------------------------------------------------
-- Generator RPC
-- ---------------------------------------------------------------------

create or replace function public.erp_generate_recurring_expenses(
  p_month date,
  p_validate_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_month date := date_trunc('month', p_month)::date;
  v_template record;
  v_day int;
  v_expense_date date;
  v_created int := 0;
  v_skipped int := 0;
  v_would_create int := 0;
  v_rows jsonb := '[]'::jsonb;
  v_expense_id uuid;
  v_status text;
  v_reason text;
  v_signature_exists boolean;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_month is null then
    raise exception 'Month is required';
  end if;

  for v_template in
    select t.*
    from public.erp_recurring_expense_templates t
    where t.company_id = v_company_id
      and t.is_active = true
      and t.recurrence = 'monthly'
      and t.start_month <= v_month
      and (t.end_month is null or t.end_month >= v_month)
    order by t.name
  loop
    v_day := least(greatest(coalesce(v_template.day_of_month, 1), 1), 28);
    v_expense_date := v_month + (v_day - 1);
    v_status := 'created';
    v_reason := null;

    if exists (
      select 1
      from public.erp_recurring_expense_runs r
      where r.company_id = v_company_id
        and r.template_id = v_template.id
        and r.month = v_month
    ) then
      v_status := 'skipped';
      v_reason := 'already generated';
      v_skipped := v_skipped + 1;
    else
      v_signature_exists := exists (
        select 1
        from public.erp_expenses e
        where e.company_id = v_company_id
          and e.expense_date = v_expense_date
          and e.category_id = v_template.category_id
          and e.amount = v_template.amount
          and coalesce(e.currency, 'INR') = coalesce(v_template.currency, 'INR')
          and (e.warehouse_id is not distinct from v_template.warehouse_id)
          and (e.channel_id is not distinct from v_template.channel_id)
          and (e.vendor_id is not distinct from v_template.vendor_id)
          and coalesce(e.reference, '') = coalesce(v_template.reference, '')
          and coalesce(e.payee_name, '') = coalesce(v_template.payee_name, '')
      );

      if v_signature_exists then
        v_status := 'skipped';
        v_reason := 'existing expense matches template';
        v_skipped := v_skipped + 1;
      else
        v_would_create := v_would_create + 1;

        if not p_validate_only then
          insert into public.erp_expenses (
            company_id,
            expense_date,
            amount,
            currency,
            category_id,
            channel_id,
            warehouse_id,
            vendor_id,
            payee_name,
            reference,
            description,
            is_recurring,
            recurring_rule,
            created_by,
            updated_at
          )
          values (
            v_company_id,
            v_expense_date,
            v_template.amount,
            coalesce(nullif(v_template.currency, ''), 'INR'),
            v_template.category_id,
            v_template.channel_id,
            v_template.warehouse_id,
            v_template.vendor_id,
            nullif(v_template.payee_name, ''),
            nullif(v_template.reference, ''),
            nullif(v_template.description, ''),
            true,
            'monthly',
            auth.uid(),
            now()
          )
          returning id into v_expense_id;

          insert into public.erp_recurring_expense_runs (
            company_id,
            template_id,
            month,
            expense_id
          )
          values (
            v_company_id,
            v_template.id,
            v_month,
            v_expense_id
          )
          on conflict do nothing;

          update public.erp_recurring_expense_templates
          set
            last_generated_month = v_month,
            updated_at = now()
          where id = v_template.id
            and company_id = v_company_id;

          v_created := v_created + 1;
        end if;
      end if;
    end if;

    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'template_id', v_template.id,
        'template_name', v_template.name,
        'expense_date', v_expense_date,
        'amount', v_template.amount,
        'status', v_status,
        'reason', v_reason
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'month', to_char(v_month, 'YYYY-MM'),
    'would_create', v_would_create,
    'created', v_created,
    'skipped', v_skipped,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.erp_generate_recurring_expenses(date, boolean) from public;
grant execute on function public.erp_generate_recurring_expenses(date, boolean) to authenticated;
