begin;

create or replace view public.erp_sales_posting_config as
select
  id,
  company_id,
  sales_revenue_account_id,
  gst_output_account_id,
  receivable_account_id,
  is_active,
  updated_at,
  updated_by_user_id,
  created_at,
  created_by_user_id,

  -- Append new compatibility column LAST to avoid column-position renames
  receivable_account_id as clearing_account_id
from public.erp_sales_finance_posting_config;

commit;
