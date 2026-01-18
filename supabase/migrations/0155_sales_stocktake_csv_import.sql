create or replace function public.erp_sales_consumption_import_csv(
  p_rows jsonb,
  p_validate_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_results jsonb := '[]'::jsonb;
  v_posted_count integer := 0;
  v_error_count integer := 0;
  v_group_count integer := 0;
  v_created_doc_ids uuid[] := array[]::uuid[];
  v_entry record;
  v_row jsonb;
  v_index integer;
  v_date date;
  v_warehouse_code text;
  v_channel_code text;
  v_sku text;
  v_qty integer;
  v_reference text;
  v_notes text;
  v_warehouse_id uuid;
  v_channel_id uuid;
  v_variant_id uuid;
  v_message text;
  v_ok boolean;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array';
  end if;

  create temporary table temp_sales_import_rows (
    row_index integer,
    row_date date,
    warehouse_id uuid,
    channel_id uuid,
    variant_id uuid,
    qty integer,
    reference text,
    notes text,
    ok boolean,
    message text
  ) on commit drop;

  create temporary table temp_sales_docs (
    consumption_id uuid,
    row_date date,
    warehouse_id uuid,
    channel_id uuid
  ) on commit drop;

  for v_entry in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    v_row := v_entry.value;
    v_index := v_entry.ordinality;
    v_ok := true;
    v_message := null;
    v_warehouse_id := null;
    v_channel_id := null;
    v_variant_id := null;

    v_warehouse_code := nullif(trim(v_row->>'warehouse_code'), '');
    v_channel_code := nullif(trim(v_row->>'channel_code'), '');
    v_sku := nullif(trim(v_row->>'sku'), '');
    v_reference := nullif(trim(v_row->>'reference'), '');
    v_notes := nullif(trim(v_row->>'notes'), '');

    begin
      v_qty := (v_row->>'qty')::integer;
    exception
      when others then
        v_qty := null;
    end;

    begin
      v_date := coalesce(nullif(trim(v_row->>'date'), '')::date, current_date);
    exception
      when others then
        v_date := null;
    end;

    if v_warehouse_code is null or v_channel_code is null or v_sku is null or v_qty is null then
      v_ok := false;
      v_message := 'Missing required fields';
    elsif v_qty <= 0 then
      v_ok := false;
      v_message := 'qty must be greater than 0';
    elsif v_date is null then
      v_ok := false;
      v_message := 'Invalid date';
    else
      select w.id
        into v_warehouse_id
        from public.erp_warehouses w
       where w.company_id = v_company_id
         and lower(w.code) = lower(v_warehouse_code)
       limit 1;

      if v_warehouse_id is null then
        v_ok := false;
        v_message := 'Unknown warehouse';
      end if;

      select sc.id
        into v_channel_id
        from public.erp_sales_channels sc
       where sc.company_id = v_company_id
         and lower(sc.code) = lower(v_channel_code)
       limit 1;

      if v_channel_id is null then
        v_ok := false;
        v_message := coalesce(v_message || '; ', '') || 'Unknown channel';
      end if;

      select v.id
        into v_variant_id
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.sku = v_sku
       limit 1;

      if v_variant_id is null then
        v_ok := false;
        v_message := coalesce(v_message || '; ', '') || 'Unknown SKU';
      end if;
    end if;

    if not v_ok then
      v_error_count := v_error_count + 1;
    end if;

    insert into temp_sales_import_rows (
      row_index,
      row_date,
      warehouse_id,
      channel_id,
      variant_id,
      qty,
      reference,
      notes,
      ok,
      message
    ) values (
      v_index,
      v_date,
      v_warehouse_id,
      v_channel_id,
      v_variant_id,
      v_qty,
      v_reference,
      v_notes,
      v_ok,
      v_message
    );
  end loop;

  select count(*)
    into v_group_count
    from (
      select distinct row_date, warehouse_id, channel_id
        from temp_sales_import_rows
       where ok
    ) as groups;

  if not p_validate_only then
    with inserted as (
      insert into public.erp_sales_consumptions (
        company_id,
        status,
        consumption_date,
        channel_id,
        warehouse_id,
        reference,
        notes,
        created_at,
        created_by,
        updated_at
      )
      select
        v_company_id,
        'draft',
        row_date,
        channel_id,
        warehouse_id,
        nullif(max(reference), ''),
        nullif(max(notes), ''),
        now(),
        auth.uid(),
        now()
      from temp_sales_import_rows
      where ok
      group by row_date, warehouse_id, channel_id
      returning id, consumption_date, warehouse_id, channel_id
    )
    insert into temp_sales_docs
    select * from inserted;

    insert into public.erp_sales_consumption_lines (
      company_id,
      consumption_id,
      variant_id,
      qty,
      created_at
    )
    select
      v_company_id,
      d.consumption_id,
      r.variant_id,
      r.qty,
      now()
    from temp_sales_import_rows r
    join temp_sales_docs d
      on d.row_date = r.row_date
     and d.warehouse_id = r.warehouse_id
     and d.channel_id = r.channel_id
    where r.ok;

    for v_entry in select consumption_id from temp_sales_docs loop
      perform public.erp_sales_consumption_post(v_entry.consumption_id);
    end loop;

    select array_agg(consumption_id)
      into v_created_doc_ids
      from temp_sales_docs;

    select count(*)
      into v_posted_count
      from temp_sales_import_rows
     where ok;
  end if;

  update temp_sales_import_rows
     set message = case
       when ok then case when p_validate_only then 'Validated' else 'Posted' end
       else message
     end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'row_index', r.row_index,
        'ok', r.ok,
        'message', r.message,
        'warehouse_id', r.warehouse_id,
        'channel_id', r.channel_id,
        'variant_id', r.variant_id,
        'qty', r.qty,
        'date', r.row_date,
        'consumption_id', d.consumption_id
      )
      order by r.row_index
    ),
    '[]'::jsonb
  )
  into v_results
  from temp_sales_import_rows r
  left join temp_sales_docs d
    on d.row_date = r.row_date
   and d.warehouse_id = r.warehouse_id
   and d.channel_id = r.channel_id;

  return jsonb_build_object(
    'results', v_results,
    'posted_count', v_posted_count,
    'error_count', v_error_count,
    'created_doc_ids', coalesce(v_created_doc_ids, array[]::uuid[]),
    'group_count', v_group_count
  );
end;
$$;

revoke all on function public.erp_sales_consumption_import_csv(jsonb, boolean) from public;
grant execute on function public.erp_sales_consumption_import_csv(jsonb, boolean) to authenticated;

create or replace function public.erp_stocktake_import_csv(
  p_rows jsonb,
  p_validate_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_results jsonb := '[]'::jsonb;
  v_posted_count integer := 0;
  v_error_count integer := 0;
  v_group_count integer := 0;
  v_created_doc_ids uuid[] := array[]::uuid[];
  v_entry record;
  v_row jsonb;
  v_index integer;
  v_date date;
  v_warehouse_code text;
  v_sku text;
  v_counted_qty integer;
  v_reference text;
  v_notes text;
  v_warehouse_id uuid;
  v_variant_id uuid;
  v_message text;
  v_ok boolean;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array';
  end if;

  create temporary table temp_stocktake_import_rows (
    row_index integer,
    row_date date,
    warehouse_id uuid,
    variant_id uuid,
    counted_qty integer,
    reference text,
    notes text,
    ok boolean,
    message text,
    on_hand integer,
    delta integer,
    ledger_type text
  ) on commit drop;

  create temporary table temp_stocktake_docs (
    stocktake_id uuid,
    row_date date,
    warehouse_id uuid
  ) on commit drop;

  for v_entry in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    v_row := v_entry.value;
    v_index := v_entry.ordinality;
    v_ok := true;
    v_message := null;
    v_warehouse_id := null;
    v_variant_id := null;

    v_warehouse_code := nullif(trim(v_row->>'warehouse_code'), '');
    v_sku := nullif(trim(v_row->>'sku'), '');
    v_reference := nullif(trim(v_row->>'reference'), '');
    v_notes := nullif(trim(v_row->>'notes'), '');

    begin
      v_counted_qty := (v_row->>'counted_qty')::integer;
    exception
      when others then
        v_counted_qty := null;
    end;

    begin
      v_date := coalesce(nullif(trim(v_row->>'date'), '')::date, current_date);
    exception
      when others then
        v_date := null;
    end;

    if v_warehouse_code is null or v_sku is null or v_counted_qty is null then
      v_ok := false;
      v_message := 'Missing required fields';
    elsif v_counted_qty < 0 then
      v_ok := false;
      v_message := 'counted_qty must be 0 or greater';
    elsif v_date is null then
      v_ok := false;
      v_message := 'Invalid date';
    else
      select w.id
        into v_warehouse_id
        from public.erp_warehouses w
       where w.company_id = v_company_id
         and lower(w.code) = lower(v_warehouse_code)
       limit 1;

      if v_warehouse_id is null then
        v_ok := false;
        v_message := 'Unknown warehouse';
      end if;

      select v.id
        into v_variant_id
        from public.erp_variants v
       where v.company_id = v_company_id
         and v.sku = v_sku
       limit 1;

      if v_variant_id is null then
        v_ok := false;
        v_message := coalesce(v_message || '; ', '') || 'Unknown SKU';
      end if;
    end if;

    if not v_ok then
      v_error_count := v_error_count + 1;
    end if;

    insert into temp_stocktake_import_rows (
      row_index,
      row_date,
      warehouse_id,
      variant_id,
      counted_qty,
      reference,
      notes,
      ok,
      message
    ) values (
      v_index,
      v_date,
      v_warehouse_id,
      v_variant_id,
      v_counted_qty,
      v_reference,
      v_notes,
      v_ok,
      v_message
    );
  end loop;

  update temp_stocktake_import_rows r
     set on_hand = coalesce((
       select sum(l.qty)
         from public.erp_inventory_ledger l
        where l.company_id = v_company_id
          and l.warehouse_id = r.warehouse_id
          and l.variant_id = r.variant_id
     ), 0)
   where r.ok;

  update temp_stocktake_import_rows r
     set delta = r.counted_qty - coalesce(r.on_hand, 0),
         ledger_type = case
           when r.counted_qty - coalesce(r.on_hand, 0) > 0 then 'adjust_in'
           when r.counted_qty - coalesce(r.on_hand, 0) < 0 then 'adjust_out'
           else 'no_change'
         end
   where r.ok;

  select count(*)
    into v_group_count
    from (
      select distinct row_date, warehouse_id
        from temp_stocktake_import_rows
       where ok
    ) as groups;

  if not p_validate_only then
    with inserted as (
      insert into public.erp_stocktakes (
        company_id,
        status,
        warehouse_id,
        stocktake_date,
        reference,
        notes,
        created_at,
        created_by,
        updated_at
      )
      select
        v_company_id,
        'draft',
        warehouse_id,
        row_date,
        nullif(max(reference), ''),
        nullif(max(notes), ''),
        now(),
        auth.uid(),
        now()
      from temp_stocktake_import_rows
      where ok
      group by row_date, warehouse_id
      returning id, stocktake_date, warehouse_id
    )
    insert into temp_stocktake_docs
    select * from inserted;

    insert into public.erp_stocktake_lines (
      company_id,
      stocktake_id,
      variant_id,
      counted_qty,
      created_at
    )
    select
      v_company_id,
      d.stocktake_id,
      r.variant_id,
      r.counted_qty,
      now()
    from temp_stocktake_import_rows r
    join temp_stocktake_docs d
      on d.row_date = r.row_date
     and d.warehouse_id = r.warehouse_id
    where r.ok;

    for v_entry in select stocktake_id from temp_stocktake_docs loop
      perform public.erp_stocktake_post(v_entry.stocktake_id);
    end loop;

    select array_agg(stocktake_id)
      into v_created_doc_ids
      from temp_stocktake_docs;

    select count(*)
      into v_posted_count
      from temp_stocktake_import_rows
     where ok
       and delta <> 0;
  end if;

  update temp_stocktake_import_rows
     set message = case
       when ok then
         case
           when delta = 0 then 'No adjustment required'
           when p_validate_only then 'Validated'
           else 'Posted'
         end
       else message
     end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'row_index', r.row_index,
        'ok', r.ok,
        'message', r.message,
        'warehouse_id', r.warehouse_id,
        'variant_id', r.variant_id,
        'counted_qty', r.counted_qty,
        'on_hand', r.on_hand,
        'delta', r.delta,
        'ledger_type', r.ledger_type,
        'date', r.row_date,
        'stocktake_id', d.stocktake_id
      )
      order by r.row_index
    ),
    '[]'::jsonb
  )
  into v_results
  from temp_stocktake_import_rows r
  left join temp_stocktake_docs d
    on d.row_date = r.row_date
   and d.warehouse_id = r.warehouse_id;

  return jsonb_build_object(
    'results', v_results,
    'posted_count', v_posted_count,
    'error_count', v_error_count,
    'created_doc_ids', coalesce(v_created_doc_ids, array[]::uuid[]),
    'group_count', v_group_count
  );
end;
$$;

revoke all on function public.erp_stocktake_import_csv(jsonb, boolean) from public;
grant execute on function public.erp_stocktake_import_csv(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
