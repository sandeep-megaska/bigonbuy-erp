-- 0482_growth_cockpit_summary_stabilized.sql
-- Final stabilized CEO Growth Cockpit RPC

create or replace function public.erp_growth_cockpit_summary_v1(
    p_from date default null,
    p_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_company_id uuid := public.erp_current_company_id();
    v_from date := coalesce(p_from, current_date - interval '30 days');
    v_to date := coalesce(p_to, current_date);

    v_result jsonb;
begin

    with kpi as (
        select
            avg(case when dt >= current_date - interval '7 days' then blended_roas end) as roas_7d,
            avg(case when dt >= current_date - interval '30 days' then blended_roas end) as roas_30d,
            sum(meta_spend) as meta_spend,
            sum(shopify_revenue) as shopify_revenue,
            sum(amazon_revenue) as amazon_revenue,
            avg(d2c_share) as d2c_share
        from erp_mkt_blended_roas_daily_v1
        where company_id = v_company_id
          and dt between v_from and v_to
    ),

    top_skus as (
        select jsonb_agg(t) as data
        from (
            select sku_code, revenue, orders_count
            from erp_mkt_sku_scores
            where company_id = v_company_id
            order by revenue desc
            limit 10
        ) t
    ),

    top_cities as (
        select jsonb_agg(t) as data
        from (
            select city, revenue
            from erp_mkt_city_scores
            where company_id = v_company_id
            order by revenue desc
            limit 10
        ) t
    )

    select jsonb_build_object(
        'blended_roas_7d', kpi.roas_7d,
        'blended_roas_30d', kpi.roas_30d,
        'meta_spend', kpi.meta_spend,
        'shopify_revenue', kpi.shopify_revenue,
        'amazon_revenue', kpi.amazon_revenue,
        'd2c_share_pct', kpi.d2c_share,
        'top_skus', top_skus.data,
        'top_cities', top_cities.data
    )
    into v_result
    from kpi, top_skus, top_cities;

    return v_result;

end;
$$;
