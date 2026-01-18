-- 0160_expense_engine_schema_align.sql
-- Align existing expense tables with Phase-1 schema (safe/idempotent)

-- Categories: group_key
alter table public.erp_expense_categories
  add column if not exists group_key text;

update public.erp_expense_categories
set group_key = coalesce(group_key, 'other')
where group_key is null;

create index if not exists erp_expense_categories_company_group_idx
  on public.erp_expense_categories (company_id, group_key);

-- Expenses: add missing columns used by indexes and UI
alter table public.erp_expenses
  add column if not exists channel_id uuid references public.erp_sales_channels(id);

alter table public.erp_expenses
  add column if not exists warehouse_id uuid references public.erp_warehouses(id);

alter table public.erp_expenses
  add column if not exists vendor_id uuid references public.erp_vendors(id);

alter table public.erp_expenses
  add column if not exists payee_name text;

alter table public.erp_expenses
  add column if not exists reference text;

alter table public.erp_expenses
  add column if not exists description text;

alter table public.erp_expenses
  add column if not exists currency text;

update public.erp_expenses
set currency = coalesce(currency, 'INR')
where currency is null;

alter table public.erp_expenses
  add column if not exists is_recurring boolean;

update public.erp_expenses
set is_recurring = coalesce(is_recurring, false)
where is_recurring is null;

alter table public.erp_expenses
  add column if not exists recurring_rule text;

alter table public.erp_expenses
  add column if not exists allocation_type text;

update public.erp_expenses
set allocation_type = coalesce(allocation_type, 'direct')
where allocation_type is null;

alter table public.erp_expenses
  add column if not exists attachment_url text;

-- Indexes (only if columns exist now)
create index if not exists erp_expenses_company_date_idx
  on public.erp_expenses (company_id, expense_date);

create index if not exists erp_expenses_company_category_idx
  on public.erp_expenses (company_id, category_id);

create index if not exists erp_expenses_company_channel_idx
  on public.erp_expenses (company_id, channel_id);

create index if not exists erp_expenses_company_warehouse_idx
  on public.erp_expenses (company_id, warehouse_id);
