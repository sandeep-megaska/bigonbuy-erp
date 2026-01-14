-- 0074_payroll_finalize_and_lock.sql
-- Payroll Phase-2: finalize workflow + DB locks (no edits after finalize)

begin;

-- 1) Ensure status is always one of allowed values
-- If you already have arbitrary values, normalize them safely.
update public.erp_payroll_runs
set status = 'draft'
where status is null or length(trim(status)) = 0;

update public.erp_payroll_runs
set status = lower(status);

-- Map legacy/unknown values (safe fallbacks)
update public.erp_payroll_runs
set status = 'generated'
where status in ('created','gen','generated_items','ready');

update public.erp_payroll_runs
set status = 'finalized'
where status in ('final','closed','lock','locked');

-- Anything else -> draft (conservative)
update public.erp_payroll_runs
set status = 'draft'
where status not in ('draft','generated','finalized');

-- Add default + constraint
alter table public.erp_payroll_runs
  alter column status set default 'draft';

alter table public.erp_payroll_runs
  add constraint erp_payroll_runs_status_check
  check (status in ('draft','generated','finalized'));

-- 2) Helper function: is payroll run finalized?
create or replace function public.erp_payroll_run_is_finalized(p_payroll_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_payroll_runs r
    where r.id = p_payroll_run_id
      and r.company_id = public.erp_current_company_id()
      and r.status = 'finalized'
  );
$$;

-- 3) Finalize RPC: locks the run (and sets audit fields)
drop function if exists public.erp_payroll_run_finalize(uuid);

create or replace function public.erp_payroll_run_finalize(p_payroll_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin','hr','payroll')
  ) then
    raise exception 'Not authorized';
  end if;

  -- Must exist & be same company
  if not exists (
    select 1
    from public.erp_payroll_runs r
    where r.id = p_payroll_run_id
      and r.company_id = v_company_id
  ) then
    raise exception 'Payroll run not found';
  end if;

  -- Lock it
  update public.erp_payroll_runs r
  set status = 'finalized',
      finalized_at = now(),
      finalized_by = v_actor
  where r.id = p_payroll_run_id
    and r.company_id = v_company_id;

end;
$$;

-- 4) Optional: Unfinalize RPC (owner/admin only)
drop function if exists public.erp_payroll_run_unfinalize(uuid);

create or replace function public.erp_payroll_run_unfinalize(p_payroll_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner','admin')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_payroll_runs r
    where r.id = p_payroll_run_id
      and r.company_id = v_company_id
  ) then
    raise exception 'Payroll run not found';
  end if;

  update public.erp_payroll_runs r
  set status = 'generated',
      finalized_at = null,
      finalized_by = null
  where r.id = p_payroll_run_id
    and r.company_id = v_company_id
    and r.status = 'finalized';

end;
$$;

-- 5) HARD LOCKS: Prevent edits to lines/items if parent run is finalized
-- We do this via trigger on payroll_item_lines and payroll_items.

create or replace function public.erp_payroll_assert_run_not_finalized_by_item(p_payroll_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_run_id uuid;
  v_status text;
begin
  select pi.payroll_run_id
    into v_run_id
  from public.erp_payroll_items pi
  where pi.company_id = v_company_id
    and pi.id = p_payroll_item_id;

  if v_run_id is null then
    -- if item missing, let the caller fail later with FK/exists checks
    return;
  end if;

  select r.status
    into v_status
  from public.erp_payroll_runs r
  where r.company_id = v_company_id
    and r.id = v_run_id;

  if v_status = 'finalized' then
    raise exception 'Payroll run is finalized; edits are locked';
  end if;
end;
$$;

-- Trigger for payroll_item_lines
drop trigger if exists trg_payroll_item_lines_block_finalized on public.erp_payroll_item_lines;

create or replace function public.erp_payroll_item_lines_block_finalized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_payroll_assert_run_not_finalized_by_item(
    coalesce(new.payroll_item_id, old.payroll_item_id)
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_payroll_item_lines_block_finalized
before insert or update or delete on public.erp_payroll_item_lines
for each row execute function public.erp_payroll_item_lines_block_finalized();

-- Trigger for payroll_items (prevents manual edits after finalize)
drop trigger if exists trg_payroll_items_block_finalized on public.erp_payroll_items;

create or replace function public.erp_payroll_items_block_finalized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_payroll_assert_run_not_finalized_by_item(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create trigger trg_payroll_items_block_finalized
before update or delete on public.erp_payroll_items
for each row execute function public.erp_payroll_items_block_finalized();

commit;
