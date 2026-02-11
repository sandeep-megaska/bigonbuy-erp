-- 0480_growth_cockpit_summary.sql
-- CEO Growth Cockpit RPC (JSON summary)

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

    with

    blended as (
        select
            avg(case when date >= current_date - interval '7 days' then blended_roas end) as roas_7d,
            avg(case when date >= current_date - interval '30 days' then blended_roas end) as roas_30d
        from erp_mkt_blended_roas_daily_v1
        where company_id = v_company_id
          and date between v_from and v_to
    ),

    revenue as (
        select
            sum(shopify_revenue) as shopify_rev,
            sum(amazon_revenue) as amazon_rev
        from erp_mkt_channel_revenue_pivot_daily_v1
        where company_id = v_company_id
          and date between v_from and v_to
    ),

    spend as (
        select
            sum(spend) as meta_spend
        from erp_mkt_meta_spend_daily_v1
        where company_id = v_company_id
          and date between v_from and v_to
    ),

    top_skus as (
        select jsonb_agg(t) as data
        from (
            select sku, revenue
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
        'blended_roas_7d', blended.roas_7d,
        'blended_roas_30d', blended.roas_30d,
        'meta_spend', spend.meta_spend,
        'shopify_revenue', revenue.shopify_rev,
        'amazon_revenue', revenue.amazon_rev,
        'd2c_share_pct',
            case
                when (revenue.shopify_rev + revenue.amazon_rev) = 0 then 0
                else revenue.shopify_rev /
                     (revenue.shopify_rev + revenue.amazon_rev)
            end,
        'top_skus', top_skus.data,
        'top_cities', top_cities.data
    )
    into v_result
    from blended, revenue, spend, top_skus, top_cities;

    return v_result;

end;
$$;
