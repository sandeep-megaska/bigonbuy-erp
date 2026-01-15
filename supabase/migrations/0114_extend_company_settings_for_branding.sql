-- Extend company settings for branding assets

alter table public.erp_company_settings
  add column if not exists bigonbuy_logo_path text,
  add column if not exists megaska_logo_path text,
  add column if not exists setup_completed boolean not null default false,
  add column if not exists setup_completed_at timestamptz;

-- Ensure canonical company table has basic profile fields
alter table public.erp_companies
  add column if not exists legal_name text,
  add column if not exists brand_name text,
  add column if not exists country_code text,
  add column if not exists currency_code text;

-- Update RLS policies to allow all members to read settings,
-- but only owner/admin to update.
do $$
begin
  drop policy if exists erp_company_settings_select on public.erp_company_settings;
  drop policy if exists erp_company_settings_write on public.erp_company_settings;

  create policy erp_company_settings_select
    on public.erp_company_settings
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_company_settings_write
    on public.erp_company_settings
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    );
end
$$;
