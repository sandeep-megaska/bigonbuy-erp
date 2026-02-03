-- 0377_fix_expenses_list_with_posting_channel_join.sql
-- Fix channel join: use erp_sales_channels (erp_channels does not exist).
-- Forward-only patch: 0376 already applied.

begin;

create or replace function public.erp_expenses_list_with_posting(
  p_from date,
  p_to date,
  p_category_id uuid default null,
  p_channel_id uuid default null,
  p_warehouse_id uuid default null,
  p_search text default null,
  p_posting_filter text default 'all' -- 'all' | 'posted' | 'missing' | 'excluded'
) returns table (
  id uuid,
  expense_date date,
  amount numeric,
  currency text,
  category_id uuid,
  category_name text,
  channel_id uuid,
  channel_name text,
  warehouse_id uuid,
  warehouse_name text,
  vendor_id uuid,
  vendor_name text,
  payee_name text,
  reference text,
  description text,

  is_capitalizable boolean,
  applies_to_type text,
  applied_to_inventory_at timestamptz,
  applied_inventory_ref text,

  posting_state text,          -- 'posted'|'missing'|'excluded'
  journal_id uuid,
  journal_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_pf text := lower(coalesce(nullif(trim(p_posting_filter), ''), 'all'));
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with base as (
    select
      e.*,
      c.name as category_name,
      ch.name as channel_name,
      w.name as warehouse_name,
      v.legal_name as vendor_name,

      (
        coalesce(e.is_capitalizable, false) = true
        or coalesce(e.applies_to_type, '') in ('grn', 'stock_transfer', 'ap_bill', 'vendor_bill', 'ap_vendor_bill')
        or e.applied_to_inventory_at is not null
        or e.applied_inventory_ref is not null
      ) as is_excluded
    from public.erp_expenses e
    left join public.erp_expense_categories c
      on c.company_id = v_company_id and c.id = e.category_id

    -- ✅ Correct channel master table
    left join public.erp_sales_channels ch
      on ch.company_id = v_company_id and ch.id = e.channel_id

    left join public.erp_warehouses w
      on w.company_id = v_company_id and w.id = e.warehouse_id
    left join public.erp_vendors v
      on v.company_id = v_company_id and v.id = e.vendor_id
    where e.company_id = v_company_id
      and e.expense_date between p_from and p_to
      and (p_category_id is null or e.category_id = p_category_id)
      and (p_channel_id is null or e.channel_id = p_channel_id)
      and (p_warehouse_id is null or e.warehouse_id = p_warehouse_id)
      and (
        p_search is null
        or p_search = ''
        or coalesce(e.reference,'') ilike ('%'||p_search||'%')
        or coalesce(e.payee_name,'') ilike ('%'||p_search||'%')
        or coalesce(v.legal_name,'') ilike ('%'||p_search||'%')
        or coalesce(e.description,'') ilike ('%'||p_search||'%')
      )
  ),
  posts as (
    select
      p.expense_id,
      p.finance_doc_id as journal_id,
      j.doc_no as journal_no
    from public.erp_expense_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.finance_doc_id
    where p.company_id = v_company_id
      and p.status = 'posted'
  ),
  merged as (
    select
      b.id,
      b.expense_date,
      b.amount,
      b.currency,
      b.category_id,
      b.category_name,
      b.channel_id,
      b.channel_name,
      b.warehouse_id,
      b.warehouse_name,
      b.vendor_id,
      b.vendor_name,
      b.payee_name,
      b.reference,
      b.description,
      b.is_capitalizable,
      b.applies_to_type,
      b.applied_to_inventory_at,
      b.applied_inventory_ref,
      case
        when b.is_excluded then 'excluded'
        when p.journal_id is not null then 'posted'
        else 'missing'
      end as posting_state,
      p.journal_id,
      p.journal_no
    from base b
    left join posts p
      on p.expense_id = b.id
  )
  select *
  from merged
  where
    v_pf = 'all'
    or (v_pf = 'posted' and posting_state = 'posted')
    or (v_pf = 'missing' and posting_state = 'missing')
    or (v_pf = 'excluded' and posting_state = 'excluded')
  order by expense_date desc, created_at desc nulls last;
end;
$$;

revoke all on function public.erp_expenses_list_with_posting(date,date,uuid,uuid,uuid,text,text) from public;
grant execute on function public.erp_expenses_list_with_posting(date,date,uuid,uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
