begin;
create extension if not exists pgcrypto;
create extension if not exists pgcrypto schema extensions;

create or replace view public.erp_mkt_amazon_customer_facts_v1 as
select
  oi.company_id,
  lower(trim(oi.buyer_email)) as customer_key,
  encode(extensions.digest(lower(trim(oi.buyer_email)), 'sha256'), 'hex') as em_hash,
  sum(oi.quantity) as units,
  sum(oi.item_amount) as revenue
from public.erp_amazon_order_items oi
where oi.buyer_email is not null
group by
  oi.company_id,
  lower(trim(oi.buyer_email));

create or replace function public.erp_mkt_customer_scores_amazon_upsert_v1(
  p_company_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into public.erp_mkt_customer_scores (
    id,
    company_id,
    customer_key,
    em_hash,
    ltv,
    orders_count,
    aov,
    last_order_at,
    updated_at
  )
  select
    gen_random_uuid(),
    f.company_id,
    f.customer_key,
    f.em_hash,
    f.revenue,
    f.orders_count,
    case when f.orders_count > 0 then f.revenue / f.orders_count else 0 end,
    f.last_order_at,
    now()
  from public.erp_mkt_amazon_customer_facts_v1 f
  where f.company_id = p_company_id

  on conflict (company_id, customer_key)
  do update
  set
    ltv = excluded.ltv,
    orders_count = excluded.orders_count,
    aov = excluded.aov,
    last_order_at = excluded.last_order_at,
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

alter function public.erp_mkt_intelligence_refresh_v1(uuid, date, date)
  rename to erp_mkt_intelligence_refresh_core_v1;

create or replace function public.erp_mkt_intelligence_refresh_v1(
  p_actor_user_id uuid,
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
  v_result jsonb;
begin
  if v_company_id is null then
    raise exception 'Company context is required';
  end if;

  v_result := public.erp_mkt_intelligence_refresh_core_v1(
    p_actor_user_id,
    p_from,
    p_to
  );

  perform public.erp_mkt_customer_scores_amazon_upsert_v1(v_company_id);

  return v_result;
end;
$$;

revoke all on function public.erp_mkt_intelligence_refresh_v1(uuid, date, date) from public;
grant execute on function public.erp_mkt_intelligence_refresh_v1(uuid, date, date) to authenticated, service_role;

commit;
