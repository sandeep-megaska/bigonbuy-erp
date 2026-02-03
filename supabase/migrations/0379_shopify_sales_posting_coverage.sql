-- 0379_shopify_sales_posting_coverage.sql
-- Shopify order -> finance posting coverage (summary + list)

begin;

create or replace function public.erp_sales_shopify_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_count int,
  posted_count int,
  missing_count int,
  total_amount numeric,
  posted_amount numeric,
  missing_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with gst_totals as (
    select
      r.source_order_id as order_id,
      coalesce(sum(r.taxable_value + r.shipping_taxable_value), 0) as net_sales,
      coalesce(sum(r.total_tax), 0) as gst_amount,
      count(*) as line_count
    from public.erp_gst_sales_register r
    where r.company_id = v_company_id
      and r.is_void = false
    group by r.source_order_id
  ),
  orders as (
    select
      o.id,
      (o.is_cancelled or o.cancelled_at is not null) as is_excluded,
      round(
        case
          when coalesce(g.line_count, 0) > 0 then coalesce(g.net_sales, 0)
          else coalesce(o.subtotal_price, 0) - coalesce(o.total_discounts, 0) + coalesce(o.total_shipping, 0)
        end,
        2
      ) as net_sales,
      round(
        case
          when coalesce(g.line_count, 0) > 0 then coalesce(g.gst_amount, 0)
          else coalesce(o.total_tax, 0)
        end,
        2
      ) as gst_amount
    from public.erp_shopify_orders o
    left join gst_totals g
      on g.order_id = o.id
    where o.company_id = v_company_id
      and o.order_created_at::date between p_from and p_to
  ),
  base as (
    select
      o.id,
      (o.net_sales + o.gst_amount) as gross_total
    from orders o
    where o.is_excluded = false
  ),
  posts as (
    select p.source_id
    from public.erp_sales_finance_posts p
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  )
  select
    count(*)::int as total_count,
    count(p.source_id)::int as posted_count,
    (count(*) - count(p.source_id))::int as missing_count,
    coalesce(sum(b.gross_total), 0) as total_amount,
    coalesce(sum(case when p.source_id is not null then b.gross_total end), 0) as posted_amount,
    coalesce(sum(case when p.source_id is null then b.gross_total end), 0) as missing_amount
  from base b
  left join posts p
    on p.source_id = b.id;
end;
$$;

revoke all on function public.erp_sales_shopify_posting_summary(date, date) from public;
grant execute on function public.erp_sales_shopify_posting_summary(date, date) to authenticated;

create or replace function public.erp_shopify_orders_list_with_posting(
  p_from date,
  p_to date,
  p_search text default null,
  p_posting_filter text default 'all'
) returns table (
  order_id uuid,
  shopify_order_id bigint,
  order_no text,
  order_date date,
  customer_name text,
  currency text,
  financial_status text,
  net_amount numeric,
  tax_amount numeric,
  gross_amount numeric,
  posting_state text,
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
  with gst_totals as (
    select
      r.source_order_id as order_id,
      coalesce(sum(r.taxable_value + r.shipping_taxable_value), 0) as net_sales,
      coalesce(sum(r.total_tax), 0) as gst_amount,
      count(*) as line_count
    from public.erp_gst_sales_register r
    where r.company_id = v_company_id
      and r.is_void = false
    group by r.source_order_id
  ),
  base as (
    select
      o.id as order_id,
      o.shopify_order_id,
      coalesce(o.shopify_order_number, o.shopify_order_id::text) as order_no,
      o.order_created_at::date as order_date,
      coalesce(
        nullif(trim(concat_ws(' ', nullif(o.raw_order #>> '{customer,first_name}', ''), nullif(o.raw_order #>> '{customer,last_name}', ''))), ''),
        nullif(o.customer_email, '')
      ) as customer_name,
      o.currency,
      o.financial_status,
      o.created_at,
      (o.is_cancelled or o.cancelled_at is not null) as is_excluded,
      round(
        case
          when coalesce(g.line_count, 0) > 0 then coalesce(g.net_sales, 0)
          else coalesce(o.subtotal_price, 0) - coalesce(o.total_discounts, 0) + coalesce(o.total_shipping, 0)
        end,
        2
      ) as net_amount,
      round(
        case
          when coalesce(g.line_count, 0) > 0 then coalesce(g.gst_amount, 0)
          else coalesce(o.total_tax, 0)
        end,
        2
      ) as tax_amount
    from public.erp_shopify_orders o
    left join gst_totals g
      on g.order_id = o.id
    where o.company_id = v_company_id
      and o.order_created_at::date between p_from and p_to
      and (
        p_search is null
        or p_search = ''
        or o.shopify_order_number ilike ('%' || p_search || '%')
        or o.shopify_order_id::text ilike ('%' || p_search || '%')
        or coalesce(o.customer_email, '') ilike ('%' || p_search || '%')
        or coalesce(o.raw_order #>> '{customer,first_name}', '') ilike ('%' || p_search || '%')
        or coalesce(o.raw_order #>> '{customer,last_name}', '') ilike ('%' || p_search || '%')
      )
  ),
  posts as (
    select
      p.source_id as order_id,
      p.finance_doc_id as journal_id,
      j.doc_no as journal_no
    from public.erp_sales_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.finance_doc_id
    where p.company_id = v_company_id
      and p.source_type = 'shopify_order'
      and p.status = 'posted'
  ),
  merged as (
    select
      b.order_id,
      b.shopify_order_id,
      b.order_no,
      b.order_date,
      b.customer_name,
      b.currency,
      b.financial_status,
      b.net_amount,
      b.tax_amount,
      (b.net_amount + b.tax_amount) as gross_amount,
      case
        when b.is_excluded then 'excluded'
        when p.journal_id is not null then 'posted'
        else 'missing'
      end as posting_state,
      p.journal_id,
      p.journal_no,
      b.created_at
    from base b
    left join posts p
      on p.order_id = b.order_id
  )
  select
    m.order_id,
    m.shopify_order_id,
    m.order_no,
    m.order_date,
    m.customer_name,
    m.currency,
    m.financial_status,
    m.net_amount,
    m.tax_amount,
    m.gross_amount,
    m.posting_state,
    m.journal_id,
    m.journal_no
  from merged m
  where
    v_pf = 'all'
    or (v_pf = 'posted' and m.posting_state = 'posted')
    or (v_pf = 'missing' and m.posting_state = 'missing')
    or (v_pf = 'excluded' and m.posting_state = 'excluded')
  order by m.order_date desc, m.created_at desc nulls last;
end;
$$;

revoke all on function public.erp_shopify_orders_list_with_posting(date, date, text, text) from public;
grant execute on function public.erp_shopify_orders_list_with_posting(date, date, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
