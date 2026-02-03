begin;

-- 1) Add soft-retire fields to permission master (audit-safe; no deletes)
alter table if exists public.erp_rbac_permissions
  add column if not exists is_active boolean not null default true,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;

-- 2) Build canonical permission mapping (one canonical id per (perm_key,module_key))
-- Canonical = earliest created_at, then lowest id.
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
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)

-- 3A) PRE-DEDUPE collisions in HR mapping table BEFORE update (prevents unique constraint violation)
, hr_collisions as (
  select
    dp.hr_designation_id,
    dp.permission_id as old_permission_id,
    pm.canonical_id as new_permission_id,
    row_number() over (
      partition by dp.hr_designation_id, pm.canonical_id
      order by dp.ctid
    ) as rn
  from public.erp_rbac_hr_designation_permissions dp
  join permission_map pm
    on pm.old_id = dp.permission_id
)
delete from public.erp_rbac_hr_designation_permissions dp
using hr_collisions c
where dp.hr_designation_id = c.hr_designation_id
  and dp.permission_id = c.old_permission_id
  and c.rn > 1;

-- 3B) Update HR mapping to canonical permission ids (now safe)
with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
-- PRE-DELETE: if an old permission row would map to a canonical permission_id that already exists
-- for the same hr_designation_id, delete the old row first to avoid unique violation.
with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
delete from public.erp_rbac_hr_designation_permissions dp_old
using permission_map pm
where dp_old.permission_id = pm.old_id
  and exists (
    select 1
    from public.erp_rbac_hr_designation_permissions dp_can
    where dp_can.hr_designation_id = dp_old.hr_designation_id
      and dp_can.permission_id = pm.canonical_id
  );
-- PRE-DELETE: if an old permission row would map to a canonical permission_id that already exists
-- for the same designation_id, delete the old row first to avoid duplicates.
with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
delete from public.erp_rbac_designation_permissions dp_old
using permission_map pm
where dp_old.permission_id = pm.old_id
  and exists (
    select 1
    from public.erp_rbac_designation_permissions dp_can
    where dp_can.designation_id = dp_old.designation_id
      and dp_can.permission_id = pm.canonical_id
  );

update public.erp_rbac_hr_designation_permissions dp
set permission_id = pm.canonical_id
from permission_map pm
where dp.permission_id = pm.old_id;

-- 3C) PRE-DEDUPE collisions in legacy designation mapping table BEFORE update
with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
),
legacy_collisions as (
  select
    dp.designation_id,
    dp.permission_id as old_permission_id,
    pm.canonical_id as new_permission_id,
    row_number() over (
      partition by dp.designation_id, pm.canonical_id
      order by dp.ctid
    ) as rn
  from public.erp_rbac_designation_permissions dp
  join permission_map pm
    on pm.old_id = dp.permission_id
)
delete from public.erp_rbac_designation_permissions dp
using legacy_collisions c
where dp.designation_id = c.designation_id
  and dp.permission_id = c.old_permission_id
  and c.rn > 1;

-- 3D) Update legacy mapping to canonical permission ids (now safe)
with permission_rank as (
  select
    p.id,
    p.perm_key,
    p.module_key,
    first_value(p.id) over (
      partition by p.perm_key, p.module_key
      order by p.created_at asc, p.id asc
    ) as canonical_id
  from public.erp_rbac_permissions p
),
permission_map as (
  select distinct
    pr.id as old_id,
    pr.canonical_id as canonical_id
  from permission_rank pr
  where pr.id <> pr.canonical_id
)
update public.erp_rbac_designation_permissions dp
set permission_id = pm.canonical_id
from permission_map pm
where dp.permission_id = pm.old_id;

-- 4) Soft-retire duplicate permission rows (keep canonical active)
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

-- 5) Final safety: remove any remaining duplicates within mapping tables (post-update)
-- (Should be no-ops now, but keeps migration robust)
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

-- 6) Enforce uniqueness going forward: only one active permission per (perm_key,module_key)
create unique index if not exists erp_rbac_permissions_perm_module_active_unique
  on public.erp_rbac_permissions (perm_key, module_key)
  where is_active;

commit;

-- Verification queries (manual run only)
-- Active permissions must be unique:
-- select perm_key, module_key, count(*)
-- from public.erp_rbac_permissions
-- where is_active
-- group by perm_key, module_key
-- having count(*) > 1;

-- Mapping tables must have no duplicates:
-- select hr_designation_id, permission_id, count(*)
-- from public.erp_rbac_hr_designation_permissions
-- group by hr_designation_id, permission_id
-- having count(*) > 1;

-- select designation_id, permission_id, count(*)
-- from public.erp_rbac_designation_permissions
-- group by designation_id, permission_id
-- having count(*) > 1;
