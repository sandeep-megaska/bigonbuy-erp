begin;

create or replace function public.erp_hr_final_settlements_list(
  p_from date,
  p_to date,
  p_status text default null,
  p_query text default null
) returns table(
  settlement_id uuid,
  exit_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  last_working_day date,
  status text,
  updated_at timestamptz,
  earnings_total numeric,
  deductions_total numeric,
  net_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_query text := nullif(trim(coalesce(p_query, '')), '');
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  return query
  select
    fs.id as settlement_id,
    fs.exit_id as exit_id,
    e.id as employee_id,
    e.employee_code as employee_code,
    e.full_name as employee_name,
    ex.last_working_day as last_working_day,
    fs.status as status,
    fs.updated_at as updated_at,
    coalesce(sum(case when i.kind = 'earning' then i.amount else 0 end), 0)::numeric as earnings_total,
    coalesce(sum(case when i.kind = 'deduction' then i.amount else 0 end), 0)::numeric as deductions_total,
    (
      coalesce(sum(case when i.kind = 'earning' then i.amount else 0 end), 0)
      - coalesce(sum(case when i.kind = 'deduction' then i.amount else 0 end), 0)
    )::numeric as net_amount
  from public.erp_hr_final_settlements fs
  join public.erp_hr_employee_exits ex
    on ex.id = fs.exit_id
    and ex.company_id = v_company_id
  join public.erp_employees e
    on e.id = ex.employee_id
    and e.company_id = v_company_id
  left join public.erp_hr_final_settlement_items i
    on i.settlement_id = fs.id
    and i.company_id = v_company_id
  where fs.company_id = v_company_id
    and (p_from is null or coalesce(ex.last_working_day, fs.created_at::date) >= p_from)
    and (p_to is null or coalesce(ex.last_working_day, fs.created_at::date) <= p_to)
    and (
      p_status is null
      or p_status = ''
      or (p_status = 'draft' and fs.status = 'draft')
      or (p_status = 'finalized' and fs.status <> 'draft')
      or (p_status not in ('draft', 'finalized') and fs.status = p_status)
    )
    and (
      v_query is null
      or lower(e.full_name) like '%' || lower(v_query) || '%'
      or lower(e.employee_code) like '%' || lower(v_query) || '%'
    )
  group by fs.id, fs.exit_id, e.id, e.employee_code, e.full_name, ex.last_working_day, fs.status, fs.updated_at
  order by fs.updated_at desc;
end;
$$;

revoke all on function public.erp_hr_final_settlements_list(date, date, text, text) from public;
grant execute on function public.erp_hr_final_settlements_list(date, date, text, text) to authenticated;
drop function if exists public.erp_hr_final_settlement_line_upsert cascade;
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
    raise exception 'Final settlement is locked once submitted';
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
    raise exception 'Final settlement is locked once submitted';
  end if;

  delete from public.erp_hr_final_settlement_items
  where id = p_line_id
    and settlement_id = p_settlement_id
    and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_line_delete(uuid, uuid) from public;
grant execute on function public.erp_hr_final_settlement_line_delete(uuid, uuid) to authenticated;

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
     set status = 'submitted',
         submitted_at = now(),
         submitted_by_user_id = v_actor,
         updated_at = now()
   where id = v_settlement.id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_finalize(uuid) from public;
grant execute on function public.erp_hr_final_settlement_finalize(uuid) to authenticated;

create or replace function public.erp_hr_final_settlement_by_exit_get(
  p_exit_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_settlement_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_hr_reader();
  end if;

  if p_exit_id is null then
    raise exception 'exit_id is required';
  end if;

  select fs.id
    into v_settlement_id
  from public.erp_hr_final_settlements fs
  where fs.exit_id = p_exit_id
    and fs.company_id = v_company_id;

  return v_settlement_id;
end;
$$;

revoke all on function public.erp_hr_final_settlement_by_exit_get(uuid) from public;
grant execute on function public.erp_hr_final_settlement_by_exit_get(uuid) to authenticated;

commit;
