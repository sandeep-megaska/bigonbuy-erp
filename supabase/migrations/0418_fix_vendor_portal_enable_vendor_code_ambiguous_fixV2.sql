create or replace function public.erp_vendor_portal_enable(
  p_vendor_id uuid,
  p_company_id uuid
) returns table (
  vendor_id uuid,
  vendor_code text,
  temp_password text,
  login_url text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_is_authorized boolean := false;
  l_vendor_code text;
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_temp_password text;
  v_password_hash text;
  l_auth_user_id uuid;
begin
  -- (keep your existing body exactly)
end;
$$;
