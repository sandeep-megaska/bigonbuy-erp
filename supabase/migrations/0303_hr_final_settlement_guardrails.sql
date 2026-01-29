begin;

do $$
declare
  v_duplicate_count int;
  v_constraint_exists boolean;
begin
  select count(*) into v_duplicate_count
  from (
    select company_id, exit_id
    from public.erp_hr_final_settlements
    group by company_id, exit_id
    having count(*) > 1
  ) duplicates;

  select exists (
    select 1
    from pg_constraint
    where conname = 'erp_hr_final_settlements_company_exit_unique'
  ) into v_constraint_exists;

  if v_duplicate_count = 0 and not v_constraint_exists then
    alter table public.erp_hr_final_settlements
      add constraint erp_hr_final_settlements_company_exit_unique unique (company_id, exit_id);
  elsif v_duplicate_count > 0 then
    raise notice 'Skipping unique constraint erp_hr_final_settlements_company_exit_unique; duplicates exist.';
  end if;
end $$;

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
  v_item_count int := 0;
  v_earnings_total numeric;
  v_deductions_total numeric;
  v_net_amount numeric;
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

  select
    count(i.id),
    coalesce(sum(case when i.kind in ('earning', 'earnings', 'credit') then i.amount else 0 end), 0)::numeric,
    coalesce(sum(case when i.kind in ('deduction', 'deductions', 'debit') then i.amount else 0 end), 0)::numeric
  into v_item_count, v_earnings_total, v_deductions_total
  from public.erp_hr_final_settlement_items i
  where i.company_id = v_company_id
    and i.settlement_id = v_settlement.id;

  if v_item_count = 0 then
    v_earnings_total := null;
    v_deductions_total := null;
    v_net_amount := null;
  else
    v_net_amount := v_earnings_total - v_deductions_total;
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
    'exit', v_exit,
    'earnings_total', v_earnings_total,
    'deductions_total', v_deductions_total,
    'net_amount', v_net_amount
  );
end;
$$;

revoke all on function public.erp_hr_final_settlement_get from public;
grant execute on function public.erp_hr_final_settlement_get to authenticated;

create or replace function public.erp_hr_final_settlement_upsert_header(
  p_exit_id uuid,
  p_settlement_id uuid default null,
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
      raise exception 'Final settlement is locked';
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

create or replace function public.erp_hr_final_settlement_line_upsert(
  p_settlement_id uuid,
  p_line_type text,
  p_title text,
  p_amount numeric,
  p_line_id uuid default null,
  p_remarks text default null,
  p_sort int default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_status text;
  v_line_id uuid;
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

  if p_line_type not in ('earning', 'deduction') then
    raise exception 'line_type must be earning or deduction';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be non-negative';
  end if;

  select fs.status
    into v_status
  from public.erp_hr_final_settlements fs
  where fs.id = p_settlement_id
    and fs.company_id = v_company_id;

  if v_status is null then
    raise exception 'Final settlement not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Final settlement is locked';
  end if;

  if p_line_id is null then
    insert into public.erp_hr_final_settlement_items (
      company_id,
      settlement_id,
      kind,
      name,
      amount,
      notes,
      sort_order
    ) values (
      v_company_id,
      p_settlement_id,
      p_line_type,
      p_title,
      p_amount,
      p_remarks,
      coalesce(p_sort, 0)
    )
    returning id into v_line_id;

    return v_line_id;
  end if;

  update public.erp_hr_final_settlement_items
     set kind = p_line_type,
         name = p_title,
         amount = p_amount,
         notes = p_remarks,
         sort_order = coalesce(p_sort, 0),
         updated_at = now()
   where id = p_line_id
     and settlement_id = p_settlement_id
     and company_id = v_company_id
  returning id into v_line_id;

  if v_line_id is null then
    raise exception 'Final settlement line not found';
  end if;

  return v_line_id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_line_upsert from public;
grant execute on function public.erp_hr_final_settlement_line_upsert to authenticated;

create or replace function public.erp_hr_final_settlement_line_delete(
  p_settlement_id uuid,
  p_line_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_status text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_writer();
  end if;

  if p_settlement_id is null or p_line_id is null then
    raise exception 'settlement_id and line_id are required';
  end if;

  select fs.status
    into v_status
  from public.erp_hr_final_settlements fs
  where fs.id = p_settlement_id
    and fs.company_id = v_company_id;

  if v_status is null then
    raise exception 'Final settlement not found';
  end if;

  if v_status <> 'draft' then
    raise exception 'Final settlement is locked';
  end if;

  delete from public.erp_hr_final_settlement_items
  where id = p_line_id
    and settlement_id = p_settlement_id
    and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_line_delete from public;
grant execute on function public.erp_hr_final_settlement_line_delete to authenticated;

commit;
