-- Company user invitation flow and management RPCs

-- Ensure membership has a stored email for auditability
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_company_users'
      and column_name = 'email'
  ) then
    alter table public.erp_company_users
      add column email text;
  end if;
end
$$;

-- Ensure unique membership per company/user pair
create unique index if not exists ux_erp_company_users_company_user
  on public.erp_company_users (company_id, user_id);

-- Invitation audit log (RPC-only access)
create table if not exists public.erp_company_user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role_key text not null references public.erp_roles (key),
  invited_by uuid not null references auth.users (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.erp_company_user_invites enable row level security;
alter table public.erp_company_user_invites force row level security;

create unique index if not exists ux_erp_company_user_invites_company_user
  on public.erp_company_user_invites (company_id, user_id);

-- Seed canonical roles defensively
insert into public.erp_roles (key, name) values
  ('owner', 'Owner'),
  ('admin', 'Administrator'),
  ('hr', 'HR Manager'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- Helper: check if provided uid is a manager (owner/admin/hr)
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users
    where company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
      and user_id = uid
      and role_key in ('owner', 'admin', 'hr')
  );
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- RPC: invite or update a company user membership
create or replace function public.erp_invite_company_user(
  p_user_id uuid,
  p_email text,
  p_role_key text,
  p_full_name text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id constant uuid := 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
  v_normalized_email text;
  v_existing_owner uuid;
  v_invite_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_user_id is null then
    raise exception 'Target user id is required';
  end if;

  v_normalized_email := lower(trim(coalesce(p_email, '')));
  if v_normalized_email = '' then
    raise exception 'Email is required';
  end if;

  if p_role_key not in ('owner', 'admin', 'hr', 'employee') then
    raise exception 'Invalid role: %', p_role_key;
  end if;

  if not exists (select 1 from public.erp_roles where key = p_role_key) then
    raise exception 'Role not found in erp_roles: %', p_role_key;
  end if;

  if p_role_key = 'owner' then
    select user_id
      into v_existing_owner
      from public.erp_company_users
     where company_id = v_company_id
       and role_key = 'owner'
     limit 1;

    if v_existing_owner is not null and v_existing_owner <> p_user_id then
      raise exception 'Owner already exists; cannot assign a second owner';
    end if;
  end if;

  insert into public.erp_company_users (company_id, user_id, role_key, email, updated_at)
  values (v_company_id, p_user_id, p_role_key, v_normalized_email, now())
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        email = coalesce(excluded.email, public.erp_company_users.email),
        updated_at = now();

  insert into public.erp_company_user_invites (company_id, user_id, email, role_key, invited_by, invited_at)
  values (v_company_id, p_user_id, v_normalized_email, p_role_key, auth.uid(), now())
  on conflict (company_id, user_id) do update
    set email = excluded.email,
        role_key = excluded.role_key,
        invited_by = excluded.invited_by,
        invited_at = excluded.invited_at
  returning id into v_invite_id;

  return json_build_object(
    'company_id', v_company_id,
    'user_id', p_user_id,
    'email', v_normalized_email,
    'role_key', p_role_key,
    'invite_id', v_invite_id,
    'invited_by', auth.uid(),
    'full_name', p_full_name
  );
end;
$$;

revoke all on function public.erp_invite_company_user(uuid, text, text, text) from public;
grant execute on function public.erp_invite_company_user(uuid, text, text, text) to authenticated;

-- RPC: list company users for the single company
create or replace function public.erp_list_company_users()
returns table (
  user_id uuid,
  email text,
  role_key text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(auth.uid()) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  return query
  select
    cu.user_id,
    coalesce(cu.email, u.email),
    cu.role_key,
    cu.created_at,
    cu.updated_at
  from public.erp_company_users cu
  left join auth.users u on u.id = cu.user_id
  where cu.company_id = 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'
  order by cu.created_at desc;
end;
$$;

revoke all on function public.erp_list_company_users() from public;
grant execute on function public.erp_list_company_users() to authenticated;
