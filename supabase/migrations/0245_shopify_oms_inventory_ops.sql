-- 0245_shopify_oms_inventory_ops.sql
-- Phase-4A OMS inventory ledger operations (reservations, fulfillment, cancel, refund)

create or replace function public.erp_oms_reserve_inventory(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_warehouse_id uuid;
  v_reference text;
  v_qty_out int;
  v_reservations_created int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_warehouse_id := public.erp_oms_channel_default_warehouse(v_order.channel_account_id);
  if v_warehouse_id is null then
    raise exception 'No default warehouse configured for channel';
  end if;

  v_reference := 'oms_order:' || coalesce(v_order.external_order_number, v_order.external_order_id::text, v_order.id::text);

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    v_qty_out := greatest(coalesce(v_line.quantity, 0), 0)::int;
    if v_qty_out = 0 then
      continue;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'reservation'
         and il.ref_type = 'oms_order'
         and il.ref_id = v_order.id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        qty,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        movement_at,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_order.company_id,
        v_warehouse_id,
        v_line.variant_id,
        0,
        v_qty_out,
        -v_qty_out,
        'reservation',
        v_reference,
        'oms_order',
        v_order.id,
        v_line.id,
        now(),
        now(),
        coalesce(v_actor, v_order.created_by),
        now(),
        coalesce(v_actor, v_order.updated_by)
      );

      v_reservations_created := v_reservations_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reservations_created', v_reservations_created
  );
end;
$$;

revoke all on function public.erp_oms_reserve_inventory(uuid) from public;
revoke all on function public.erp_oms_reserve_inventory(uuid) from authenticated;
grant execute on function public.erp_oms_reserve_inventory(uuid) to authenticated;
grant execute on function public.erp_oms_reserve_inventory(uuid) to service_role;

create or replace function public.erp_oms_fulfill_order(
  p_order_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_fulfillment_id uuid;
  v_external_id bigint;
  v_existing_fulfillment uuid;
  v_reference text;
  v_ledger_inserted int := 0;
  v_reservations_released int := 0;
  v_qty_out int;
  v_payload_qty numeric;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_reference := 'oms_order:' || coalesce(v_order.external_order_number, v_order.external_order_id::text, v_order.id::text);
  v_external_id := nullif(p_payload->>'id', '')::bigint;

  if v_external_id is not null then
    select id
      into v_existing_fulfillment
      from public.erp_oms_fulfillments
     where company_id = v_order.company_id
       and source = 'shopify'
       and external_fulfillment_id = v_external_id
     limit 1;
  end if;

  if v_existing_fulfillment is null then
    insert into public.erp_oms_fulfillments (
      company_id,
      order_id,
      source,
      external_fulfillment_id,
      status,
      fulfilled_at,
      raw_fulfillment,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      'shopify',
      v_external_id,
      'fulfilled',
      coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now()),
      coalesce(p_payload, '{}'::jsonb),
      now(),
      coalesce(v_actor, v_order.created_by),
      now(),
      coalesce(v_actor, v_order.updated_by)
    )
    returning id into v_fulfillment_id;
  else
    v_fulfillment_id := v_existing_fulfillment;
  end if;

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    v_payload_qty := null;
    if p_payload ? 'line_items' then
      select nullif(item->>'quantity', '')::numeric
        into v_payload_qty
        from jsonb_array_elements(p_payload->'line_items') item
       where nullif(item->>'id', '')::bigint = v_line.external_line_id
       limit 1;
    end if;

    v_qty_out := greatest(coalesce(v_payload_qty, v_line.quantity, 0), 0)::int;
    if v_qty_out = 0 then
      continue;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'sale'
         and il.ref_type = 'oms_fulfillment'
         and il.ref_id = v_fulfillment_id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        qty,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        movement_at,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_order.company_id,
        public.erp_oms_channel_default_warehouse(v_order.channel_account_id),
        v_line.variant_id,
        0,
        v_qty_out,
        -v_qty_out,
        'sale',
        v_reference,
        'oms_fulfillment',
        v_fulfillment_id,
        v_line.id,
        now(),
        now(),
        coalesce(v_actor, v_order.created_by),
        now(),
        coalesce(v_actor, v_order.updated_by)
      );
      v_ledger_inserted := v_ledger_inserted + 1;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'reservation_cancel'
         and il.ref_type = 'oms_order'
         and il.ref_id = v_order.id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      if exists (
        select 1
          from public.erp_inventory_ledger il
         where il.company_id = v_order.company_id
           and il.entry_type = 'reservation'
           and il.ref_type = 'oms_order'
           and il.ref_id = v_order.id
           and il.ref_line_id = v_line.id
           and il.is_void = false
      ) then
        insert into public.erp_inventory_ledger (
          company_id,
          warehouse_id,
          variant_id,
          qty_in,
          qty_out,
          qty,
          entry_type,
          reference,
          ref_type,
          ref_id,
          ref_line_id,
          movement_at,
          created_at,
          created_by,
          updated_at,
          updated_by
        ) values (
          v_order.company_id,
          public.erp_oms_channel_default_warehouse(v_order.channel_account_id),
          v_line.variant_id,
          v_qty_out,
          0,
          v_qty_out,
          'reservation_cancel',
          v_reference,
          'oms_order',
          v_order.id,
          v_line.id,
          now(),
          now(),
          coalesce(v_actor, v_order.created_by),
          now(),
          coalesce(v_actor, v_order.updated_by)
        );
        v_reservations_released := v_reservations_released + 1;
      end if;
    end if;

    update public.erp_oms_order_lines
       set status = 'fulfilled'
     where id = v_line.id;
  end loop;

  update public.erp_oms_orders
     set fulfillment_status = 'fulfilled',
         status = 'fulfilled',
         updated_at = now(),
         updated_by = coalesce(v_actor, v_order.updated_by)
   where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'fulfillment_id', v_fulfillment_id,
    'ledger_inserted', v_ledger_inserted,
    'reservations_released', v_reservations_released
  );
end;
$$;

revoke all on function public.erp_oms_fulfill_order(uuid, jsonb) from public;
revoke all on function public.erp_oms_fulfill_order(uuid, jsonb) from authenticated;
grant execute on function public.erp_oms_fulfill_order(uuid, jsonb) to authenticated;
grant execute on function public.erp_oms_fulfill_order(uuid, jsonb) to service_role;

create or replace function public.erp_oms_cancel_order(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_reference text;
  v_qty_in int;
  v_reservations_released int := 0;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_reference := 'oms_order:' || coalesce(v_order.external_order_number, v_order.external_order_id::text, v_order.id::text);

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    v_qty_in := greatest(coalesce(v_line.quantity, 0), 0)::int;
    if v_qty_in = 0 then
      continue;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'reservation_cancel'
         and il.ref_type = 'oms_order'
         and il.ref_id = v_order.id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      if exists (
        select 1
          from public.erp_inventory_ledger il
         where il.company_id = v_order.company_id
           and il.entry_type = 'reservation'
           and il.ref_type = 'oms_order'
           and il.ref_id = v_order.id
           and il.ref_line_id = v_line.id
           and il.is_void = false
      ) then
        insert into public.erp_inventory_ledger (
          company_id,
          warehouse_id,
          variant_id,
          qty_in,
          qty_out,
          qty,
          entry_type,
          reference,
          ref_type,
          ref_id,
          ref_line_id,
          movement_at,
          created_at,
          created_by,
          updated_at,
          updated_by
        ) values (
          v_order.company_id,
          public.erp_oms_channel_default_warehouse(v_order.channel_account_id),
          v_line.variant_id,
          v_qty_in,
          0,
          v_qty_in,
          'reservation_cancel',
          v_reference,
          'oms_order',
          v_order.id,
          v_line.id,
          now(),
          now(),
          coalesce(v_actor, v_order.created_by),
          now(),
          coalesce(v_actor, v_order.updated_by)
        );
        v_reservations_released := v_reservations_released + 1;
      end if;
    end if;

    update public.erp_oms_order_lines
       set status = 'cancelled'
     where id = v_line.id;
  end loop;

  update public.erp_oms_orders
     set status = 'cancelled',
         fulfillment_status = 'cancelled',
         is_cancelled = true,
         cancelled_at = coalesce(cancelled_at, now()),
         updated_at = now(),
         updated_by = coalesce(v_actor, v_order.updated_by)
   where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'reservations_released', v_reservations_released
  );
end;
$$;

revoke all on function public.erp_oms_cancel_order(uuid) from public;
revoke all on function public.erp_oms_cancel_order(uuid) from authenticated;
grant execute on function public.erp_oms_cancel_order(uuid) to authenticated;
grant execute on function public.erp_oms_cancel_order(uuid) to service_role;

create or replace function public.erp_oms_refund_order(
  p_order_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.erp_oms_orders%rowtype;
  v_line public.erp_oms_order_lines%rowtype;
  v_refund_id uuid;
  v_external_id bigint;
  v_existing_refund uuid;
  v_reference text;
  v_ledger_inserted int := 0;
  v_qty_in int;
  v_payload_qty numeric;
  v_has_sale boolean;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  if p_order_id is null then
    raise exception 'oms_order_id is required';
  end if;

  select *
    into v_order
    from public.erp_oms_orders
   where id = p_order_id
   limit 1;

  if v_order.id is null then
    raise exception 'OMS order not found';
  end if;

  v_reference := 'oms_order:' || coalesce(v_order.external_order_number, v_order.external_order_id::text, v_order.id::text);
  v_external_id := nullif(p_payload->>'id', '')::bigint;

  if v_external_id is not null then
    select id
      into v_existing_refund
      from public.erp_oms_refunds
     where company_id = v_order.company_id
       and source = 'shopify'
       and external_refund_id = v_external_id
     limit 1;
  end if;

  if v_existing_refund is null then
    insert into public.erp_oms_refunds (
      company_id,
      order_id,
      source,
      external_refund_id,
      status,
      refunded_at,
      raw_refund,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_order.company_id,
      v_order.id,
      'shopify',
      v_external_id,
      'refunded',
      coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now()),
      coalesce(p_payload, '{}'::jsonb),
      now(),
      coalesce(v_actor, v_order.created_by),
      now(),
      coalesce(v_actor, v_order.updated_by)
    )
    returning id into v_refund_id;
  else
    v_refund_id := v_existing_refund;
  end if;

  for v_line in
    select *
      from public.erp_oms_order_lines
     where order_id = v_order.id
  loop
    if v_line.variant_id is null then
      continue;
    end if;

    select exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'sale'
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) into v_has_sale;

    if not v_has_sale then
      continue;
    end if;

    v_payload_qty := null;
    if p_payload ? 'refund_line_items' then
      select nullif(item->>'quantity', '')::numeric
        into v_payload_qty
        from jsonb_array_elements(p_payload->'refund_line_items') item
       where nullif(item->>'line_item_id', '')::bigint = v_line.external_line_id
          or nullif(item->'line_item'->>'id', '')::bigint = v_line.external_line_id
       limit 1;
    end if;

    v_qty_in := greatest(coalesce(v_payload_qty, v_line.quantity, 0), 0)::int;
    if v_qty_in = 0 then
      continue;
    end if;

    if not exists (
      select 1
        from public.erp_inventory_ledger il
       where il.company_id = v_order.company_id
         and il.entry_type = 'return'
         and il.ref_type = 'oms_refund'
         and il.ref_id = v_refund_id
         and il.ref_line_id = v_line.id
         and il.is_void = false
    ) then
      insert into public.erp_inventory_ledger (
        company_id,
        warehouse_id,
        variant_id,
        qty_in,
        qty_out,
        qty,
        entry_type,
        reference,
        ref_type,
        ref_id,
        ref_line_id,
        movement_at,
        created_at,
        created_by,
        updated_at,
        updated_by
      ) values (
        v_order.company_id,
        public.erp_oms_channel_default_warehouse(v_order.channel_account_id),
        v_line.variant_id,
        v_qty_in,
        0,
        v_qty_in,
        'return',
        v_reference,
        'oms_refund',
        v_refund_id,
        v_line.id,
        now(),
        now(),
        coalesce(v_actor, v_order.created_by),
        now(),
        coalesce(v_actor, v_order.updated_by)
      );
      v_ledger_inserted := v_ledger_inserted + 1;
    end if;

    update public.erp_oms_order_lines
       set status = 'refunded'
     where id = v_line.id;
  end loop;

  update public.erp_oms_orders
     set status = 'refunded',
         updated_at = now(),
         updated_by = coalesce(v_actor, v_order.updated_by)
   where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'refund_id', v_refund_id,
    'ledger_inserted', v_ledger_inserted
  );
end;
$$;

revoke all on function public.erp_oms_refund_order(uuid, jsonb) from public;
revoke all on function public.erp_oms_refund_order(uuid, jsonb) from authenticated;
grant execute on function public.erp_oms_refund_order(uuid, jsonb) to authenticated;
grant execute on function public.erp_oms_refund_order(uuid, jsonb) to service_role;

create or replace function public.erp_inventory_available(p_warehouse_id uuid default null)
returns table (
  warehouse_id uuid,
  variant_id uuid,
  internal_sku text,
  on_hand numeric,
  reserved numeric,
  available numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ledger_totals as (
    select
      l.warehouse_id,
      l.variant_id,
      sum(
        case
          when l.entry_type in ('reservation', 'reservation_cancel') then 0
          else (l.qty_in - l.qty_out)
        end
      )::numeric as on_hand,
      sum(
        case
          when l.entry_type = 'reservation' then l.qty_out
          when l.entry_type = 'reservation_cancel' then -l.qty_in
          else 0
        end
      )::numeric as reserved
    from public.erp_inventory_ledger l
    where l.company_id = public.erp_current_company_id()
      and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
    group by l.warehouse_id, l.variant_id
  )
  select
    lt.warehouse_id,
    lt.variant_id,
    v.sku as internal_sku,
    lt.on_hand,
    coalesce(lt.reserved, 0) as reserved,
    (lt.on_hand - coalesce(lt.reserved, 0)) as available
  from ledger_totals lt
  join public.erp_variants v
    on v.id = lt.variant_id
   and v.company_id = public.erp_current_company_id()
  order by v.sku asc;
$$;

revoke all on function public.erp_inventory_available(uuid) from public;
grant execute on function public.erp_inventory_available(uuid) to authenticated;

notify pgrst, 'reload schema';
