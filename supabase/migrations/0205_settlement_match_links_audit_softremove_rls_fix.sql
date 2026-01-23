-- 0205_settlement_match_links_audit_softremove_rls_fix.sql
-- Patch 0204: audit-safe match links (soft remove), constraints, and RLS service_role fix.

-- ------------------------------------------------------------
-- 1) Constraints
-- ------------------------------------------------------------

alter table public.erp_settlement_match_groups
  drop constraint if exists erp_settlement_match_groups_status_check;

alter table public.erp_settlement_match_groups
  add constraint erp_settlement_match_groups_status_check
  check (status in ('open','cleared','void'));

alter table public.erp_settlement_match_links
  drop constraint if exists erp_settlement_match_links_role_check;

alter table public.erp_settlement_match_links
  add constraint erp_settlement_match_links_role_check
  check (role in ('AMAZON','INDIFI_IN','INDIFI_OUT_BANK','INDIFI_OUT_INDIFI','BANK_CREDIT','OTHER'));

-- ------------------------------------------------------------
-- 2) Soft-remove + audit columns on links
-- ------------------------------------------------------------

alter table public.erp_settlement_match_links
  add column if not exists is_active boolean not null default true;

alter table public.erp_settlement_match_links
  add column if not exists removed_at timestamptz null;

alter table public.erp_settlement_match_links
  add column if not exists removed_by uuid null;

alter table public.erp_settlement_match_links
  add column if not exists updated_at timestamptz not null default now();

alter table public.erp_settlement_match_links
  add column if not exists updated_by uuid not null default (created_by);

-- ------------------------------------------------------------
-- 3) Replace unique index to allow history
-- ------------------------------------------------------------

drop index if exists public.erp_settlement_match_links_company_event_unique;

create unique index if not exists erp_settlement_match_links_company_event_active_unique
  on public.erp_settlement_match_links (company_id, settlement_event_id)
  where is_active = true;

-- Helpful index for active lookups
create index if not exists erp_settlement_match_links_company_active_idx
  on public.erp_settlement_match_links (company_id, is_active);

-- ------------------------------------------------------------
-- 4) Fix RLS policies so service_role doesn't call erp_current_company_id()
-- ------------------------------------------------------------

do $$
begin
  drop policy if exists erp_settlement_match_groups_select on public.erp_settlement_match_groups;
  drop policy if exists erp_settlement_match_links_select on public.erp_settlement_match_links;

  create policy erp_settlement_match_groups_select
    on public.erp_settlement_match_groups
    for select
    using (
      (auth.role() = 'service_role')
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_settlement_match_links_select
    on public.erp_settlement_match_links
    for select
    using (
      (auth.role() = 'service_role')
      or (
        company_id = public.erp_current_company_id()
        and exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end;
$$;

-- ------------------------------------------------------------
-- 5) Replace RPCs: add/remove links (soft remove) + role validation
-- ------------------------------------------------------------

create or replace function public.erp_settlement_match_link_add(
  p_group_id uuid,
  p_event_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_event_company uuid;
  v_role text := upper(trim(coalesce(p_role,'')));
begin
  perform public.erp_require_finance_writer();

  if v_role not in ('AMAZON','INDIFI_IN','INDIFI_OUT_BANK','INDIFI_OUT_INDIFI','BANK_CREDIT','OTHER') then
    raise exception 'Invalid role';
  end if;

  select company_id
    into v_event_company
  from public.erp_settlement_events
  where id = p_event_id
    and is_void = false;

  if v_event_company is null then
    raise exception 'Settlement event not found';
  end if;

  if v_event_company <> v_company_id then
    raise exception 'Event belongs to another company';
  end if;

  if not exists (
    select 1
    from public.erp_settlement_match_groups
    where id = p_group_id
      and company_id = v_company_id
  ) then
    raise exception 'Match group not found';
  end if;

  -- If already linked (active), raise a clean error (or optionally auto-move).
  if exists (
    select 1
    from public.erp_settlement_match_links l
    where l.company_id = v_company_id
      and l.settlement_event_id = p_event_id
      and l.is_active = true
  ) then
    raise exception 'Event is already linked to a match group';
  end if;

  insert into public.erp_settlement_match_links (
    company_id,
    group_id,
    settlement_event_id,
    role,
    is_active,
    created_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    p_group_id,
    p_event_id,
    v_role,
    true,
    auth.uid(),
    now(),
    auth.uid()
  );

  update public.erp_settlement_match_groups
     set updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_link_add(uuid, uuid, text) from public;
grant execute on function public.erp_settlement_match_link_add(uuid, uuid, text) to authenticated;

create or replace function public.erp_settlement_match_link_remove(
  p_group_id uuid,
  p_event_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_updated integer := 0;
begin
  perform public.erp_require_finance_writer();

  update public.erp_settlement_match_links
     set is_active = false,
         removed_at = now(),
         removed_by = auth.uid(),
         updated_at = now(),
         updated_by = auth.uid()
   where company_id = v_company_id
     and group_id = p_group_id
     and settlement_event_id = p_event_id
     and is_active = true;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Active link not found';
  end if;

  update public.erp_settlement_match_groups
     set status = 'open',
         cleared_at = null,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_group_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_settlement_match_link_remove(uuid, uuid) from public;
grant execute on function public.erp_settlement_match_link_remove(uuid, uuid) to authenticated;
