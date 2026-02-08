-- 20260208090000_enforce_single_bom_per_sku.sql
-- Enforce one BOM per (company_id, vendor_id, sku), with duplicate cleanup.

create temporary table if not exists tmp_erp_mfg_bom_dedupe_map on commit drop as
with ranked as (
  select
    b.id,
    b.company_id,
    b.vendor_id,
    b.sku,
    row_number() over (
      partition by b.company_id, b.vendor_id, b.sku
      order by
        case when b.status = 'active' then 0 else 1 end,
        b.updated_at desc nulls last,
        b.created_at desc nulls last,
        b.id
    ) as rn,
    first_value(b.id) over (
      partition by b.company_id, b.vendor_id, b.sku
      order by
        case when b.status = 'active' then 0 else 1 end,
        b.updated_at desc nulls last,
        b.created_at desc nulls last,
        b.id
    ) as keep_id
  from public.erp_mfg_boms b
)
select
  id as duplicate_id,
  keep_id
from ranked
where rn > 1;

update public.erp_mfg_bom_lines l
set bom_id = m.keep_id
from tmp_erp_mfg_bom_dedupe_map m
where l.bom_id = m.duplicate_id;

delete from public.erp_mfg_boms b
using tmp_erp_mfg_bom_dedupe_map m
where b.id = m.duplicate_id;

create unique index if not exists erp_mfg_boms_company_vendor_sku_uniq
  on public.erp_mfg_boms (company_id, vendor_id, sku);

create or replace function public.erp_mfg_bom_get_or_create_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_sku text
) returns public.erp_mfg_boms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := trim(coalesce(p_sku, ''));
  v_row public.erp_mfg_boms;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_sku = '' then
    raise exception 'sku is required';
  end if;

  if not exists (
    select 1
    from public.erp_vendor_sku_assignments a
    where a.company_id = p_company_id
      and a.vendor_id = p_vendor_id
      and lower(a.sku) = lower(v_sku)
      and a.is_active = true
  ) then
    raise exception 'SKU is not assigned to this vendor.';
  end if;

  insert into public.erp_mfg_boms (
    company_id,
    vendor_id,
    sku,
    status,
    notes,
    updated_at
  ) values (
    p_company_id,
    p_vendor_id,
    v_sku,
    'draft',
    null,
    now()
  )
  on conflict (company_id, vendor_id, sku)
  do update
     set sku = excluded.sku
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.erp_mfg_bom_upsert_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_bom_id uuid default null,
  p_sku text default null,
  p_status text default 'draft',
  p_notes text default null
) returns public.erp_mfg_boms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_mfg_boms;
  v_base public.erp_mfg_boms;
  v_sku text := trim(coalesce(p_sku, ''));
  v_status text := lower(trim(coalesce(p_status, 'draft')));
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_sku = '' then
    raise exception 'sku is required';
  end if;

  if v_status not in ('draft', 'active', 'archived') then
    raise exception 'status must be draft, active, or archived';
  end if;

  if p_bom_id is null then
    select *
      into v_base
    from public.erp_mfg_bom_get_or_create_v1(
      p_company_id => p_company_id,
      p_vendor_id => p_vendor_id,
      p_sku => v_sku
    );
    p_bom_id := v_base.id;
  end if;

  if not exists (
    select 1
    from public.erp_vendor_sku_assignments a
    where a.company_id = p_company_id
      and a.vendor_id = p_vendor_id
      and lower(a.sku) = lower(v_sku)
      and a.is_active = true
  ) then
    raise exception 'SKU is not assigned to this vendor.';
  end if;

  update public.erp_mfg_boms b
     set sku = v_sku,
         status = v_status,
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         updated_at = now()
   where b.id = p_bom_id
     and b.company_id = p_company_id
     and b.vendor_id = p_vendor_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'BOM not found for vendor';
  end if;

  return v_row;
exception
  when unique_violation then
    raise exception 'A BOM already exists for this SKU';
end;
$$;

revoke all on function public.erp_mfg_bom_get_or_create_v1(uuid, uuid, text) from public;
revoke all on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) from public;

grant execute on function public.erp_mfg_bom_get_or_create_v1(uuid, uuid, text) to service_role;
grant execute on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) to service_role;
