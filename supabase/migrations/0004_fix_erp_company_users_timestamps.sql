-- 0004_fix_erp_company_users_timestamps.sql
-- Add timestamps expected by RPCs and keep updated_at current.

alter table public.erp_company_users
  add column if not exists created_at timestamptz not null default now();

alter table public.erp_company_users
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.erp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_erp_company_users_set_updated_at on public.erp_company_users;

create trigger trg_erp_company_users_set_updated_at
before update on public.erp_company_users
for each row
execute function public.erp_set_updated_at();
