-- 0430_vendor_sku_assignments_and_bom_validation.sql
-- Vendor SKU assignment mapping for MFG BOM SKU restrictions

create table if not exists public.erp_vendor_sku_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  sku text not null,
  is_active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'po_auto')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  constraint erp_vendor_sku_assignments_company_vendor_sku_uniq unique (company_id, vendor_id, sku)
);

create index if not exists erp_vendor_sku_assignments_company_vendor_active_idx
  on public.erp_vendor_sku_assignments (company_id, vendor_id, is_active);

create or replace function public.erp_vendor_assigned_skus_list_v1(
  p_company_id uuid,
  p_vendor_id uuid
) returns table (
  sku text,
  variant_id uuid,
  product_title text
)
language sql
security definer
set search_path = public
as $$
  select
    a.sku,
    v.id as variant_id,
    p.title as product_title
  from public.erp_vendor_sku_assignments a
  left join public.erp_variants v
    on v.company_id = a.company_id
   and lower(v.sku) = lower(a.sku)
  left join public.erp_products p
    on p.id = v.product_id
   and p.company_id = a.company_id
  where a.company_id = p_company_id
    and a.vendor_id = p_vendor_id
    and a.is_active = true
  order by lower(a.sku);
$$;

create or replace function public.erp_vendor_sku_assignments_upsert_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_sku text,
  p_is_active boolean default true,
  p_source text default 'manual',
  p_created_by uuid default null
) returns public.erp_vendor_sku_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := trim(coalesce(p_sku, ''));
  v_source text := lower(trim(coalesce(p_source, 'manual')));
  v_row public.erp_vendor_sku_assignments;
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_sku = '' then
    raise exception 'sku is required';
  end if;

  if v_source not in ('manual', 'po_auto') then
    raise exception 'source must be manual or po_auto';
  end if;

  insert into public.erp_vendor_sku_assignments (
    company_id,
    vendor_id,
    sku,
    is_active,
    source,
    created_by
  ) values (
    p_company_id,
    p_vendor_id,
    v_sku,
    coalesce(p_is_active, true),
    v_source,
    p_created_by
  )
  on conflict (company_id, vendor_id, sku)
  do update
     set is_active = excluded.is_active,
         source = excluded.source
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
  v_sku text := trim(coalesce(p_sku, ''));
  v_status text := lower(trim(coalesce(p_status, 'draft')));
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

  if v_status not in ('draft', 'active', 'archived') then
    raise exception 'status must be draft, active, or archived';
  end if;

  if v_status = 'active' then
    if exists (
      select 1
      from public.erp_mfg_boms b
      where b.company_id = p_company_id
        and b.vendor_id = p_vendor_id
        and lower(b.sku) = lower(v_sku)
        and b.status = 'active'
        and (p_bom_id is null or b.id <> p_bom_id)
    ) then
      raise exception 'Another active BOM already exists for this SKU';
    end if;
  end if;

  if p_bom_id is null then
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
      v_status,
      nullif(trim(coalesce(p_notes, '')), ''),
      now()
    )
    returning * into v_row;

    return v_row;
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
    raise exception 'Another active BOM already exists for this SKU';
end;
$$;

revoke all on function public.erp_vendor_assigned_skus_list_v1(uuid, uuid) from public;
revoke all on function public.erp_vendor_sku_assignments_upsert_v1(uuid, uuid, text, boolean, text, uuid) from public;
revoke all on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) from public;

grant execute on function public.erp_vendor_assigned_skus_list_v1(uuid, uuid) to service_role;
grant execute on function public.erp_vendor_sku_assignments_upsert_v1(uuid, uuid, text, boolean, text, uuid) to service_role;
grant execute on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) to service_role;
