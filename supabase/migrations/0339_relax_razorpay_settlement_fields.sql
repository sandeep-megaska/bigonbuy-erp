-- 0339_relax_razorpay_settlement_fields.sql
-- Fix CSV import mapping for Razorpay settlement UTR fields and keep row-level errors.

create or replace function public.erp_razorpay_settlement_upsert_from_csv(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_line int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_error_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_settlement_id text;
  v_amount numeric;
  v_settled_at timestamptz;
  v_status text;
  v_currency text;
  v_utr text;
  v_settlement_utr text;
  v_raw jsonb;
  v_inserted_flag boolean;
  v_reason text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_line := v_line + 1;
    v_reason := null;

    if v_row is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_settlement_id := nullif(trim(coalesce(v_row->>'settlement_id', v_row->>'razorpay_settlement_id', '')), '');

    if v_settlement_id is null then
      v_reason := 'settlement_id is required';
    end if;

    v_amount := null;
    v_settled_at := null;
    v_status := null;
    v_currency := null;
    v_utr := null;
    v_settlement_utr := null;
    v_raw := coalesce(v_row->'raw', v_row, '{}'::jsonb);

    if v_reason is null then
      v_status := nullif(trim(coalesce(v_row->>'status', '')), '');
      v_currency := nullif(trim(coalesce(v_row->>'currency', '')), '');
      v_utr := nullif(trim(coalesce(v_row->>'utr', '')), '');
      v_settlement_utr := nullif(trim(coalesce(v_row->>'settlement_utr', v_row->>'additional_utr', '')), '');

      if coalesce(trim(v_row->>'amount'), '') <> '' then
        begin
          v_amount := (v_row->>'amount')::numeric;
        exception
          when others then
            v_reason := 'amount must be numeric';
        end;
      end if;

      if v_reason is null and coalesce(trim(v_row->>'settled_at'), '') <> '' then
        begin
          v_settled_at := (v_row->>'settled_at')::timestamptz;
        exception
          when others then
            v_reason := 'settled_at must be a valid timestamp';
        end;
      end if;
    end if;

    if v_reason is not null then
      v_errors := v_errors + 1;
      if jsonb_array_length(v_error_rows) < 50 then
        v_error_rows := v_error_rows || jsonb_build_array(
          jsonb_build_object(
            'line', v_line,
            'settlement_id', v_settlement_id,
            'reason', v_reason
          )
        );
      end if;
      continue;
    end if;

    insert into public.erp_razorpay_settlements (
      company_id,
      razorpay_settlement_id,
      settlement_utr,
      utr,
      amount,
      currency,
      status,
      settled_at,
      raw,
      fetched_at,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id,
      is_void
    ) values (
      v_company_id,
      v_settlement_id,
      v_settlement_utr,
      v_utr,
      v_amount,
      v_currency,
      v_status,
      v_settled_at,
      coalesce(v_raw, '{}'::jsonb),
      now(),
      now(),
      v_actor,
      now(),
      v_actor,
      false
    )
    on conflict (company_id, razorpay_settlement_id) where is_void = false
    do update set
      settlement_utr = excluded.settlement_utr,
      utr = excluded.utr,
      amount = excluded.amount,
      currency = excluded.currency,
      status = excluded.status,
      settled_at = excluded.settled_at,
      raw = coalesce(public.erp_razorpay_settlements.raw, '{}'::jsonb) || excluded.raw,
      fetched_at = now(),
      updated_at = now(),
      updated_by_user_id = v_actor
    returning (xmax = 0) into v_inserted_flag;

    if v_inserted_flag then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted_count', v_inserted,
    'updated_count', v_updated,
    'skipped_count', v_skipped,
    'errors', v_error_rows
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_upsert_from_csv(jsonb) from public;
grant execute on function public.erp_razorpay_settlement_upsert_from_csv(jsonb) to authenticated;
