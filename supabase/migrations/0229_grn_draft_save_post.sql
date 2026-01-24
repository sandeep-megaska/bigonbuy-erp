create or replace function public.erp_grn_draft_save(
  p_grn_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_grn record;
  v_grn_no text;
  v_exists boolean;
  v_received_at timestamptz;
  v_notes text;
  v_lines jsonb;
  v_line jsonb;
  v_line_id uuid;
  v_purchase_order_line_id uuid;
  v_variant_id uuid;
  v_warehouse_id uuid;
  v_received_qty numeric;
  v_unit_cost numeric;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be an object';
  end if;

  select * into v_grn
    from public.erp_grns
   where id = p_grn_id
     and company_id = v_company_id
   for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be updated';
  end if;

  v_received_at := nullif(trim(p_payload->>'received_at'), '')::timestamptz;
  v_notes := nullif(trim(p_payload->>'notes'), '');

  update public.erp_grns
     set received_at = coalesce(v_received_at, received_at),
         notes = v_notes,
         updated_at = now(),
         updated_by = v_actor
   where id = p_grn_id
     and company_id = v_company_id;

  if v_grn.grn_no is null then
    v_grn_no := public.erp_doc_allocate_number(p_grn_id, 'GRN');

    if not public.erp_doc_no_is_valid(v_grn_no, 'GRN') then
      raise exception 'Invalid GRN number format. Expected FYxx-xx/GRN/000001';
    end if;

    select exists(
      select 1
      from public.erp_grns g
      where g.company_id = v_company_id
        and g.grn_no = v_grn_no
        and g.id <> p_grn_id
    ) into v_exists;

    if v_exists then
      raise exception 'GRN number already in use';
    end if;

    update public.erp_grns
       set grn_no = v_grn_no,
           updated_at = now(),
           updated_by = v_actor
     where id = p_grn_id
       and company_id = v_company_id;
  end if;

  v_lines := p_payload->'lines';

  if v_lines is null or jsonb_typeof(v_lines) <> 'array' then
    raise exception 'lines must be an array';
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_line_id := nullif(trim(v_line->>'id'), '')::uuid;
    v_purchase_order_line_id := nullif(trim(v_line->>'purchase_order_line_id'), '')::uuid;
    v_variant_id := nullif(trim(v_line->>'variant_id'), '')::uuid;
    v_warehouse_id := nullif(trim(v_line->>'warehouse_id'), '')::uuid;
    v_received_qty := nullif(trim(v_line->>'received_qty'), '')::numeric;
    v_unit_cost := nullif(trim(v_line->>'unit_cost'), '')::numeric;

    if v_received_qty is null or v_received_qty <= 0 then
      raise exception 'received_qty must be greater than 0';
    end if;

    if v_received_qty <> trunc(v_received_qty) then
      raise exception 'received_qty must be a whole number';
    end if;

    if v_warehouse_id is null then
      raise exception 'warehouse_id is required';
    end if;

    if v_line_id is not null then
      update public.erp_grn_lines
         set warehouse_id = v_warehouse_id,
             received_qty = v_received_qty::int,
             unit_cost = v_unit_cost,
             updated_at = now(),
             updated_by = v_actor
       where id = v_line_id
         and grn_id = p_grn_id
         and company_id = v_company_id;

      if not found then
        raise exception 'GRN line not found';
      end if;
    else
      if v_purchase_order_line_id is null or v_variant_id is null then
        raise exception 'purchase_order_line_id and variant_id are required for new lines';
      end if;

      insert into public.erp_grn_lines (
        company_id,
        grn_id,
        purchase_order_line_id,
        variant_id,
        warehouse_id,
        received_qty,
        unit_cost,
        created_by,
        updated_by
      ) values (
        v_company_id,
        p_grn_id,
        v_purchase_order_line_id,
        v_variant_id,
        v_warehouse_id,
        v_received_qty::int,
        v_unit_cost,
        v_actor,
        v_actor
      );
    end if;
  end loop;

  return jsonb_build_object('id', p_grn_id, 'grn_no', coalesce(v_grn.grn_no, v_grn_no));
end;
$$;

revoke all on function public.erp_grn_draft_save(uuid, jsonb) from public;
grant execute on function public.erp_grn_draft_save(uuid, jsonb) to authenticated;

create or replace function public.erp_grn_post(p_grn_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_inventory_writer();
  perform public.erp_post_grn(p_grn_id);
  return true;
end;
$$;

revoke all on function public.erp_grn_post(uuid) from public;
grant execute on function public.erp_grn_post(uuid) to authenticated;
