CREATE OR REPLACE FUNCTION public.erp_company_settings_update_gmail_service(
  p_company_id uuid,
  p_gmail_user text,
  p_connected boolean,
  p_last_synced_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_updated_by uuid;
begin
  -- pick an updater user id deterministically, without assuming "role" column exists
  select coalesce(
    (select created_by from public.erp_company_settings where company_id = p_company_id limit 1),
    (select user_id from public.erp_company_users where company_id = p_company_id order by created_at asc limit 1),
    (select updated_by from public.erp_company_settings where company_id = p_company_id limit 1)
  )
  into v_updated_by;

  if v_updated_by is null then
    raise exception 'Cannot determine updated_by for company_settings (company_id=%)', p_company_id;
  end if;

  update public.erp_company_settings
     set gmail_user = coalesce(nullif(p_gmail_user,''), gmail_user),
         gmail_connected = coalesce(p_connected, gmail_connected),
         gmail_last_synced_at = coalesce(p_last_synced_at, gmail_last_synced_at),
         updated_at = now(),
         updated_by = v_updated_by
   where company_id = p_company_id;
end;
$$;

REVOKE ALL ON FUNCTION public.erp_company_settings_update_gmail_service(uuid,text,boolean,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_company_settings_update_gmail_service(uuid,text,boolean,timestamptz) TO service_role;
