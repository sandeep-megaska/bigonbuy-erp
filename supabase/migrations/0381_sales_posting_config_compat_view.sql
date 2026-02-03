-- 0381_sales_posting_config_compat_view.sql
begin;

-- Safety: only create if the canonical table exists
do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema='public'
      and table_name='erp_sales_finance_posting_config'
  ) then
    raise exception 'Missing canonical table: public.erp_sales_finance_posting_config';
  end if;
end$$;

-- Create compatibility view expected by UI/older code
create or replace view public.erp_sales_posting_config as
select *
from public.erp_sales_finance_posting_config;

-- (Optional) if you use grants pattern on views
-- grant select on public.erp_sales_posting_config to authenticated;

commit;
