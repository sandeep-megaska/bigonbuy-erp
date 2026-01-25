-- 0248_inventory_min_levels_rpc.sql
-- Inventory health: min level upsert RPC

create or replace function public.erp_inventory_min_level_upsert(
  p_sku text,
  p_warehouse_id uuid,
  p_min_qty numeric
)
returns table (
  id uuid,
  variant_id uuid,
  warehouse_id uuid,
  min_level numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_variant_id uuid;
  v_row_id uuid;
begin
  v_company_id := public.erp_current_company_id();

  if v_company_id is null then
    raise exception 'No company configured';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = auth.uid()
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized to update minimum levels';
  end if;

  if p_sku is null or btrim(p_sku) = '' then
    raise exception 'SKU is required';
  end if;

  select v.id into v_variant_id
  from public.erp_variants v
  where v.company_id = v_company_id
    and v.sku = p_sku
  limit 1;

  if v_variant_id is null then
    raise exception 'SKU not found';
  end if;

  select m.id into v_row_id
  from public.erp_inventory_min_levels m
  where m.company_id = v_company_id
    and m.variant_id = v_variant_id
    and (
      (m.warehouse_id is null and p_warehouse_id is null)
      or m.warehouse_id = p_warehouse_id
    )
  limit 1;

  if v_row_id is null then
    insert into public.erp_inventory_min_levels (
      company_id,
      variant_id,
      warehouse_id,
      min_level,
      created_at,
      created_by,
      updated_at,
      updated_by,
      is_void
    )
    values (
      v_company_id,
      v_variant_id,
      p_warehouse_id,
      coalesce(p_min_qty, 0),
      now(),
      auth.uid(),
      now(),
      auth.uid(),
      false
    )
    returning id into v_row_id;
  else
    update public.erp_inventory_min_levels
    set min_level = coalesce(p_min_qty, 0),
        updated_at = now(),
        updated_by = auth.uid(),
        is_void = false
    where id = v_row_id;
  end if;

  return query
  select m.id, m.variant_id, m.warehouse_id, m.min_level
  from public.erp_inventory_min_levels m
  where m.id = v_row_id;
end;
$$;

revoke all on function public.erp_inventory_min_level_upsert(text, uuid, numeric) from public;
grant execute on function public.erp_inventory_min_level_upsert(text, uuid, numeric) to authenticated;
