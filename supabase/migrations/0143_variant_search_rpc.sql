create or replace function public.erp_variant_search(
  p_query text,
  p_limit int default 20
) returns table (
  variant_id uuid,
  sku text,
  size text,
  color text,
  product_id uuid,
  style_code text,
  title text,
  hsn_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(trim(p_query), '') as q
  ),
  base as (
    select v.id as variant_id,
           v.sku,
           v.size,
           v.color,
           p.id as product_id,
           p.style_code,
           p.title,
           p.hsn_code,
           case
             when v.sku = (select q from normalized) then 1
             when v.sku ilike (select q from normalized) || '%' then 2
             when p.style_code ilike (select q from normalized) || '%' then 3
             when p.title ilike (select q from normalized) || '%' then 4
             else 5
           end as sort_rank
      from public.erp_variants v
      join public.erp_products p on p.id = v.product_id
     where v.company_id = public.erp_current_company_id()
       and p.company_id = public.erp_current_company_id()
       and (
         v.sku ilike '%' || (select q from normalized) || '%'
         or p.style_code ilike '%' || (select q from normalized) || '%'
         or p.title ilike '%' || (select q from normalized) || '%'
         or coalesce(v.color, '') ilike '%' || (select q from normalized) || '%'
         or coalesce(v.size, '') ilike '%' || (select q from normalized) || '%'
       )
  )
  select variant_id,
         sku,
         size,
         color,
         product_id,
         style_code,
         title,
         hsn_code
    from base
   order by sort_rank, sku
   limit coalesce(p_limit, 20);
$$;

revoke all on function public.erp_variant_search(text, int) from public;
grant execute on function public.erp_variant_search(text, int) to authenticated;
