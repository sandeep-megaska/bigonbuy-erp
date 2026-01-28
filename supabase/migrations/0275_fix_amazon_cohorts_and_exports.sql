create or replace function public.erp_amazon_analytics_customer_cohorts(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_cohort_grain text default 'month'
) returns table (
  cohort_start date,
  period_index int,
  customers int,
  repeat_customers int,
  orders int,
  gross numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_cohort_grain, 'month'));
  v_trunc text;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('month', 'week') then
    raise exception 'cohort grain must be month or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'month' end;

  perform public.erp_require_analytics_reader();

  return query
  with customer_first as (
    select
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end as customer_key,
      min(f.purchase_date)::date as first_purchase_date
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
    group by 1
  ),
  scoped as (
    select
      f.amazon_order_id,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end as customer_key,
      cf.first_purchase_date,
      date_trunc(v_trunc, cf.first_purchase_date)::date as cohort_start,
      case
        when v_trunc = 'week' then
          floor(
            extract(epoch from (date_trunc('week', f.purchase_date) - date_trunc('week', cf.first_purchase_date)))
            / (60 * 60 * 24 * 7)
          )::int
        else
          ((date_part('year', f.purchase_date) - date_part('year', cf.first_purchase_date)) * 12
            + (date_part('month', f.purchase_date) - date_part('month', cf.first_purchase_date)))::int
      end as period_index,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
    from public.erp_amazon_order_facts f
    join customer_first cf
      on case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end = cf.customer_key
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  )
  select
    s.cohort_start,
    s.period_index,
    count(distinct s.customer_key)::int as customers,
    count(distinct s.customer_key) filter (where s.period_index > 0)::int as repeat_customers,
    count(distinct s.amazon_order_id)::int as orders,
    sum(s.gross) as gross
  from scoped s
  group by s.cohort_start, s.period_index
  order by s.cohort_start, s.period_index;
end;
$$;

revoke all on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) from public;

grant execute on function public.erp_amazon_analytics_customer_cohorts(text, date, date, text) to authenticated;

create or replace function public.erp_amazon_analytics_customer_cohorts_page(
  p_marketplace_id text,
  p_from date,
  p_to date,
  p_cohort_grain text default 'month',
  p_limit int default 500,
  p_offset int default 0
) returns table (
  cohort_start date,
  period_index int,
  customers int,
  repeat_customers int,
  orders int,
  gross numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_grain text := lower(coalesce(p_cohort_grain, 'month'));
  v_trunc text;
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  if v_grain not in ('month', 'week') then
    raise exception 'cohort grain must be month or week';
  end if;

  v_trunc := case when v_grain = 'week' then 'week' else 'month' end;

  perform public.erp_require_analytics_reader();

  return query
  with customer_first as (
    select
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end as customer_key,
      min(f.purchase_date)::date as first_purchase_date
    from public.erp_amazon_order_facts f
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
    group by 1
  ),
  scoped as (
    select
      f.amazon_order_id,
      case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end as customer_key,
      cf.first_purchase_date,
      date_trunc(v_trunc, cf.first_purchase_date)::date as cohort_start,
      case
        when v_trunc = 'week' then
          floor(
            extract(epoch from (date_trunc('week', f.purchase_date) - date_trunc('week', cf.first_purchase_date)))
            / (60 * 60 * 24 * 7)
          )::int
        else
          ((date_part('year', f.purchase_date) - date_part('year', cf.first_purchase_date)) * 12
            + (date_part('month', f.purchase_date) - date_part('month', cf.first_purchase_date)))::int
      end as period_index,
      (coalesce(f.item_amount, 0) + coalesce(f.shipping_amount, 0) + coalesce(f.gift_wrap_amount, 0)
        - coalesce(f.promo_discount, 0)) as gross
    from public.erp_amazon_order_facts f
    join customer_first cf
      on case
        when f.buyer_email is not null and trim(f.buyer_email) <> '' then lower(trim(f.buyer_email))
        when f.ship_postal_code is not null and trim(f.ship_postal_code) <> '' then 'postal:' || trim(f.ship_postal_code)
        else 'order:' || f.amazon_order_id
      end = cf.customer_key
    where f.company_id = v_company_id
      and f.marketplace_id = v_marketplace_id
      and f.purchase_date::date >= v_from
      and f.purchase_date::date <= v_to
  )
  select
    s.cohort_start,
    s.period_index,
    count(distinct s.customer_key)::int as customers,
    count(distinct s.customer_key) filter (where s.period_index > 0)::int as repeat_customers,
    count(distinct s.amazon_order_id)::int as orders,
    sum(s.gross) as gross
  from scoped s
  group by s.cohort_start, s.period_index
  order by s.cohort_start, s.period_index
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.erp_amazon_analytics_customer_cohorts_page(text, date, date, text, int, int) from public;

grant execute on function public.erp_amazon_analytics_customer_cohorts_page(text, date, date, text, int, int) to authenticated;

create or replace function public.erp_amazon_analytics_customer_cohort_email_stats(
  p_marketplace_id text,
  p_from date,
  p_to date
) returns table (
  total_rows int,
  missing_email_rows int,
  missing_email_ratio numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_marketplace_id text := nullif(trim(p_marketplace_id), '');
  v_from date := p_from;
  v_to date := p_to;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if v_marketplace_id is null then
    raise exception 'marketplace_id is required';
  end if;

  if v_from is null or v_to is null then
    raise exception 'from/to dates are required';
  end if;

  perform public.erp_require_analytics_reader();

  return query
  select
    count(*)::int as total_rows,
    count(*) filter (where f.buyer_email is null or trim(f.buyer_email) = '')::int as missing_email_rows,
    case
      when count(*) = 0 then 0
      else (count(*) filter (where f.buyer_email is null or trim(f.buyer_email) = ''))::numeric / count(*)
    end as missing_email_ratio
  from public.erp_amazon_order_facts f
  where f.company_id = v_company_id
    and f.marketplace_id = v_marketplace_id
    and f.purchase_date::date >= v_from
    and f.purchase_date::date <= v_to;
end;
$$;

revoke all on function public.erp_amazon_analytics_customer_cohort_email_stats(text, date, date) from public;

grant execute on function public.erp_amazon_analytics_customer_cohort_email_stats(text, date, date) to authenticated;
