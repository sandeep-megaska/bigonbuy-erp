-- 0366_fix_employee_auth_crypt_schema.sql
-- Ensure employee auth login function uses pgcrypto.crypt explicitly

create or replace function public.erp_employee_auth_login(
  p_employee_code text,
  p_password text,
  p_user_agent text default null,
  p_ip inet default null
) returns table (
  company_id uuid,
  employee_id uuid,
  employee_code text,
  display_name text,
  session_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_employee_code text;
  v_display_name text;
  v_password_hash text;
  v_token text;
  v_token_hash text;
  v_expires_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  select
    e.company_id,
    e.id,
    e.employee_code,
    coalesce(nullif(e.full_name,''), e.employee_code),
    au.password_hash
  into
    v_company_id,
    v_employee_id,
    v_employee_code,
    v_display_name,
    v_password_hash
  from public.erp_employees e
  join public.erp_employee_auth_users au
    on au.employee_id = e.id
   and au.company_id = e.company_id
  where e.employee_code = p_employee_code
    and au.is_active = true;

  if v_employee_id is null then
    raise exception 'Invalid employee credentials';
  end if;

  -- IMPORTANT FIX: explicitly use pgcrypto.crypt
  if v_password_hash <> pgcrypto.crypt(p_password, v_password_hash) then
    raise exception 'Invalid employee credentials';
  end if;

  v_token := gen_random_uuid()::text;
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.erp_employee_auth_sessions (
    company_id,
    employee_id,
    session_token_hash,
    expires_at,
    user_agent,
    ip
  ) values (
    v_company_id,
    v_employee_id,
    v_token_hash,
    v_expires_at,
    p_user_agent,
    p_ip
  );

  return query
  select
    v_company_id,
    v_employee_id,
    v_employee_code,
    v_display_name,
    v_token,
    v_expires_at;
end;
$$;

revoke all on function public.erp_employee_auth_login(text,text,text,inet) from public;
grant execute on function public.erp_employee_auth_login(text,text,text,inet) to service_role;
