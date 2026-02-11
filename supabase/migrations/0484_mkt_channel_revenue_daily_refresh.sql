-- 0483_mkt_channel_revenue_daily_refresh.sql
-- Populate erp_mkt_channel_revenue_daily from canonical ERP sales postings

create or replace function public.erp_mkt_channel_revenue_daily_refresh_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_company_id uuid := public.erp_current_company_id();
begin

    insert into public.erp_mkt_channel_revenue_daily (
        id,
        company_id,
        rev_date,
        channel,
        orders_count,
        units_count,
        gross_revenue,
        net_revenue,
        currency,
        source,
        created_at,
        updated_at
    )
    select
        gen_random_uuid(),
        company_id,
        order_date::date as rev_date,
        channel,
        count(*) as orders_count,
        sum(quantity) as units_count,
        sum(gross_amount) as gross_revenue,
        sum(net_amount) as net_revenue,
        'INR',
        jsonb_build_object('refresh','v1'),
        now(),
        now()
    from public.erp_sales_channel_orders
    where company_id = v_company_id
    group by company_id, rev_date, channel
    on conflict (company_id, rev_date, channel)
    do update
    set
        orders_count  = excluded.orders_count,
        units_count   = excluded.units_count,
        gross_revenue = excluded.gross_revenue,
        net_revenue   = excluded.net_revenue,
        updated_at    = now();

end;
$$;
