-- Finance GL accounts (Chart of Accounts v1)

create table if not exists public.erp_gl_accounts (
  code text not null,
  name text not null,
  account_type text not null,
  normal_balance text not null,
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),  
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null
);

alter table public.erp_gl_accounts
  add constraint erp_gl_accounts_account_type_check
  check (account_type in ('asset', 'liability', 'income', 'expense', 'equity'));

alter table public.erp_gl_accounts
  add constraint erp_gl_accounts_normal_balance_check
  check (normal_balance in ('debit', 'credit'));

create unique index if not exists erp_gl_accounts_company_code
  on public.erp_gl_accounts (company_id, code);

create unique index if not exists erp_gl_accounts_company_name
  on public.erp_gl_accounts (company_id, lower(name));

create index if not exists erp_gl_accounts_company_id_idx
  on public.erp_gl_accounts (company_id);

drop trigger if exists erp_gl_accounts_set_updated_at on public.erp_gl_accounts;
create trigger erp_gl_accounts_set_updated_at
before update on public.erp_gl_accounts
for each row execute function public.erp_set_updated_at();

alter table public.erp_gl_accounts enable row level security;
alter table public.erp_gl_accounts force row level security;

do $$
begin
  drop policy if exists erp_gl_accounts_select on public.erp_gl_accounts;
  drop policy if exists erp_gl_accounts_write on public.erp_gl_accounts;

  create policy erp_gl_accounts_select
    on public.erp_gl_accounts
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

  create policy erp_gl_accounts_write
    on public.erp_gl_accounts
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
end;
$$;

create or replace function public.erp_gl_accounts_list(
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

revoke all on function public.erp_gl_accounts_list(text, boolean) from public;
grant execute on function public.erp_gl_accounts_list(text, boolean) to authenticated;

do $$
begin
  drop function if exists public.erp_gl_account_get(uuid);
end;
$$;

create or replace function public.erp_gl_account_get(
  p_id uuid
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_gl_accounts;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_row
    from public.erp_gl_accounts a
   where a.company_id = public.erp_current_company_id()
     and a.id = p_id;

  return v_row;
end;
$$;

revoke all on function public.erp_gl_account_get(uuid) from public;
grant execute on function public.erp_gl_account_get(uuid) to authenticated;

create or replace function public.erp_gl_account_deactivate(
  p_id uuid
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_gl_accounts;
begin
  perform public.erp_require_finance_writer();

  update public.erp_gl_accounts
  set is_active = false,
      updated_at = now(),
      updated_by_user_id = auth.uid()
  where company_id = public.erp_current_company_id()
    and id = p_id
  returning * into v_row;

  if not found then
    raise exception 'account not found';
  end if;

  return v_row;
end;
$$;
create or replace function public.erp_gl_account_deactivate(
  p_id uuid
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_gl_accounts;
begin
  perform public.erp_require_finance_writer();

  update public.erp_gl_accounts
  set is_active = false,
      updated_at = now(),
      updated_by_user_id = auth.uid()
  where company_id = public.erp_current_company_id()
    and id = p_id
  returning * into v_row;

  if not found then
    raise exception 'account not found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.erp_gl_account_deactivate(uuid) from public;
grant execute on function public.erp_gl_account_deactivate(uuid) to authenticated;
create or replace function public.erp_gl_accounts_seed_minimal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_inserted int := 0;
begin
  perform public.erp_require_finance_writer();

  with seed_rows as (
    select * from (
      values
        ('5001', 'Salary Expense', 'expense', 'debit'),
        ('2101', 'Payroll Payable', 'liability', 'credit')
    ) as v(code, name, account_type, normal_balance)
  ),
  inserted as (
    insert into public.erp_gl_accounts (
      company_id,
      code,
      name,
      account_type,
      normal_balance,
      is_active,
      created_by_user_id,
      updated_by_user_id
    )
    select
      v_company_id,
      s.code,
      s.name,
      s.account_type,
      s.normal_balance,
      true,
      v_actor,
      v_actor
    from seed_rows s
    on conflict (company_id, code) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  return jsonb_build_object(
    'inserted', v_inserted
  );
end;
$$;

revoke all on function public.erp_gl_accounts_seed_minimal() from public;
grant execute on function public.erp_gl_accounts_seed_minimal() to authenticated;
