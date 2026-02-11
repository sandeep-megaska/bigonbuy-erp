-- 0483_mkt_daily_kpi_refresh.sql

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
        company_id,
        dt,
        channel,
        revenue
    )
    select
        company_id,
        order_date::date as dt,
        channel,
        sum(net_revenue) as revenue
    from public.erp_sales_channel_orders
    where company_id = v_company_id
    group by company_id, dt, channel
    on conflict (company_id, dt, channel)
    do update
    set revenue = excluded.revenue;

end;
$$;
