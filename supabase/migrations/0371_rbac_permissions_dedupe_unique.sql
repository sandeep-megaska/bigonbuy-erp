begin;

-- 1) Add soft-retire fields to permission master (audit-safe; no deletes)
alter table if exists public.erp_rbac_permissions
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;

-- 2) Build a canonical permission map ONCE (old_id -> canonical_id)
-- Using a TEMP table avoids repeating WITH blocks and prevents parser issues.
create temporary table if not exists _rbac_perm_map (
  old_id uuid primary key,
  canonical_id uuid not null
) on commit drop;

truncate table _rbac_perm_map;

insert into _rbac_perm_map (old_id, canonical_id)
with permission_rank as (
  select
    p.id,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
)
select
  pr.id as old_id,
  pr.canonical_id
from permission_rank pr
where pr.id <> pr.canonical_id;

-- 3A) HR mapping: delete OLD rows that would collide with an existing CANONICAL row
delete from public.erp_rbac_hr_designation_permissions dp_old
using _rbac_perm_map pm
where dp_old.permission_id = pm.old_id
  and exists (
    select 1
    from public.erp_rbac_hr_designation_permissions dp_can
    where dp_can.hr_designation_id = dp_old.hr_designation_id
      and dp_can.permission_id = pm.canonical_id
  );

-- 3B) HR mapping: update remaining rows to canonical permission ids
update public.erp_rbac_hr_designation_permissions dp
set permission_id = pm.canonical_id
from _rbac_perm_map pm
where dp.permission_id = pm.old_id;

-- 3C) HR mapping: remove any duplicates (safety)
delete from public.erp_rbac_hr_designation_permissions dp
where dp.ctid in (
  select ctid
  from (
    select
      dp.ctid,
      row_number() over (
        partition by dp.hr_designation_id, dp.permission_id
        order by dp.ctid
      ) as rn
    from public.erp_rbac_hr_designation_permissions dp
  ) x
  where x.rn > 1
);

-- 4A) Legacy designation mapping: delete OLD rows that would collide with an existing CANONICAL row
delete from public.erp_rbac_designation_permissions dp_old
using _rbac_perm_map pm
where dp_old.permission_id = pm.old_id
  and exists (
    select 1
    from public.erp_rbac_designation_permissions dp_can
    where dp_can.designation_id = dp_old.designation_id
      and dp_can.permission_id = pm.canonical_id
  );

-- 4B) Legacy designation mapping: update remaining rows to canonical permission ids
update public.erp_rbac_designation_permissions dp
set permission_id = pm.canonical_id
from _rbac_perm_map pm
where dp.permission_id = pm.old_id;

-- 4C) Legacy designation mapping: remove any duplicates (safety)
delete from public.erp_rbac_designation_permissions dp
where dp.ctid in (
  select ctid
  from (
    select
      dp.ctid,
      row_number() over (
        partition by dp.designation_id, dp.permission_id
        order by dp.ctid
      ) as rn
    from public.erp_rbac_designation_permissions dp
  ) x
  where x.rn > 1
);

-- 5) Soft-retire duplicate permission rows (keep canonical active)
with permission_rank as (
  select
    p.id,
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

-- 6) Enforce uniqueness going forward: one ACTIVE permission per (perm_key,module_key)
create unique index if not exists erp_rbac_permissions_perm_module_active_unique
  on public.erp_rbac_permissions (perm_key, module_key)
  where is_active;

commit;

-- Verification (manual run only)
-- select perm_key, module_key, count(*)
-- from public.erp_rbac_permissions
-- where is_active
-- group by perm_key, module_key
-- having count(*) > 1;

-- select hr_designation_id, permission_id, count(*)
-- from public.erp_rbac_hr_designation_permissions
-- group by hr_designation_id, permission_id
-- having count(*) > 1;
