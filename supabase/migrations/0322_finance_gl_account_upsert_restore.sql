create or replace function public.erp_gl_account_upsert(
  p_code text,
  p_name text,
  p_account_type text,
  p_is_active boolean default true,
  p_id uuid default null
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_gl_accounts;
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_type text := lower(p_account_type);
  v_normal text;
begin
  perform public.erp_require_finance_writer();

  if p_code is null or btrim(p_code) = '' then
    raise exception 'code is required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  if v_type not in ('asset','liability','income','expense','equity') then
    raise exception 'invalid account_type: %', p_account_type;
  end if;

  v_normal := case when v_type in ('asset','expense') then 'debit' else 'credit' end;

  if p_id is null then
    insert into public.erp_gl_accounts(
      company_id, code, name, account_type, normal_balance,
      is_active, created_by_user_id, updated_by_user_id
    ) values (
      v_company_id, btrim(p_code), btrim(p_name), v_type, v_normal,
      coalesce(p_is_active,true), v_actor, v_actor
    )
    returning * into v_row;
  else
    update public.erp_gl_accounts
       set code = btrim(p_code),
           name = btrim(p_name),
           account_type = v_type,
           normal_balance = v_normal,
           is_active = coalesce(p_is_active,true),
           updated_at = now(),
           updated_by_user_id = v_actor
     where company_id = v_company_id
       and id = p_id
     returning * into v_row;

    if not found then
      raise exception 'account not found';
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.erp_gl_account_upsert(text, text, text, boolean, uuid) from public;
grant execute on function public.erp_gl_account_upsert(text, text, text, boolean, uuid) to authenticated;

create or replace function public.erp_gl_account_upsert(
  p_account_type text,
  p_code text,
  p_id uuid,
  p_is_active boolean,
  p_name text
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_gl_accounts;
begin
  perform public.erp_require_finance_writer();
  select * into v_row
  from public.erp_gl_account_upsert(
    p_code,
    p_name,
    p_account_type,
    p_is_active,
    p_id
  );
  return v_row;
end;
$$;

revoke all on function public.erp_gl_account_upsert(text, text, uuid, boolean, text) from public;
grant execute on function public.erp_gl_account_upsert(text, text, uuid, boolean, text) to authenticated;
