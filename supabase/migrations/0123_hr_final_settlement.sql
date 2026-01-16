begin;

create table if not exists public.erp_hr_final_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  exit_id uuid not null references public.erp_hr_employee_exits(id) on delete cascade unique,
  status text not null default 'draft',
  notes text null,
  submitted_at timestamptz null,
  submitted_by_user_id uuid null,
  approved_at timestamptz null,
  approved_by_user_id uuid null,
  paid_at timestamptz null,
  paid_by_user_id uuid null,
  payment_mode text null,
  payment_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_hr_final_settlements_status_check
    check (status in ('draft', 'submitted', 'approved', 'paid'))
);

create table if not exists public.erp_hr_final_settlement_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  settlement_id uuid not null references public.erp_hr_final_settlements(id) on delete cascade,
  kind text not null check (kind in ('earning', 'deduction')),
  code text null,
  name text not null,
  amount numeric(12,2) not null default 0,
  notes text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_hr_final_settlement_clearances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies(id) on delete cascade,
  settlement_id uuid not null references public.erp_hr_final_settlements(id) on delete cascade,
  department text not null,
  item text not null,
  is_done boolean not null default false,
  done_at timestamptz null,
  done_by_user_id uuid null,
  notes text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists erp_hr_final_settlements_set_updated_at
  on public.erp_hr_final_settlements;
create trigger erp_hr_final_settlements_set_updated_at
before update on public.erp_hr_final_settlements
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_final_settlement_items_set_updated_at
  on public.erp_hr_final_settlement_items;
create trigger erp_hr_final_settlement_items_set_updated_at
before update on public.erp_hr_final_settlement_items
for each row
execute function public.erp_set_updated_at();

drop trigger if exists erp_hr_final_settlement_clearances_set_updated_at
  on public.erp_hr_final_settlement_clearances;
create trigger erp_hr_final_settlement_clearances_set_updated_at
before update on public.erp_hr_final_settlement_clearances
for each row
execute function public.erp_set_updated_at();

alter table public.erp_hr_final_settlements enable row level security;
alter table public.erp_hr_final_settlements force row level security;

alter table public.erp_hr_final_settlement_items enable row level security;
alter table public.erp_hr_final_settlement_items force row level security;

alter table public.erp_hr_final_settlement_clearances enable row level security;
alter table public.erp_hr_final_settlement_clearances force row level security;

do $$
begin
  drop policy if exists erp_hr_final_settlements_select on public.erp_hr_final_settlements;
  drop policy if exists erp_hr_final_settlements_write on public.erp_hr_final_settlements;
  drop policy if exists erp_hr_final_settlement_items_select on public.erp_hr_final_settlement_items;
  drop policy if exists erp_hr_final_settlement_items_write on public.erp_hr_final_settlement_items;
  drop policy if exists erp_hr_final_settlement_clearances_select on public.erp_hr_final_settlement_clearances;
  drop policy if exists erp_hr_final_settlement_clearances_write on public.erp_hr_final_settlement_clearances;

  create policy erp_hr_final_settlements_select
    on public.erp_hr_final_settlements
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
        or public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_hr_final_settlements_write
    on public.erp_hr_final_settlements
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_hr_final_settlement_items_select
    on public.erp_hr_final_settlement_items
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
        or public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_hr_final_settlement_items_write
    on public.erp_hr_final_settlement_items
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_hr_final_settlement_clearances_select
    on public.erp_hr_final_settlement_clearances
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_require_hr_reader() is null
        or public.erp_is_hr_admin(auth.uid())
      )
    );

  create policy erp_hr_final_settlement_clearances_write
    on public.erp_hr_final_settlement_clearances
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
      )
    );
end $$;

create or replace function public.erp_hr_final_settlement_get(p_exit_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_settlement public.erp_hr_final_settlements;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_exit_id is null then
    raise exception 'exit_id is required';
  end if;

  select *
    into v_settlement
  from public.erp_hr_final_settlements fs
  where fs.exit_id = p_exit_id
    and fs.company_id = v_company_id;

  return json_build_object(
    'settlement', to_jsonb(v_settlement),
    'items', coalesce(
      (
        select json_agg(
          json_build_object(
            'id', i.id,
            'kind', i.kind,
            'code', i.code,
            'name', i.name,
            'amount', i.amount,
            'notes', i.notes,
            'sort_order', i.sort_order
          )
          order by i.sort_order, i.created_at
        )
        from public.erp_hr_final_settlement_items i
        where i.company_id = v_company_id
          and i.settlement_id = v_settlement.id
      ),
      '[]'::json
    ),
    'clearances', coalesce(
      (
        select json_agg(
          json_build_object(
            'id', c.id,
            'department', c.department,
            'item', c.item,
            'is_done', c.is_done,
            'done_at', c.done_at,
            'done_by_user_id', c.done_by_user_id,
            'notes', c.notes,
            'sort_order', c.sort_order
          )
          order by c.sort_order, c.created_at
        )
        from public.erp_hr_final_settlement_clearances c
        where c.company_id = v_company_id
          and c.settlement_id = v_settlement.id
      ),
      '[]'::json
    )
  );
end;
$$;

revoke all on function public.erp_hr_final_settlement_get(uuid) from public;
grant execute on function public.erp_hr_final_settlement_get(uuid) to authenticated;

create or replace function public.erp_hr_final_settlement_upsert(
  p_exit_id uuid,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_settlement public.erp_hr_final_settlements;
  v_exit_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_exit_id is null then
    raise exception 'exit_id is required';
  end if;

  select status
    into v_exit_status
  from public.erp_hr_employee_exits e
  where e.id = p_exit_id
    and e.company_id = v_company_id;

  if v_exit_status is null then
    raise exception 'Exit request not found';
  end if;

  if v_exit_status not in ('approved', 'completed') then
    raise exception 'Final settlement is available once the exit is approved';
  end if;

  select *
    into v_settlement
  from public.erp_hr_final_settlements fs
  where fs.exit_id = p_exit_id
    and fs.company_id = v_company_id;

  if v_settlement.id is not null then
    if v_settlement.status <> 'draft' then
      raise exception 'Final settlement is locked once submitted';
    end if;

    update public.erp_hr_final_settlements
       set notes = p_notes,
           updated_at = now()
     where id = v_settlement.id;

    return v_settlement.id;
  end if;

  insert into public.erp_hr_final_settlements (
    company_id,
    exit_id,
    status,
    notes
  ) values (
    v_company_id,
    p_exit_id,
    'draft',
    p_notes
  )
  returning id into v_settlement.id;

  return v_settlement.id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_upsert(uuid, text) from public;
grant execute on function public.erp_hr_final_settlement_upsert(uuid, text) to authenticated;

create or replace function public.erp_hr_final_settlement_set_status(
  p_settlement_id uuid,
  p_status text,
  p_payment_mode text default null,
  p_payment_reference text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_settlement public.erp_hr_final_settlements;
  v_exit_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not public.erp_is_hr_admin(v_actor) then
    raise exception 'Not authorized: owner/admin/hr only';
  end if;

  if p_settlement_id is null then
    raise exception 'settlement_id is required';
  end if;

  if p_status not in ('submitted', 'approved', 'paid') then
    raise exception 'Invalid status';
  end if;

  select *
    into v_settlement
  from public.erp_hr_final_settlements fs
  where fs.id = p_settlement_id
    and fs.company_id = v_company_id;

  if v_settlement.id is null then
    raise exception 'Final settlement not found';
  end if;

  select status
    into v_exit_status
  from public.erp_hr_employee_exits e
  where e.id = v_settlement.exit_id
    and e.company_id = v_company_id;

  if v_exit_status not in ('approved', 'completed') then
    raise exception 'Final settlement is available once the exit is approved';
  end if;

  if v_settlement.status = 'draft' and p_status = 'submitted' then
    update public.erp_hr_final_settlements
       set status = 'submitted',
           submitted_at = now(),
           submitted_by_user_id = v_actor,
           updated_at = now()
     where id = v_settlement.id;
    return;
  end if;

  if v_settlement.status = 'submitted' and p_status = 'approved' then
    update public.erp_hr_final_settlements
       set status = 'approved',
           approved_at = now(),
           approved_by_user_id = v_actor,
           updated_at = now()
     where id = v_settlement.id;
    return;
  end if;

  if v_settlement.status = 'approved' and p_status = 'paid' then
    update public.erp_hr_final_settlements
       set status = 'paid',
           paid_at = now(),
           paid_by_user_id = v_actor,
           payment_mode = p_payment_mode,
           payment_reference = p_payment_reference,
           updated_at = now()
     where id = v_settlement.id;
    return;
  end if;

  raise exception 'Invalid status transition';
end;
$$;

revoke all on function public.erp_hr_final_settlement_set_status(uuid, text, text, text) from public;
grant execute on function public.erp_hr_final_settlement_set_status(uuid, text, text, text) to authenticated;

commit;
