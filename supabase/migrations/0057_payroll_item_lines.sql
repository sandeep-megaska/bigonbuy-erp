create table if not exists public.erp_payroll_item_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  payroll_item_id uuid not null references public.erp_payroll_items (id) on delete cascade,
  code text not null,
  name text null,
  units numeric null,
  rate numeric null,
  amount numeric not null default 0,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_payroll_item_lines_company_item_code_key
  on public.erp_payroll_item_lines (company_id, payroll_item_id, code);

create index if not exists erp_payroll_item_lines_item_idx
  on public.erp_payroll_item_lines (payroll_item_id);

drop trigger if exists erp_payroll_item_lines_set_updated on public.erp_payroll_item_lines;
create trigger erp_payroll_item_lines_set_updated
before update on public.erp_payroll_item_lines
for each row
execute function public.erp_hr_set_updated();

alter table public.erp_payroll_item_lines enable row level security;
alter table public.erp_payroll_item_lines force row level security;

do $$
begin
  drop policy if exists erp_payroll_item_lines_select on public.erp_payroll_item_lines;
  drop policy if exists erp_payroll_item_lines_write on public.erp_payroll_item_lines;

  create policy erp_payroll_item_lines_select
    on public.erp_payroll_item_lines
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );

  create policy erp_payroll_item_lines_write
    on public.erp_payroll_item_lines
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
            and cu.role_key in ('owner', 'admin', 'payroll')
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
            and cu.role_key in ('owner', 'admin', 'payroll')
        )
      )
    );
end
$$;

create or replace function public.erp_payroll_item_line_list(
  p_payroll_item_id uuid
) returns setof public.erp_payroll_item_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  return query
  select *
  from public.erp_payroll_item_lines
  where company_id = public.erp_current_company_id()
    and payroll_item_id = p_payroll_item_id
  order by code;
end;
$$;

revoke all on function public.erp_payroll_item_line_list(uuid) from public;
grant execute on function public.erp_payroll_item_line_list(uuid) to authenticated;

create or replace function public.erp_payroll_item_line_upsert(
  p_payroll_item_id uuid,
  p_code text,
  p_units numeric,
  p_rate numeric,
  p_amount numeric,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_variable_earnings numeric := 0;
  v_basic numeric := 0;
  v_hra numeric := 0;
  v_allowances numeric := 0;
  v_deductions numeric := 0;
  v_gross numeric := 0;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_payroll_item_id is null or p_code is null or length(trim(p_code)) = 0 then
    raise exception 'payroll_item_id and code are required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_payroll_items pi
    where pi.id = p_payroll_item_id
      and pi.company_id = v_company_id
  ) then
    raise exception 'Payroll item not found';
  end if;

  insert into public.erp_payroll_item_lines (
    company_id,
    payroll_item_id,
    code,
    name,
    units,
    rate,
    amount,
    notes
  ) values (
    v_company_id,
    p_payroll_item_id,
    trim(p_code),
    null,
    p_units,
    p_rate,
    coalesce(p_amount, 0),
    p_notes
  )
  on conflict (company_id, payroll_item_id, code)
  do update set
    units = excluded.units,
    rate = excluded.rate,
    amount = excluded.amount,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = v_actor
  returning id into v_line_id;

  select coalesce(sum(amount), 0)
    into v_variable_earnings
  from public.erp_payroll_item_lines
  where company_id = v_company_id
    and payroll_item_id = p_payroll_item_id
    and code in ('OT');

  select
    coalesce(basic, 0),
    coalesce(hra, 0),
    coalesce(allowances, 0),
    coalesce(deductions, 0)
  into v_basic, v_hra, v_allowances, v_deductions
  from public.erp_payroll_items
  where company_id = v_company_id
    and id = p_payroll_item_id;

  v_gross := v_basic + v_hra + v_allowances + v_variable_earnings;

  update public.erp_payroll_items
    set gross = v_gross,
        net_pay = v_gross - v_deductions
  where company_id = v_company_id
    and id = p_payroll_item_id;

  return v_line_id;
end;
$$;

revoke all on function public.erp_payroll_item_line_upsert(uuid, text, numeric, numeric, numeric, text) from public;
grant execute on function public.erp_payroll_item_line_upsert(uuid, text, numeric, numeric, numeric, text) to authenticated;
