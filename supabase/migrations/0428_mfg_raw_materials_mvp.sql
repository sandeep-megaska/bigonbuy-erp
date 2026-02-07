-- 0428_mfg_raw_materials_mvp.sql
-- MFG-RM-0: vendor-scoped raw materials master + append-only stock ledger + alerts + RPCs

create table if not exists public.erp_mfg_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  name text not null,
  category text null,
  default_uom text not null,
  reorder_point numeric not null default 0,
  lead_time_days integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists erp_mfg_materials_company_vendor_name_uniq
  on public.erp_mfg_materials (company_id, vendor_id, lower(name));

create index if not exists erp_mfg_materials_company_vendor_idx
  on public.erp_mfg_materials (company_id, vendor_id);

create index if not exists erp_mfg_materials_company_vendor_active_idx
  on public.erp_mfg_materials (company_id, vendor_id, is_active);

create table if not exists public.erp_mfg_material_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors(id) on delete cascade,
  material_id uuid not null references public.erp_mfg_materials(id) on delete restrict,
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('OPENING', 'PURCHASE_IN', 'ADJUST_IN', 'ADJUST_OUT', 'CONSUME_OUT')),
  qty_in numeric not null default 0 check (qty_in >= 0),
  qty_out numeric not null default 0 check (qty_out >= 0),
  uom text not null,
  reference_type text null,
  reference_id uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by_session_id uuid null references public.erp_mfg_sessions(id) on delete set null,
  constraint erp_mfg_material_ledger_qty_direction_chk check (
    (qty_in > 0 and qty_out = 0) or (qty_out > 0 and qty_in = 0)
  )
);

create index if not exists erp_mfg_material_ledger_company_vendor_material_date_idx
  on public.erp_mfg_material_ledger (company_id, vendor_id, material_id, entry_date desc);

create index if not exists erp_mfg_material_ledger_company_vendor_entry_type_idx
  on public.erp_mfg_material_ledger (company_id, vendor_id, entry_type);

create or replace function public.erp_mfg_material_ledger_block_changes_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'erp_mfg_material_ledger is append-only';
end;
$$;

drop trigger if exists erp_mfg_material_ledger_no_updates on public.erp_mfg_material_ledger;
create trigger erp_mfg_material_ledger_no_updates
before update or delete on public.erp_mfg_material_ledger
for each row
execute function public.erp_mfg_material_ledger_block_changes_v1();

create or replace view public.erp_mfg_material_balances_v as
select
  m.company_id,
  m.vendor_id,
  m.id as material_id,
  m.name,
  m.category,
  m.default_uom,
  m.reorder_point,
  m.lead_time_days,
  m.is_active,
  coalesce(sum(l.qty_in - l.qty_out), 0)::numeric as on_hand_qty,
  max(l.created_at) as last_movement_at
from public.erp_mfg_materials m
left join public.erp_mfg_material_ledger l
  on l.material_id = m.id
 and l.company_id = m.company_id
 and l.vendor_id = m.vendor_id
group by
  m.company_id,
  m.vendor_id,
  m.id,
  m.name,
  m.category,
  m.default_uom,
  m.reorder_point,
  m.lead_time_days,
  m.is_active;

create or replace view public.erp_mfg_material_alerts_v as
select
  b.company_id,
  b.vendor_id,
  b.material_id,
  b.name,
  b.category,
  b.default_uom,
  b.reorder_point,
  b.lead_time_days,
  b.on_hand_qty,
  b.last_movement_at,
  case
    when b.on_hand_qty < 0 then 'NEGATIVE'
    when b.on_hand_qty <= 0 then 'OUT'
    when coalesce(b.reorder_point, 0) > 0 and b.on_hand_qty <= b.reorder_point then 'LOW'
    else 'OK'
  end as status
from public.erp_mfg_material_balances_v b
where b.is_active = true;

create or replace function public.erp_mfg_material_create_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_name text,
  p_category text default null,
  p_default_uom text default null,
  p_reorder_point numeric default 0,
  p_lead_time_days integer default 0
) returns public.erp_mfg_materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_mfg_materials;
  v_name text := trim(coalesce(p_name, ''));
  v_uom text := trim(coalesce(p_default_uom, ''));
  v_category text := nullif(trim(coalesce(p_category, '')), '');
begin
  if p_company_id is null or p_vendor_id is null then
    raise exception 'company_id and vendor_id are required';
  end if;

  if v_name = '' then
    raise exception 'name is required';
  end if;

  if v_uom = '' then
    raise exception 'default_uom is required';
  end if;

  if coalesce(p_reorder_point, 0) < 0 then
    raise exception 'reorder_point cannot be negative';
  end if;

  if coalesce(p_lead_time_days, 0) < 0 then
    raise exception 'lead_time_days cannot be negative';
  end if;

  insert into public.erp_mfg_materials (
    company_id,
    vendor_id,
    name,
    category,
    default_uom,
    reorder_point,
    lead_time_days,
    updated_at
  ) values (
    p_company_id,
    p_vendor_id,
    v_name,
    v_category,
    v_uom,
    coalesce(p_reorder_point, 0),
    coalesce(p_lead_time_days, 0),
    now()
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Material already exists for this vendor';
end;
$$;

create or replace function public.erp_mfg_materials_list_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_only_active boolean default true
) returns table (
  material_id uuid,
  name text,
  category text,
  default_uom text,
  reorder_point numeric,
  lead_time_days integer,
  is_active boolean,
  on_hand_qty numeric,
  last_movement_at timestamptz,
  status text
)
language sql
security definer
set search_path = public
as $$
  select
    b.material_id,
    b.name,
    b.category,
    b.default_uom,
    b.reorder_point,
    b.lead_time_days,
    b.is_active,
    b.on_hand_qty,
    b.last_movement_at,
    case
      when b.on_hand_qty < 0 then 'NEGATIVE'
      when b.on_hand_qty <= 0 then 'OUT'
      when coalesce(b.reorder_point, 0) > 0 and b.on_hand_qty <= b.reorder_point then 'LOW'
      else 'OK'
    end as status
  from public.erp_mfg_material_balances_v b
  where b.company_id = p_company_id
    and b.vendor_id = p_vendor_id
    and (not coalesce(p_only_active, true) or b.is_active = true)
  order by
    case
      when b.on_hand_qty < 0 then 1
      when b.on_hand_qty <= 0 then 2
      when coalesce(b.reorder_point, 0) > 0 and b.on_hand_qty <= b.reorder_point then 3
      else 4
    end,
    b.name;
$$;

create or replace function public.erp_mfg_material_ledger_add_v1(
  p_company_id uuid,
  p_vendor_id uuid,
  p_material_id uuid,
  p_entry_type text,
  p_qty numeric,
  p_uom text,
  p_entry_date date default current_date,
  p_notes text default null
) returns public.erp_mfg_material_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_mfg_material_ledger;
  v_entry_type text := upper(trim(coalesce(p_entry_type, '')));
  v_qty numeric := coalesce(p_qty, 0);
  v_uom text := trim(coalesce(p_uom, ''));
  v_material public.erp_mfg_materials;
  v_qty_in numeric := 0;
  v_qty_out numeric := 0;
begin
  if p_company_id is null or p_vendor_id is null or p_material_id is null then
    raise exception 'company_id, vendor_id and material_id are required';
  end if;

  if v_qty <= 0 then
    raise exception 'qty must be greater than zero';
  end if;

  if v_uom = '' then
    raise exception 'uom is required';
  end if;

  if v_entry_type not in ('OPENING', 'PURCHASE_IN', 'ADJUST_IN', 'ADJUST_OUT') then
    raise exception 'Unsupported entry_type';
  end if;

  select *
    into v_material
  from public.erp_mfg_materials m
  where m.id = p_material_id
    and m.company_id = p_company_id
    and m.vendor_id = p_vendor_id
  limit 1;

  if v_material.id is null then
    raise exception 'Invalid material_id for vendor';
  end if;

  if v_uom <> v_material.default_uom then
    raise exception 'uom must match material default_uom';
  end if;

  if v_entry_type in ('OPENING', 'PURCHASE_IN', 'ADJUST_IN') then
    v_qty_in := v_qty;
  else
    v_qty_out := v_qty;
  end if;

  insert into public.erp_mfg_material_ledger (
    company_id,
    vendor_id,
    material_id,
    entry_date,
    entry_type,
    qty_in,
    qty_out,
    uom,
    notes
  ) values (
    p_company_id,
    p_vendor_id,
    p_material_id,
    coalesce(p_entry_date, current_date),
    v_entry_type,
    v_qty_in,
    v_qty_out,
    v_uom,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.erp_mfg_material_alerts_list_v1(
  p_company_id uuid,
  p_vendor_id uuid
) returns table (
  material_id uuid,
  name text,
  category text,
  default_uom text,
  reorder_point numeric,
  lead_time_days integer,
  on_hand_qty numeric,
  status text,
  last_movement_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    a.material_id,
    a.name,
    a.category,
    a.default_uom,
    a.reorder_point,
    a.lead_time_days,
    a.on_hand_qty,
    a.status,
    a.last_movement_at
  from public.erp_mfg_material_alerts_v a
  where a.company_id = p_company_id
    and a.vendor_id = p_vendor_id
    and a.status in ('NEGATIVE', 'OUT', 'LOW')
  order by
    case a.status
      when 'NEGATIVE' then 1
      when 'OUT' then 2
      when 'LOW' then 3
      else 4
    end,
    a.name;
$$;

revoke all on function public.erp_mfg_material_create_v1(uuid, uuid, text, text, text, numeric, integer) from public;
revoke all on function public.erp_mfg_materials_list_v1(uuid, uuid, boolean) from public;
revoke all on function public.erp_mfg_material_ledger_add_v1(uuid, uuid, uuid, text, numeric, text, date, text) from public;
revoke all on function public.erp_mfg_material_alerts_list_v1(uuid, uuid) from public;

grant execute on function public.erp_mfg_material_create_v1(uuid, uuid, text, text, text, numeric, integer) to service_role;
grant execute on function public.erp_mfg_materials_list_v1(uuid, uuid, boolean) to service_role;
grant execute on function public.erp_mfg_material_ledger_add_v1(uuid, uuid, uuid, text, numeric, text, date, text) to service_role;
grant execute on function public.erp_mfg_material_alerts_list_v1(uuid, uuid) to service_role;
