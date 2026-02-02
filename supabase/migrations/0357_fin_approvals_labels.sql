-- 0357_fin_approvals_labels.sql
-- Human-readable labels for finance approvals

create or replace view public.erp_fin_pending_approvals_v as
select
  a.id,
  a.company_id,
  a.entity_type,
  a.entity_id,
  a.state,
  a.requested_by,
  a.requested_at,
  a.reviewed_by,
  a.reviewed_at,
  a.review_comment,
  case
    when a.entity_type in ('vendor_payment', 'ap_payment') then
      case
        when coalesce(pv.legal_name, '') <> '' then 'Vendor Payment - ' || pv.legal_name
        else 'Vendor Payment'
      end
    when a.entity_type in ('vendor_bill', 'ap_bill') then
      case
        when coalesce(bv.legal_name, '') <> '' then 'Vendor Bill - ' || bv.legal_name
        else 'Vendor Bill'
      end
    when a.entity_type = 'month_close' then
      'Month Close ' || mc.fiscal_year || ' P' || lpad(mc.period_month::text, 2, '0')
    when a.entity_type = 'period_unlock' then
      'Period Unlock ' || pl.fiscal_year || ' P' || lpad(pl.period_month::text, 2, '0')
    when a.entity_type = 'payroll_post' then
      'Payroll Run ' || pr.year::text || '-' || lpad(pr.month::text, 2, '0')
    else a.entity_type
  end as entity_label,
  case
    when a.entity_type in ('vendor_payment', 'ap_payment') then nullif(p.reference_no, '')
    when a.entity_type in ('vendor_bill', 'ap_bill') then nullif(b.invoice_no, '')
    when a.entity_type = 'month_close' then mc.fiscal_year || '-' || lpad(mc.period_month::text, 2, '0')
    when a.entity_type = 'period_unlock' then pl.fiscal_year || '-' || lpad(pl.period_month::text, 2, '0')
    when a.entity_type = 'payroll_post' then pr.year::text || '-' || lpad(pr.month::text, 2, '0')
    else null
  end as entity_ref_no,
  case
    when a.entity_type in ('vendor_payment', 'ap_payment') then p.amount
    when a.entity_type in ('vendor_bill', 'ap_bill') then coalesce(b.net_payable, b.total)
    else null
  end as entity_amount,
  case
    when a.entity_type in ('vendor_payment', 'ap_payment') then p.payment_date::timestamptz
    when a.entity_type in ('vendor_bill', 'ap_bill') then b.invoice_date::timestamptz
    when a.entity_type = 'month_close' then coalesce(mc.closed_at, mc.updated_at, mc.created_at)
    when a.entity_type = 'period_unlock' then coalesce(pl.updated_at, pl.locked_at, pl.created_at)
    when a.entity_type = 'payroll_post' then coalesce(pr.finalized_at, pr.created_at)
    else null
  end as entity_date
from public.erp_fin_approvals a
left join public.erp_ap_vendor_payments p
  on p.id = a.entity_id
  and p.company_id = a.company_id
  and a.entity_type in ('vendor_payment', 'ap_payment')
left join public.erp_vendors pv
  on pv.id = p.vendor_id
  and pv.company_id = p.company_id
left join public.erp_gst_purchase_invoices b
  on b.id = a.entity_id
  and b.company_id = a.company_id
  and a.entity_type in ('vendor_bill', 'ap_bill')
left join public.erp_vendors bv
  on bv.id = b.vendor_id
  and bv.company_id = b.company_id
left join public.erp_fin_month_close mc
  on mc.id = a.entity_id
  and mc.company_id = a.company_id
  and a.entity_type = 'month_close'
left join public.erp_fin_period_locks pl
  on pl.id = a.entity_id
  and pl.company_id = a.company_id
  and a.entity_type = 'period_unlock'
left join public.erp_payroll_runs pr
  on pr.id = a.entity_id
  and pr.company_id = a.company_id
  and a.entity_type = 'payroll_post'
where a.state = 'submitted';

-- IMPORTANT: cannot change OUT rowtype with CREATE OR REPLACE
drop function if exists public.erp_fin_approvals_list(uuid, text, text);

create function public.erp_fin_approvals_list(
  p_company_id uuid,
  p_state text default null,
  p_entity_type text default null
) returns table(
  id uuid,
  company_id uuid,
  entity_type text,
  entity_id uuid,
  state text,
  requested_by uuid,
  requested_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comment text,
  entity_label text,
  entity_ref_no text,
  entity_amount numeric,
  entity_date timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    a.id,
    a.company_id,
    a.entity_type,
    a.entity_id,
    a.state,
    a.requested_by,
    a.requested_at,
    a.reviewed_by,
    a.reviewed_at,
    a.review_comment,
    coalesce(v.entity_label, a.entity_type) as entity_label,
    v.entity_ref_no,
    v.entity_amount,
    v.entity_date
  from public.erp_fin_approvals a
  left join public.erp_fin_pending_approvals_v v
    on v.id = a.id
   and v.company_id = a.company_id
  where a.company_id = p_company_id
    and (p_state is null or a.state = p_state)
    and (p_entity_type is null or a.entity_type = p_entity_type)
  order by a.requested_at desc;
end;
$$;

grant execute on function public.erp_fin_approvals_list(uuid, text, text) to authenticated;

