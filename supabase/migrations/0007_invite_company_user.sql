-- 0007_invite_company_user.sql
-- Enterprise invite-only user onboarding (Option-B: RPC + thin API)

begin;

-- 1) Ensure roles include hr (safe idempotent inserts)
insert into public.erp_roles (key, name)
values
  ('owner', 'Owner'),
  ('admin', 'Admin'),
  ('hr', 'HR'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- 2) Ensure erp_company_users has email column (used for listing without touching auth.users)
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
end$$;

-- Backfill email if null (best effort; keep null if unknown)
-- (If you already store email elsewhere, you can delete this block.)
-- No-op if you don’t have a source table.
-- update public.erp_company_users set email = email where email is null;

-- Make email required going forward if you want strictness:
-- alter table public.erp_company_users alter column email set not null;

-- 3) Invite tracking table (optional but recommended for auditability)
create table if not exists public.erp_company_user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  email text not null,
  role_key text not null references public.erp_roles(key),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,

  constraint erp_company_user_invites_company_user_unique unique (company_id, user_id),
  constraint erp_company_user_invites_company_email_unique unique (company_id, email)
);

create index if not exists erp_company_user_invites_company_id_idx
  on public.erp_company_user_invites(company_id);

-- 4) Helper: manager check (owner/admin/hr)
create or replace function public.is_erp_manager(uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.erp_user_roles ur
    where ur.user_id = uid
      and ur.role_key in ('owner','admin','hr')
  );
$$;

-- 5) Core RPC: Invite user into the single company + assign role (SECURITY DEFINER)
--    Called AFTER Auth user is created via service role in API.
create or replace function public.erp_invite_company_user(
  p_user_id uuid,
  p_email text,
  p_role_key text,
  p_full_name text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_actor uuid;
  v_existing_owner_count int;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(v_actor) then
    raise exception 'Not authorized';
  end if;

  -- single-company enforced: take the only company id
  select id into v_company_id
  from public.erp_companies
  limit 1;

  if v_company_id is null then
    raise exception 'Company not found';
  end if;

  -- role must exist
  if not exists (select 1 from public.erp_roles r where r.key = p_role_key) then
    raise exception 'Invalid role_key: %', p_role_key;
  end if;

  -- Prevent inviting a 2nd owner (DB unique index already blocks it; we fail earlier for clarity)
  if p_role_key = 'owner' then
    select count(*) into v_existing_owner_count
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.role_key = 'owner';
    if v_existing_owner_count >= 1 then
      raise exception 'Owner already exists';
    end if;
  end if;

  -- Upsert into company_users (invite-only onboarding)
  -- IMPORTANT: adjust column list if your erp_company_users schema differs.
  insert into public.erp_company_users (
    company_id,
    user_id,
    role_key,
    email,
    created_at,
    updated_at
  )
  values (
    v_company_id,
    p_user_id,
    p_role_key,
    lower(trim(p_email)),
    now(),
    now()
  )
  on conflict (company_id, user_id) do update set
    role_key = excluded.role_key,
    email = coalesce(excluded.email, public.erp_company_users.email),
    updated_at = now();

  -- Record invite audit
  insert into public.erp_company_user_invites (
    company_id, user_id, email, role_key, invited_by, invited_at
  )
  values (
    v_company_id, p_user_id, lower(trim(p_email)), p_role_key, v_actor, now()
  )
  on conflict (company_id, user_id) do update set
    role_key = excluded.role_key,
    email = excluded.email,
    invited_by = excluded.invited_by,
    invited_at = now();

  return json_build_object(
    'ok', true,
    'company_id', v_company_id,
    'user_id', p_user_id,
    'email', lower(trim(p_email)),
    'role_key', p_role_key
  );
end;
$$;

-- 6) RPC: List company users for admin UI (SECURITY DEFINER)
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
declare
  v_company_id uuid;
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_erp_manager(v_actor) then
    raise exception 'Not authorized';
  end if;

  select id into v_company_id
  from public.erp_companies
  limit 1;

  return query
  select
    cu.user_id,
    cu.email,
    cu.role_key,
    cu.created_at,
    cu.updated_at
  from public.erp_company_users cu
  where cu.company_id = v_company_id
  order by
    case cu.role_key when 'owner' then 0 when 'admin' then 1 when 'hr' then 2 else 9 end,
    cu.created_at asc;
end;
$$;

-- 7) Lock down invites table (RLS ON; only via SECURITY DEFINER functions)
alter table public.erp_company_user_invites enable row level security;

-- No direct policies; use RPC only
-- (If you prefer view policies later, add them explicitly.)

commit;
