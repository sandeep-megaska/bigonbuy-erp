-- Inventory CSV import helpers

create or replace function public.erp_require_inventory_writer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.erp_require_inventory_writer() from public;
grant execute on function public.erp_require_inventory_writer() to authenticated;

create or replace function public.erp_inventory_adjustments_import(p_rows jsonb)
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
  v_entry record;
  v_row jsonb;
  v_index integer;
  v_warehouse_code text;
  v_sku text;
  v_qty integer;
  v_reason text;
  v_reference text;
  v_warehouse_id uuid;
  v_variant_id uuid;
  v_message text;
  v_ok boolean;
  v_posted boolean;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array';
  end if;

  for v_entry in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    v_row := v_entry.value;
    v_index := v_entry.ordinality;
    v_ok := true;
    v_posted := false;
    v_message := null;
    v_warehouse_id := null;
    v_variant_id := null;

    v_warehouse_code := nullif(trim(v_row->>'warehouse_code'), '');
    v_sku := nullif(trim(v_row->>'sku'), '');
    v_reason := nullif(trim(v_row->>'reason'), '');
    v_reference := nullif(trim(v_row->>'reference'), '');

    begin
      v_qty := (v_row->>'qty_delta')::integer;
    exception
      when others then
        v_qty := null;
    end;

    if v_warehouse_code is null or v_sku is null or v_qty is null then
      v_ok := false;
      v_message := 'Missing required fields';
    else
      select w.id
        into v_warehouse_id
        from public.erp_warehouses w
       where w.company_id = v_company_id
         and (w.code = v_warehouse_code or w.name = v_warehouse_code)
       order by case when w.code = v_warehouse_code then 0 else 1 end
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

    if v_ok then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty,
        type,
        reason,
        ref,
        created_by,
        created_at
      ) values (
        v_company_id,
        v_warehouse_id,
        v_variant_id,
        v_qty,
        'adjustment',
        coalesce(v_reason, 'CSV Import'),
        v_reference,
        auth.uid(),
        now()
      );
      v_posted := true;
      v_posted_count := v_posted_count + 1;
      v_message := 'Posted';
    else
      v_error_count := v_error_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'row_index', v_index,
        'ok', v_ok,
        'message', v_message,
        'warehouse_id', v_warehouse_id,
        'variant_id', v_variant_id,
        'delta', v_qty,
        'posted', v_posted
      )
    );
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'posted_count', v_posted_count,
    'error_count', v_error_count
  );
end;
$$;

revoke all on function public.erp_inventory_adjustments_import(jsonb) from public;
grant execute on function public.erp_inventory_adjustments_import(jsonb) to authenticated;

create or replace function public.erp_inventory_stocktake_import(p_rows jsonb)
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
  v_entry record;
  v_row jsonb;
  v_index integer;
  v_warehouse_code text;
  v_sku text;
  v_counted_qty integer;
  v_current_qty integer;
  v_delta integer;
  v_reason text;
  v_reference text;
  v_warehouse_id uuid;
  v_variant_id uuid;
  v_message text;
  v_ok boolean;
  v_posted boolean;
begin
  perform public.erp_require_inventory_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be an array';
  end if;

  for v_entry in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    v_row := v_entry.value;
    v_index := v_entry.ordinality;
    v_ok := true;
    v_posted := false;
    v_message := null;
    v_warehouse_id := null;
    v_variant_id := null;

    v_warehouse_code := nullif(trim(v_row->>'warehouse_code'), '');
    v_sku := nullif(trim(v_row->>'sku'), '');
    v_reason := nullif(trim(v_row->>'reason'), '');
    v_reference := nullif(trim(v_row->>'reference'), '');

    begin
      v_counted_qty := (v_row->>'counted_qty')::integer;
    exception
      when others then
        v_counted_qty := null;
    end;

    if v_warehouse_code is null or v_sku is null or v_counted_qty is null then
      v_ok := false;
      v_message := 'Missing required fields';
    else
      select w.id
        into v_warehouse_id
        from public.erp_warehouses w
       where w.company_id = v_company_id
         and (w.code = v_warehouse_code or w.name = v_warehouse_code)
       order by case when w.code = v_warehouse_code then 0 else 1 end
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

    if v_ok then
      select coalesce(sum(l.qty), 0)
        into v_current_qty
        from public.erp_inventory_ledger l
       where l.company_id = v_company_id
         and l.warehouse_id = v_warehouse_id
         and l.variant_id = v_variant_id;

      v_delta := v_counted_qty - v_current_qty;

      if v_delta <> 0 then
        insert into public.erp_inventory_ledger (
          company_id,
          warehouse_id,
          variant_id,
          qty,
          type,
          reason,
          ref,
          created_by,
          created_at
        ) values (
          v_company_id,
          v_warehouse_id,
          v_variant_id,
          v_delta,
          'stocktake',
          coalesce(v_reason, 'Stocktake CSV'),
          v_reference,
          auth.uid(),
          now()
        );
        v_posted := true;
        v_posted_count := v_posted_count + 1;
        v_message := 'Posted';
      else
        v_message := 'No adjustment required';
      end if;
    else
      v_error_count := v_error_count + 1;
      v_current_qty := null;
      v_delta := null;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'row_index', v_index,
        'ok', v_ok,
        'message', v_message,
        'warehouse_id', v_warehouse_id,
        'variant_id', v_variant_id,
        'delta', v_delta,
        'current_qty', v_current_qty,
        'counted_qty', v_counted_qty,
        'posted', v_posted
      )
    );
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'posted_count', v_posted_count,
    'error_count', v_error_count
  );
end;
$$;

revoke all on function public.erp_inventory_stocktake_import(jsonb) from public;
grant execute on function public.erp_inventory_stocktake_import(jsonb) to authenticated;
