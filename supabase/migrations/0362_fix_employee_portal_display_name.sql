-- 0362_fix_employee_portal_display_name.sql
-- Fix employee portal auth functions: erp_employees has full_name, not name

create or replace function public.erp_employee_auth_user_get(
  p_employee_code text
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  password_hash text,
  is_active boolean,
  must_reset_password boolean,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_employee_code is null or trim(p_employee_code) = '' then
    raise exception 'employee_code is required';
  end if;

  return query
  select
    e.company_id,
    e.id as employee_id,
    e.employee_code,
    au.password_hash,
    au.is_active,
    au.must_reset_password,
    coalesce(nullif(e.full_name, ''), e.employee_code) as display_name
  from public.erp_employees e
  join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.employee_code = p_employee_code;
end;
$$;

revoke all on function public.erp_employee_auth_user_get(text) from public;
grant execute on function public.erp_employee_auth_user_get(text) to service_role;

-- Patch the session validate/get function too (name may differ in your file).
-- Replace e.name usage with e.full_name only.

do $$
declare
  v_exists boolean;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'erp_employee_auth_session_validate'
  ) into v_exists;

  if v_exists then
    execute $fn$
      create or replace function public.erp_employee_auth_session_validate(
        p_company_id uuid,
        p_token_hash text
      ) returns table (
        employee_id uuid,
        employee_code text,
        display_name text,
        expires_at timestamptz,
        revoked_at timestamptz,
        roles text[],
        permissions text[]
      )
      language plpgsql
      security definer
      set search_path = public
      as $$
      declare
        v_employee_id uuid;
        v_employee_code text;
        v_display_name text;
        v_roles text[];
        v_permissions text[];
        v_expires_at timestamptz;
        v_revoked_at timestamptz;
      begin
        if p_company_id is null then
          raise exception 'company_id is required';
        end if;

        if p_token_hash is null or trim(p_token_hash) = '' then
          raise exception 'token_hash is required';
        end if;

        select e.id,
               e.employee_code,
               coalesce(nullif(e.full_name, ''), e.employee_code),
               s.expires_at,
               s.revoked_at
          into v_employee_id, v_employee_code, v_display_name, v_expires_at, v_revoked_at
        from public.erp_employee_auth_sessions s
        join public.erp_employee_auth_users au
          on au.id = s.user_id
         and au.company_id = s.company_id
         and au.is_active
        join public.erp_employees e
          on e.id = au.employee_id
         and e.company_id = s.company_id
        where s.company_id = p_company_id
          and s.token_hash = p_token_hash
        order by s.created_at desc
        limit 1;

        if v_employee_id is null then
          raise exception 'Session not found';
        end if;

        return query
        select v_employee_id,
               v_employee_code,
               v_display_name,
               v_expires_at,
               v_revoked_at,
               coalesce(v_roles, array[]::text[]),
               coalesce(v_permissions, array[]::text[]);
      end;
      $$;
    $fn$;
  end if;
end $$;
