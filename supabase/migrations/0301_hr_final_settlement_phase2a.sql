begin;

alter table public.erp_hr_final_settlements
  add column if not exists finalized_at timestamptz null,
  add column if not exists finalized_by_user_id uuid null;

alter table public.erp_hr_final_settlements
  drop constraint if exists erp_hr_final_settlements_status_check;

alter table public.erp_hr_final_settlements
  add constraint erp_hr_final_settlements_status_check
  check (status in ('draft', 'submitted', 'approved', 'paid', 'finalized'));

create or replace function public.erp_hr_final_settlement_get(
  p_settlement_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_settlement public.erp_hr_final_settlements;
  v_employee jsonb;
  v_exit jsonb;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  if p_settlement_id is null then
    raise exception 'settlement_id is required';
  end if;

  select *
    into v_settlement
  from public.erp_hr_final_settlements fs
  where fs.id = p_settlement_id
    and fs.company_id = v_company_id;

  if v_settlement.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', e.id,
    'employee_code', e.employee_code,
    'full_name', e.full_name
  )
  into v_employee
  from public.erp_hr_employee_exits ex
  join public.erp_employees e
    on e.id = ex.employee_id
    and e.company_id = v_company_id
  where ex.id = v_settlement.exit_id
    and ex.company_id = v_company_id;

  select jsonb_build_object(
    'id', ex.id,
    'employee_id', ex.employee_id,
    'status', ex.status,
    'last_working_day', ex.last_working_day
  )
  into v_exit
  from public.erp_hr_employee_exits ex
  where ex.id = v_settlement.exit_id
    and ex.company_id = v_company_id;

  return jsonb_build_object(
    'settlement', to_jsonb(v_settlement),
    'lines', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
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
      '[]'::jsonb
    ),
    'clearances', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
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
      '[]'::jsonb
    ),
    'employee', v_employee,
    'exit', v_exit
  );
end;
$$;

revoke all on function public.erp_hr_final_settlement_get from public;
grant execute on function public.erp_hr_final_settlement_get to authenticated;

create or replace function public.erp_hr_final_settlement_upsert_header(
  p_settlement_id uuid default null,
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
  v_existing public.erp_hr_final_settlements;
  v_exit_status text;
  v_settlement_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
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
    into v_existing
  from public.erp_hr_final_settlements fs
  where fs.exit_id = p_exit_id
    and fs.company_id = v_company_id;

  if v_existing.id is not null then
    if p_settlement_id is not null and p_settlement_id <> v_existing.id then
      raise exception 'Final settlement already exists for this exit';
    end if;

    if v_existing.status <> 'draft' then
      raise exception 'Final settlement is locked once submitted';
    end if;

    update public.erp_hr_final_settlements
       set notes = p_notes,
           updated_at = now()
     where id = v_existing.id;

    return v_existing.id;
  end if;

  v_settlement_id := coalesce(p_settlement_id, gen_random_uuid());

  insert into public.erp_hr_final_settlements (
    id,
    company_id,
    exit_id,
    status,
    notes
  ) values (
    v_settlement_id,
    v_company_id,
    p_exit_id,
    'draft',
    p_notes
  );

  return v_settlement_id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_upsert_header from public;
grant execute on function public.erp_hr_final_settlement_upsert_header to authenticated;

create or replace function public.erp_hr_final_settlement_finalize(
  p_settlement_id uuid
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

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_settlement_id is null then
    raise exception 'settlement_id is required';
  end if;

  select *
    into v_settlement
  from public.erp_hr_final_settlements fs
  where fs.id = p_settlement_id
    and fs.company_id = v_company_id;

  if v_settlement.id is null then
    raise exception 'Final settlement not found';
  end if;

  if v_settlement.status <> 'draft' then
    raise exception 'Final settlement is locked once submitted';
  end if;

  select status
    into v_exit_status
  from public.erp_hr_employee_exits e
  where e.id = v_settlement.exit_id
    and e.company_id = v_company_id;

  if v_exit_status not in ('approved', 'completed') then
    raise exception 'Final settlement is available once the exit is approved';
  end if;

  update public.erp_hr_final_settlements
     set status = 'finalized',
         finalized_at = now(),
         finalized_by_user_id = v_actor,
         updated_at = now()
   where id = v_settlement.id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_finalize from public;
grant execute on function public.erp_hr_final_settlement_finalize to authenticated;

commit;
