-- 0006_set_correct_owner.sql
-- Set the intended owner for the single company.
-- Target owner: 9673523f-3485-4acc-97c4-6a4662e48743 (bigonbuy1@gmail.com)

do $$
declare
  v_company_id uuid := 'b19c6a4e-7c6a-4b1a-9e4e-2d2b0b3a3b0a';
  v_target_owner uuid := '9673523f-3485-4acc-97c4-6a4662e48743';
begin
  -- Ensure target user exists in company_users (at least as employee) so we can promote
  insert into public.erp_company_users (company_id, user_id, role_key)
  values (v_company_id, v_target_owner, 'employee')
  on conflict (company_id, user_id) do nothing;

  -- Demote any current owner(s) to admin first (important due to partial unique owner index)
  update public.erp_company_users
  set role_key = 'admin',
      updated_at = now()
  where company_id = v_company_id
    and role_key = 'owner'
    and user_id <> v_target_owner;

  -- Promote target user to owner
  update public.erp_company_users
  set role_key = 'owner',
      updated_at = now()
  where company_id = v_company_id
    and user_id = v_target_owner;

  -- Safety: ensure exactly one owner exists after change
  if (select count(*) from public.erp_company_users where company_id = v_company_id and role_key = 'owner') <> 1 then
    raise exception 'Owner reassignment failed: expected exactly 1 owner after migration';
  end if;
end $$;
