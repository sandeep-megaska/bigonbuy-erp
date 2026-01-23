-- 0202_fix_company_settings_updated_by_service.sql
-- Purpose:
-- Ensure gmail service updates always set updated_by to a real user.

create or replace function public.erp_company_settings_update_gmail_service(
  p_company_id uuid,
  p_gmail_user text,
  p_connected boolean,
  p_last_synced_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_company_settings
     set gmail_user = p_gmail_user,
         gmail_connected = p_connected,
         gmail_last_synced_at = p_last_synced_at,
         updated_at = now(),
         updated_by = coalesce(
           (select created_by
              from public.erp_company_settings
             where company_id = p_company_id),
           (select user_id
              from public.erp_company_users
             where company_id = p_company_id
               and role = 'owner'
             order by created_at asc
             limit 1),
           (select user_id
              from public.erp_company_users
             where company_id = p_company_id
             order by created_at asc
             limit 1),
           (select auth.uid())
         )
   where company_id = p_company_id;
end;
$$;

revoke all on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) from public;
revoke all on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) from authenticated;
grant execute on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) to service_role;
