-- 0450_mfg_prod1_fix_reverse_core_logic.sql
-- Make erp_mfg_stage_consumption_reverse_core_v1 self-contained.
-- It must NOT call a missing canonical reverse_v1(batch_id, actor, reason, client_reverse_id).

create or replace function public.erp_mfg_stage_consumption_reverse_core_v1(
  p_consumption_batch_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_reverse_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.erp_mfg_consumption_batches;
  v_existing public.erp_mfg_consumption_reversals;
  v_reversal public.erp_mfg_consumption_reversals;
  v_line record;
begin
  if p_consumption_batch_id is null or p_client_reverse_id is null then
    raise exception 'consumption_batch_id and client_reverse_id are required';
  end if;

  if to_regclass('public.erp_mfg_consumption_batches') is null then
    raise exception 'Missing table public.erp_mfg_consumption_batches';
  end if;
  if to_regclass('public.erp_mfg_consumption_batch_lines') is null then
    raise exception 'Missing table public.erp_mfg_consumption_batch_lines';
  end if;
  if to_regclass('public.erp_mfg_consumption_reversals') is null then
    raise exception 'Missing table public.erp_mfg_consumption_reversals';
  end if;
  if to_regclass('public.erp_mfg_material_ledger') is null then
    raise exception 'Missing table public.erp_mfg_material_ledger';
  end if;

  select *
    into v_batch
  from public.erp_mfg_consumption_batches b
  where b.id = p_consumption_batch_id
  limit 1;

  if v_batch.id is null then
    raise exception 'Consumption batch not found';
  end if;

  -- If already reversed, return reversal id
  if v_batch.status = 'reversed' and v_batch.reversal_batch_id is not null then
    return v_batch.reversal_batch_id;
  end if;

  if v_batch.status <> 'posted' then
    raise exception 'Only posted batches can be reversed';
  end if;

  -- Idempotency: if reversal exists by original_batch_id or client_reverse_id, reuse it
  select *
    into v_existing
  from public.erp_mfg_consumption_reversals r
  where r.original_batch_id = v_batch.id
     or r.client_reverse_id = p_client_reverse_id
  limit 1;

  if v_existing.id is not null then
    update public.erp_mfg_consumption_batches
       set status = 'reversed',
           reversal_batch_id = v_existing.id
     where id = v_batch.id
       and status <> 'reversed';

    return v_existing.id;
  end if;

  -- Create reversal record
  insert into public.erp_mfg_consumption_reversals (
    company_id,
    vendor_id,
    original_batch_id,
    client_reverse_id,
    reason,
    reversed_at,
    reversed_by_user_id,
    created_at
  ) values (
    v_batch.company_id,
    v_batch.vendor_id,
    v_batch.id,
    p_client_reverse_id,
    nullif(trim(coalesce(p_reason, '')), ''),
    now(),
    p_actor_user_id,
    now()
  )
  returning * into v_reversal;

  -- Post reversal ledger IN entries for each consumed line
  for v_line in
    select
      bl.material_id,
      bl.required_qty,
      bl.uom
    from public.erp_mfg_consumption_batch_lines bl
    where bl.batch_id = v_batch.id
  loop
    insert into public.erp_mfg_material_ledger (
      company_id,
      vendor_id,
      material_id,
      entry_date,
      entry_ts,
      entry_type,
      qty_in,
      qty_out,
      uom,
      reference_type,
      reference_id,
      reference_key,
      notes,
      created_at,
      created_by_user_id
    ) values (
      v_batch.company_id,
      v_batch.vendor_id,
      v_line.material_id,
      current_date,
      now(),
      'REVERSAL',
      v_line.required_qty,
      0,
      v_line.uom,
      'MFG_STAGE_CONSUMPTION_REVERSAL',
      v_batch.id,
      'reverse_batch:' || v_reversal.id::text || ':material:' || v_line.material_id::text,
      concat(
        'Reversal for stage consumption batch ',
        jsonb_build_object(
          'batch_id', v_batch.id,
          'reversal_id', v_reversal.id,
          'reason', nullif(trim(coalesce(p_reason, '')), '')
        )::text
      ),
      now(),
      p_actor_user_id
    )
    on conflict (company_id, reference_key)
    do nothing;
  end loop;

  -- Mark batch reversed (audit-safe state change)
  update public.erp_mfg_consumption_batches
     set status = 'reversed',
         reversal_batch_id = v_reversal.id
   where id = v_batch.id;

  return v_reversal.id;
end;
$$;

revoke all on function public.erp_mfg_stage_consumption_reverse_core_v1(uuid, uuid, text, uuid) from public;
grant execute on function public.erp_mfg_stage_consumption_reverse_core_v1(uuid, uuid, text, uuid) to service_role;

select pg_notify('pgrst', 'reload schema');
