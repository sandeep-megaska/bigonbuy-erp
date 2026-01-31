-- 0343_fin_coa_control_roles.sql
-- COA semantic control roles for account mapping

alter table public.erp_gl_accounts
  add column if not exists control_role text null;

alter table public.erp_gl_accounts
  add column if not exists is_control_account boolean not null default false;

create unique index if not exists erp_gl_accounts_company_control_role_unique
  on public.erp_gl_accounts (company_id, control_role)
  where control_role is not null;

create index if not exists erp_gl_accounts_company_control_role_idx
  on public.erp_gl_accounts (company_id, control_role);

create index if not exists erp_gl_accounts_company_is_control_idx
  on public.erp_gl_accounts (company_id, is_control_account);

create or replace function public.erp_fin_coa_control_roles_list()
returns table(
  role_key text,
  account_id uuid,
  account_code text,
  account_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with roles(role_key) as (
    values
      ('bank_main'),
      ('vendor_payable'),
      ('vendor_advance'),
      ('tds_payable'),
      ('input_gst_cgst'),
      ('input_gst_sgst'),
      ('input_gst_igst'),
      ('inventory_asset'),
      ('gateway_clearing')
  )
  select
    r.role_key,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name
  from roles r
  left join public.erp_gl_accounts a
    on a.company_id = public.erp_current_company_id()
    and a.control_role = r.role_key
  order by r.role_key;
end;
$$;

revoke all on function public.erp_fin_coa_control_roles_list() from public;
grant execute on function public.erp_fin_coa_control_roles_list() to authenticated;

create or replace function public.erp_fin_coa_control_role_set(
  p_role text,
  p_account_id uuid,
  p_is_control boolean default true
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := nullif(trim(lower(p_role)), '');
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_gl_accounts;
  v_allowed boolean := false;
  v_account_exists boolean := false;
begin
  perform public.erp_require_finance_writer();

  if v_role is null then
    raise exception 'control role is required';
  end if;

  v_allowed := v_role = any (array[
    'bank_main',
    'vendor_payable',
    'vendor_advance',
    'tds_payable',
    'input_gst_cgst',
    'input_gst_sgst',
    'input_gst_igst',
    'inventory_asset',
    'gateway_clearing'
  ]);

  if not v_allowed then
    raise exception 'unsupported control role: %', v_role;
  end if;

  if p_account_id is null then
    raise exception 'account_id is required for role %', v_role;
  end if;

  select true
    into v_account_exists
    from public.erp_gl_accounts a
   where a.company_id = v_company_id
     and a.id = p_account_id;

  if not v_account_exists then
    raise exception 'account not found for role %', v_role;
  end if;

  update public.erp_gl_accounts
     set control_role = null,
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and control_role = v_role
     and id <> p_account_id;

  update public.erp_gl_accounts
     set control_role = v_role,
         is_control_account = coalesce(p_is_control, true),
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and id = p_account_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.erp_fin_coa_control_role_set(text, uuid, boolean) from public;
grant execute on function public.erp_fin_coa_control_role_set(text, uuid, boolean) to authenticated;

create or replace function public.erp_fin_account_by_role(
  p_role text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := nullif(trim(lower(p_role)), '');
  v_account_id uuid;
begin
  perform public.erp_require_finance_reader();

  if v_role is null then
    raise exception 'control role is required';
  end if;

  select a.id
    into v_account_id
    from public.erp_gl_accounts a
   where a.company_id = public.erp_current_company_id()
     and a.control_role = v_role;

  if v_account_id is null then
    raise exception 'COA control role not mapped: %', v_role;
  end if;

  return v_account_id;
end;
$$;

revoke all on function public.erp_fin_account_by_role(text) from public;
grant execute on function public.erp_fin_account_by_role(text) to authenticated;
