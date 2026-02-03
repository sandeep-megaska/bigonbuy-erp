begin;

alter table if exists public.erp_rbac_permissions
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;

with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    row_number() over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as row_num,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select
    pr.id,
    pr.canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
update public.erp_rbac_hr_designation_permissions dp
set permission_id = pm.canonical_id
from permission_map pm
where dp.permission_id = pm.id;

with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    row_number() over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as row_num,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select
    pr.id,
    pr.canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
update public.erp_rbac_designation_permissions dp
set permission_id = pm.canonical_id
from permission_map pm
where dp.permission_id = pm.id;

with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    row_number() over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as row_num
  from public.erp_rbac_permissions p
)
update public.erp_rbac_permissions p
set
  is_active = false,
  retired_at = now(),
  retired_reason = 'deduped by migration 0371'
from permission_rank pr
where p.id = pr.id
  and pr.row_num > 1
  and p.is_active;

delete from public.erp_rbac_hr_designation_permissions dp
where dp.ctid not in (
  select min(sub.ctid)
  from public.erp_rbac_hr_designation_permissions sub
  group by sub.hr_designation_id, sub.permission_id
);

delete from public.erp_rbac_designation_permissions dp
where dp.ctid not in (
  select min(sub.ctid)
  from public.erp_rbac_designation_permissions sub
  group by sub.designation_id, sub.permission_id
);

create unique index if not exists erp_rbac_permissions_perm_module_active_unique
  on public.erp_rbac_permissions (perm_key, module_key)
  where is_active;

commit;

-- Verification queries (manual run only)
-- select perm_key, module_key, count(*)
-- from public.erp_rbac_permissions
-- where is_active
-- group by perm_key, module_key
-- having count(*) > 1;

-- select hr_designation_id, permission_id, count(*)
-- from public.erp_rbac_hr_designation_permissions
-- group by hr_designation_id, permission_id
-- having count(*) > 1;

-- select designation_id, permission_id, count(*)
-- from public.erp_rbac_designation_permissions
-- group by designation_id, permission_id
-- having count(*) > 1;

-- select perm_key, module_key, count(*)
-- from public.erp_rbac_permissions
-- where perm_key in (
--   'hr_self_exit',
--   'hr_self_leave',
--   'hr_self_profile',
--   'inventory_read',
--   'inventory_write',
--   'inventory_stocktake',
--   'inventory_transfer'
-- )
-- and is_active
-- group by perm_key, module_key;
