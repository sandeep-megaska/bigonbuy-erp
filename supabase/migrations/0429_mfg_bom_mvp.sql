-- 0429_mfg_bom_mvp.sql
-- MFG-RM-0B: vendor-managed BOM master for SKU-level recipes

create table if not exists public.erp_mfg_boms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  sku text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_mfg_bom_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  bom_id uuid not null references public.erp_mfg_boms(id) on delete cascade,
  material_id uuid not null references public.erp_mfg_materials(id) on delete restrict,
  qty_per_unit numeric not null,
  uom text not null,
  waste_pct numeric null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists erp_mfg_boms_company_vendor_sku_idx
  on public.erp_mfg_boms (company_id, vendor_id, sku);

create unique index if not exists erp_mfg_boms_company_vendor_active_sku_uniq
  on public.erp_mfg_boms (company_id, vendor_id, lower(sku))
  where status = 'active';

create index if not exists erp_mfg_bom_lines_company_vendor_bom_idx
  on public.erp_mfg_bom_lines (company_id, vendor_id, bom_id);

create or replace function public.erp_mfg_boms_list_v1(
  p_company_id uuid,
  p_vendor_id uuid
) returns table (
  id uuid,
  sku text,
  status text,
  notes text,
  line_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    b.id,
    b.sku,
    b.status,
    b.notes,
    count(l.id)::bigint as line_count,
    b.created_at,
    b.updated_at
  from public.erp_mfg_boms b
  left join public.erp_mfg_bom_lines l
    on l.bom_id = b.id
   and l.company_id = b.company_id
   and l.vendor_id = b.vendor_id
  where b.company_id = p_company_id
    and b.vendor_id = p_vendor_id
  group by b.id, b.sku, b.status, b.notes, b.created_at, b.updated_at
  order by b.updated_at desc, b.created_at desc;
$$;

create or replace function public.erp_mfg_bom_get_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_bom_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom public.erp_mfg_boms;
  v_lines jsonb;
begin
  if p_company_id is null or p_vendor_id is null or p_bom_id is null then
    raise exception 'company_id, vendor_id, and bom_id are required';
  end if;

  select *
    into v_bom
  from public.erp_mfg_boms b
  where b.id = p_bom_id
    and b.company_id = p_company_id
    and b.vendor_id = p_vendor_id
  limit 1;

  if v_bom.id is null then
    raise exception 'BOM not found for vendor';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'bom_id', l.bom_id,
      'material_id', l.material_id,
      'qty_per_unit', l.qty_per_unit,
      'uom', l.uom,
      'waste_pct', l.waste_pct,
      'notes', l.notes,
      'created_at', l.created_at
    ) order by l.created_at, l.id), '[]'::jsonb)
    into v_lines
  from public.erp_mfg_bom_lines l
  where l.company_id = p_company_id
    and l.vendor_id = p_vendor_id
    and l.bom_id = p_bom_id;

  return jsonb_build_object(
    'bom', to_jsonb(v_bom),
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
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

create or replace function public.erp_mfg_bom_lines_replace_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_bom_id uuid,
  p_lines jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom public.erp_mfg_boms;
  v_line jsonb;
  v_material_id uuid;
  v_qty numeric;
  v_uom text;
  v_waste_pct numeric;
  v_notes text;
  v_inserted integer := 0;
begin
  if p_company_id is null or p_vendor_id is null or p_bom_id is null then
    raise exception 'company_id, vendor_id, and bom_id are required';
  end if;

  if p_lines is null then
    p_lines := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be a JSON array';
  end if;

  select *
    into v_bom
  from public.erp_mfg_boms b
  where b.id = p_bom_id
    and b.company_id = p_company_id
    and b.vendor_id = p_vendor_id
  limit 1;

  if v_bom.id is null then
    raise exception 'BOM not found for vendor';
  end if;

  delete from public.erp_mfg_bom_lines l
  where l.company_id = p_company_id
    and l.vendor_id = p_vendor_id
    and l.bom_id = p_bom_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_material_id := (v_line->>'material_id')::uuid;
    exception
      when others then
        raise exception 'Invalid material_id in lines payload';
    end;

    v_qty := coalesce((v_line->>'qty_per_unit')::numeric, 0);
    v_uom := trim(coalesce(v_line->>'uom', ''));
    v_waste_pct := nullif(trim(coalesce(v_line->>'waste_pct', '')), '')::numeric;
    v_notes := nullif(trim(coalesce(v_line->>'notes', '')), '');

    if v_material_id is null then
      raise exception 'material_id is required for each line';
    end if;

    if v_qty <= 0 then
      raise exception 'qty_per_unit must be greater than zero';
    end if;

    if v_uom = '' then
      raise exception 'uom is required for each line';
    end if;

    if v_waste_pct is not null and v_waste_pct < 0 then
      raise exception 'waste_pct cannot be negative';
    end if;

    if not exists (
      select 1
      from public.erp_mfg_materials m
      where m.id = v_material_id
        and m.company_id = p_company_id
        and m.vendor_id = p_vendor_id
    ) then
      raise exception 'Invalid material_id for vendor';
    end if;

    insert into public.erp_mfg_bom_lines (
      company_id,
      vendor_id,
      bom_id,
      material_id,
      qty_per_unit,
      uom,
      waste_pct,
      notes
    ) values (
      p_company_id,
      p_vendor_id,
      p_bom_id,
      v_material_id,
      v_qty,
      v_uom,
      v_waste_pct,
      v_notes
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.erp_mfg_boms_list_v1(uuid, uuid) from public;
revoke all on function public.erp_mfg_bom_get_v1(uuid, uuid, uuid) from public;
revoke all on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.erp_mfg_bom_lines_replace_v1(uuid, uuid, uuid, jsonb) from public;

grant execute on function public.erp_mfg_boms_list_v1(uuid, uuid) to service_role;
grant execute on function public.erp_mfg_bom_get_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.erp_mfg_bom_upsert_v1(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.erp_mfg_bom_lines_replace_v1(uuid, uuid, uuid, jsonb) to service_role;
