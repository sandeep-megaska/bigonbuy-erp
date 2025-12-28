-- Option B HR employee login linkage refresh (2025-12-28)

-- Ensure UUID generation support
create extension if not exists "pgcrypto";

-- Company user memberships
create table if not exists public.erp_company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null references public.erp_roles (key),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_company_users_company_id_user_id_key unique (company_id, user_id)
);

-- Employee login links
create table if not exists public.erp_employee_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_employee_users_employee_id_key unique (employee_id),
  constraint erp_employee_users_user_id_key unique (user_id)
);

-- Add foreign keys only when masters are present
do $$
begin
  if to_regclass('public.erp_companies') is not null then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.erp_company_users'::regclass
        and conname = 'erp_company_users_company_id_fkey'
    ) then
      alter table public.erp_company_users
        add constraint erp_company_users_company_id_fkey
        foreign key (company_id) references public.erp_companies (id) on delete cascade;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.erp_employee_users'::regclass
        and conname = 'erp_employee_users_company_id_fkey'
    ) then
      alter table public.erp_employee_users
        add constraint erp_employee_users_company_id_fkey
        foreign key (company_id) references public.erp_companies (id) on delete cascade;
    end if;
  end if;

  if to_regclass('public.erp_employees') is not null then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.erp_employee_users'::regclass
        and conname = 'erp_employee_users_employee_id_fkey'
    ) then
      alter table public.erp_employee_users
        add constraint erp_employee_users_employee_id_fkey
        foreign key (employee_id) references public.erp_employees (id) on delete cascade;
    end if;
  end if;
end
$$;

-- RLS enforcement
alter table public.erp_company_users enable row level security;
alter table public.erp_company_users force row level security;

alter table public.erp_employee_users enable row level security;
alter table public.erp_employee_users force row level security;

-- Authenticated members can read their company records
do $$
begin
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'erp_company_users'
      and p.policyname = 'erp_company_users_select_members'
      ) then
    create policy erp_company_users_select_members
      on public.erp_company_users
      for select
      using (
        auth.role() = 'service_role'
        or
        exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_company_users.company_id
            and cu.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'erp_employee_users'
      and p.policyname = 'erp_employee_users_select_members'
      ) then
    create policy erp_employee_users_select_members
      on public.erp_employee_users
      for select
      using (
        auth.role() = 'service_role'
        or
        exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = erp_employee_users.company_id
            and cu.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- Seed required roles
insert into public.erp_roles (key, name) values
  ('owner', 'Owner'),
  ('admin', 'Administrator'),
  ('hr', 'HR Manager'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- RPC to link employee login
create or replace function public.erp_link_employee_login(
  p_company_id uuid,
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_employee_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_user_id uuid;
  v_company_user_id uuid;
  v_constraint_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and cu.role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Forbidden: requires owner/admin/hr for company';
  end if;

  if not exists (
    select 1 from public.erp_roles r where r.key = 'employee'
  ) then
    raise exception 'Missing role: create employee role in HR Roles module';
  end if;

  begin
    insert into public.erp_employee_users (company_id, employee_id, user_id, email)
    values (p_company_id, p_employee_id, p_auth_user_id, p_employee_email)
    on conflict (employee_id) do update
      set company_id = excluded.company_id,
          user_id = excluded.user_id,
          email = excluded.email,
          updated_at = now()
    returning id into v_employee_user_id;

    insert into public.erp_company_users (company_id, user_id, role_key)
    values (p_company_id, p_auth_user_id, 'employee')
    on conflict (company_id, user_id) do update
      set role_key = 'employee',
          updated_at = now()
    returning id into v_company_user_id;

    return jsonb_build_object(
      'ok', true,
      'employee_user_map_id', v_employee_user_id,
      'company_user_id', v_company_user_id
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
      if v_constraint_name = 'erp_employee_users_user_id_key' then
        raise exception 'Conflict: auth user already linked to another employee';
      else
        raise;
      end if;
  end;
end;
$$;

revoke all on function public.erp_link_employee_login(uuid, uuid, uuid, text) from public;
grant execute on function public.erp_link_employee_login(uuid, uuid, uuid, text) to authenticated;
