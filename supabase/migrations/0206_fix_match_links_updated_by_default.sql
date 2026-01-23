-- 0206_fix_match_links_audit_columns.sql
-- Make match_links audit columns valid and enforce NOT NULL safely.

alter table public.erp_settlement_match_links
  add column if not exists is_active boolean not null default true;

alter table public.erp_settlement_match_links
  add column if not exists removed_at timestamptz null;

alter table public.erp_settlement_match_links
  add column if not exists removed_by uuid null;

alter table public.erp_settlement_match_links
  add column if not exists updated_at timestamptz;

update public.erp_settlement_match_links
   set updated_at = coalesce(updated_at, created_at, now())
 where updated_at is null;

alter table public.erp_settlement_match_links
  alter column updated_at set not null;

alter table public.erp_settlement_match_links
  alter column updated_at set default now();

alter table public.erp_settlement_match_links
  add column if not exists updated_by uuid;

update public.erp_settlement_match_links
   set updated_by = coalesce(updated_by, created_by)
 where updated_by is null;

alter table public.erp_settlement_match_links
  alter column updated_by set not null;

alter table public.erp_settlement_match_links
  alter column updated_by set default auth.uid();
