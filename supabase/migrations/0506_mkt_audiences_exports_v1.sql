begin;

create or replace view public.erp_mkt_audience_purchasers_180d_v1 as
with shopify_orders as (
  select
    lower(trim(o.customer_email)) as email,
    nullif(trim(coalesce(o.raw_order #>> '{shipping_address,phone}', o.raw_order #>> '{customer,phone}')), '') as phone,
    nullif(trim(o.raw_order #>> '{shipping_address,city}'), '') as city,
    nullif(trim(coalesce(o.shipping_state_code, o.raw_order #>> '{shipping_address,province_code}')), '') as state,
    nullif(trim(coalesce(o.shipping_pincode, o.raw_order #>> '{shipping_address,zip}')), '') as zip,
    nullif(trim(o.raw_order #>> '{shipping_address,country_code}'), '') as country,
    coalesce(o.processed_at, o.order_created_at) as purchase_at,
    coalesce(o.total_price, 0::numeric) as order_revenue,
    'shopify'::text as channel
  from public.erp_shopify_orders o
  where o.company_id = public.erp_current_company_id()
    and coalesce(o.is_cancelled, false) = false
    and coalesce(o.processed_at, o.order_created_at) >= now() - interval '180 days'
),
amazon_orders as (
  select
    lower(trim(o.buyer_email)) as email,
    null::text as phone,
    nullif(trim(coalesce(o.ship_city, o.shipping_address_city)), '') as city,
    nullif(trim(coalesce(o.ship_state, o.shipping_address_state)), '') as state,
    nullif(trim(coalesce(o.ship_postal_code, o.shipping_address_postal_code)), '') as zip,
    nullif(trim(o.shipping_address_country_code), '') as country,
    o.purchase_date as purchase_at,
    coalesce(o.order_total, 0::numeric) as order_revenue,
    'amazon'::text as channel
  from public.erp_amazon_orders o
  where o.company_id = public.erp_current_company_id()
    and o.purchase_date >= now() - interval '180 days'
    and coalesce(upper(o.order_status), '') not in ('CANCELLED', 'CANCELED')
),
all_orders as (
  select * from shopify_orders
  union all
  select * from amazon_orders
),
per_person as (
  select
    a.email,
    a.phone,
    a.city,
    a.state,
    a.zip,
    a.country,
    a.purchase_at as last_event_at,
    max(a.purchase_at) over (partition by coalesce(a.email, ''), coalesce(a.phone, '')) as person_last_event_at,
    bool_or(a.channel = 'shopify') over (partition by coalesce(a.email, ''), coalesce(a.phone, '')) as has_shopify,
    bool_or(a.channel = 'amazon') over (partition by coalesce(a.email, ''), coalesce(a.phone, '')) as has_amazon
  from all_orders a
)
select distinct on (coalesce(p.email, ''), coalesce(p.phone, ''))
  p.email,
  p.phone,
  p.city,
  p.state,
  p.zip,
  p.country,
  case
    when p.has_shopify and p.has_amazon then 'blended'
    when p.has_shopify then 'shopify'
    when p.has_amazon then 'amazon'
    else 'shopify'
  end as source,
  p.person_last_event_at as last_event_at
from per_person p
where p.email is not null or p.phone is not null
order by coalesce(p.email, ''), coalesce(p.phone, ''), p.last_event_at desc nulls last;

create or replace view public.erp_mkt_audience_vip_buyers_180d_v1 as
with shopify_orders as (
  select
    lower(trim(o.customer_email)) as email,
    nullif(trim(coalesce(o.raw_order #>> '{shipping_address,phone}', o.raw_order #>> '{customer,phone}')), '') as phone,
    nullif(trim(o.raw_order #>> '{shipping_address,city}'), '') as city,
    nullif(trim(coalesce(o.shipping_state_code, o.raw_order #>> '{shipping_address,province_code}')), '') as state,
    nullif(trim(coalesce(o.shipping_pincode, o.raw_order #>> '{shipping_address,zip}')), '') as zip,
    nullif(trim(o.raw_order #>> '{shipping_address,country_code}'), '') as country,
    coalesce(o.processed_at, o.order_created_at) as purchase_at,
    coalesce(o.total_price, 0::numeric) as order_revenue
  from public.erp_shopify_orders o
  where o.company_id = public.erp_current_company_id()
    and coalesce(o.is_cancelled, false) = false
    and coalesce(o.processed_at, o.order_created_at) >= now() - interval '180 days'
),
amazon_orders as (
  select
    lower(trim(o.buyer_email)) as email,
    null::text as phone,
    nullif(trim(coalesce(o.ship_city, o.shipping_address_city)), '') as city,
    nullif(trim(coalesce(o.ship_state, o.shipping_address_state)), '') as state,
    nullif(trim(coalesce(o.ship_postal_code, o.shipping_address_postal_code)), '') as zip,
    nullif(trim(o.shipping_address_country_code), '') as country,
    o.purchase_date as purchase_at,
    coalesce(o.order_total, 0::numeric) as order_revenue
  from public.erp_amazon_orders o
  where o.company_id = public.erp_current_company_id()
    and o.purchase_date >= now() - interval '180 days'
    and coalesce(upper(o.order_status), '') not in ('CANCELLED', 'CANCELED')
),
all_orders as (
  select * from shopify_orders
  union all
  select * from amazon_orders
),
person_rollup as (
  select
    coalesce(email, '') as email_key,
    coalesce(phone, '') as phone_key,
    max(email) filter (where email is not null) as email,
    max(phone) filter (where phone is not null) as phone,
    (array_agg(city order by purchase_at desc nulls last) filter (where city is not null))[1] as city,
    (array_agg(state order by purchase_at desc nulls last) filter (where state is not null))[1] as state,
    (array_agg(zip order by purchase_at desc nulls last) filter (where zip is not null))[1] as zip,
    (array_agg(country order by purchase_at desc nulls last) filter (where country is not null))[1] as country,
    sum(coalesce(order_revenue, 0::numeric)) as gross_revenue,
    max(purchase_at) as last_event_at
  from all_orders
  where email is not null or phone is not null
  group by coalesce(email, ''), coalesce(phone, '')
),
ranked as (
  select
    r.*,
    ntile(5) over (order by r.gross_revenue desc, r.last_event_at desc nulls last, r.email_key asc, r.phone_key asc) as revenue_tile
  from person_rollup r
)
select distinct on (coalesce(v.email, ''), coalesce(v.phone, ''))
  v.email,
  v.phone,
  v.city,
  v.state,
  v.zip,
  v.country,
  'blended'::text as source,
  v.last_event_at
from ranked v
where v.revenue_tile = 1
  and (v.email is not null or v.phone is not null)
order by coalesce(v.email, ''), coalesce(v.phone, ''), v.last_event_at desc nulls last;

create or replace view public.erp_mkt_audience_atc_30d_no_purchase_v1 as
with atc_events as (
  select
    lower(trim(i.email)) as email,
    nullif(trim(i.phone), '') as phone,
    nullif(trim(i.city), '') as city,
    nullif(trim(i.state), '') as state,
    null::text as zip,
    nullif(trim(i.country), '') as country,
    e.event_time as atc_time
  from public.erp_mkt_capi_events e
  join public.erp_mkt_identity_map i
    on i.id = e.identity_id
   and i.company_id = public.erp_current_company_id()
  where e.company_id = public.erp_current_company_id()
    and e.event_name in ('AddToCart', 'InitiateCheckout', 'CheckoutStarted')
    and e.event_time >= now() - interval '30 days'
    and (nullif(trim(i.email), '') is not null or nullif(trim(i.phone), '') is not null)
),
purchasers_180d as (
  select
    coalesce(lower(trim(email)), '') as email_key,
    coalesce(trim(phone), '') as phone_key
  from public.erp_mkt_audience_purchasers_180d_v1
),
filtered as (
  select
    a.*,
    max(a.atc_time) over (partition by coalesce(a.email, ''), coalesce(a.phone, '')) as person_last_event_at
  from atc_events a
  where not exists (
    select 1
    from purchasers_180d p
    where p.email_key = coalesce(a.email, '')
      and p.phone_key = coalesce(a.phone, '')
  )
)
select distinct on (coalesce(f.email, ''), coalesce(f.phone, ''))
  f.email,
  f.phone,
  f.city,
  f.state,
  f.zip,
  f.country,
  'atc'::text as source,
  f.person_last_event_at as last_event_at
from filtered f
order by coalesce(f.email, ''), coalesce(f.phone, ''), f.atc_time desc nulls last;

grant select on public.erp_mkt_audience_purchasers_180d_v1 to authenticated, service_role;
grant select on public.erp_mkt_audience_vip_buyers_180d_v1 to authenticated, service_role;
grant select on public.erp_mkt_audience_atc_30d_no_purchase_v1 to authenticated, service_role;

-- Acceptance SQL
-- 1) Purchasers:
-- select count(*) from public.erp_mkt_audience_purchasers_180d_v1;
-- select * from public.erp_mkt_audience_purchasers_180d_v1 limit 5;
--
-- 2) VIP:
-- select count(*) from public.erp_mkt_audience_vip_buyers_180d_v1;
-- select * from public.erp_mkt_audience_vip_buyers_180d_v1 limit 5;
--
-- 3) ATC:
-- select count(*) from public.erp_mkt_audience_atc_30d_no_purchase_v1;
-- select * from public.erp_mkt_audience_atc_30d_no_purchase_v1 limit 5;
--
-- 4) Ensure identifiers exist:
-- select count(*) filter (where email is null and phone is null) as bad_rows
-- from public.erp_mkt_audience_purchasers_180d_v1;

commit;
