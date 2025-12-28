-- Harden employee login mapping and manager check RPCs

-- Ensure erp_employee_users has a login email column
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_users'
      and column_name = 'email'
  ) then
    alter table public.erp_employee_users
      add column email text;
  end if;
end
$$;

-- Backfill missing emails from auth.users when possible
update public.erp_employee_users eeu
set email = coalesce(eeu.email, u.email)
from auth.users u
where eeu.user_id = u.id
  and (eeu.email is null or eeu.email = '');

-- Ensure active flags exist and default to true on membership tables
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_employee_users'
      and column_name = 'is_active'
  ) then
    alter table public.erp_employee_users
      add column is_active boolean default true;
  end if;

  alter table public.erp_employee_users alter column is_active set default true;
  update public.erp_employee_users set is_active = true where is_active is null;
  alter table public.erp_employee_users alter column is_active set not null;
end
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'erp_company_users'
      and column_name = 'is_active'
  ) then
    alter table public.erp_company_users
      add column is_active boolean default true;
  end if;

  alter table public.erp_company_users alter column is_active set default true;
  update public.erp_company_users set is_active = true where is_active is null;
  alter table public.erp_company_users alter column is_active set not null;
end
$$;

-- Canonical company resolver (reuse seeded ID if helper table is empty)
create or replace function public.erp_current_company_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select id from public.erp_company limit 1),
    (select id from public.erp_companies limit 1),
    'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a'::uuid
  );
$$;

revoke all on function public.erp_current_company_id() from public;
grant execute on function public.erp_current_company_id() to authenticated;

-- Manager predicate: owner/admin/hr with an active membership
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = uid
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  );
$$;

revoke all on function public.is_erp_manager(uuid) from public;
grant execute on function public.is_erp_manager(uuid) to authenticated;

-- Updated employee login linker to set email + active flags
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
  v_normalized_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = p_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'hr')
  ) then
    raise exception 'Forbidden: requires owner/admin/hr for company';
  end if;

  if not exists (
    select 1 from public.erp_roles r where r.key = 'employee'
  ) then
    raise exception 'Missing role: create employee role in HR Roles module';
  end if;

  v_normalized_email := lower(trim(coalesce(p_employee_email, '')));
  if v_normalized_email = '' then
    raise exception 'Employee email is required';
  end if;

  begin
    insert into public.erp_employee_users (company_id, employee_id, user_id, email, is_active, updated_at)
    values (p_company_id, p_employee_id, p_auth_user_id, v_normalized_email, true, now())
    on conflict (employee_id) do update
      set company_id = excluded.company_id,
          user_id = excluded.user_id,
          email = excluded.email,
          is_active = true,
          updated_at = now()
    returning id into v_employee_user_id;

    insert into public.erp_company_users (company_id, user_id, role_key, email, is_active, updated_at)
    values (p_company_id, p_auth_user_id, 'employee', v_normalized_email, true, now())
    on conflict (company_id, user_id) do update
      set role_key = excluded.role_key,
          email = coalesce(excluded.email, public.erp_company_users.email),
          is_active = true,
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

-- Invitation RPC: ensure memberships remain active and manager gate uses new predicate
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
  v_company_id uuid := public.erp_current_company_id();
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

  insert into public.erp_company_users (company_id, user_id, role_key, email, is_active, updated_at)
  values (v_company_id, p_user_id, p_role_key, v_normalized_email, true, now())
  on conflict (company_id, user_id) do update
    set role_key = excluded.role_key,
        email = coalesce(excluded.email, public.erp_company_users.email),
        is_active = true,
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
