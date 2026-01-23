-- 0212_gst_sku_bulk_upsert.sql
-- Bulk upsert RPC for GST SKU master mappings.

alter table public.erp_gst_sku_master
  add column if not exists style_code text null;

create unique index if not exists erp_gst_sku_master_unique_style_active
  on public.erp_gst_sku_master (company_id, style_code)
  where style_code is not null and is_active = true and sku is null;

create or replace function public.erp_gst_sku_bulk_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_total int := 0;
  v_valid int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_errors int := 0;
  v_skipped int := 0;
  v_error_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_line int := 0;
  v_style_code text;
  v_hsn_raw text;
  v_hsn text;
  v_rate numeric;
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
    v_total := v_total + 1;

    if coalesce(trim(v_row->>'style_code'), '') = ''
      and coalesce(trim(v_row->>'hsn'), '') = ''
      and coalesce(trim(v_row->>'gst_rate'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_style_code := upper(trim(coalesce(v_row->>'style_code', '')));
    v_hsn_raw := coalesce(v_row->>'hsn', '');
    v_hsn := regexp_replace(v_hsn_raw, '\\D', '', 'g');

    v_rate := null;
    v_reason := null;

    begin
      if v_row ? 'gst_rate' and coalesce(trim(v_row->>'gst_rate'), '') <> '' then
        v_rate := (v_row->>'gst_rate')::numeric;
      else
        v_rate := 5;
      end if;
    exception
      when others then
        v_reason := 'gst_rate must be numeric';
    end;

    if v_reason is null then
      if v_style_code = '' then
        v_reason := 'style_code is required';
      elsif v_hsn = '' then
        v_reason := 'hsn is required';
      elsif length(v_hsn) < 4 or length(v_hsn) > 10 then
        v_reason := 'hsn must be 4-10 digits';
      elsif v_rate is null then
        v_reason := 'gst_rate is required';
      elsif v_rate <> 5 then
        v_reason := 'gst_rate must be 5';
      end if;
    end if;

    if v_reason is not null then
      v_errors := v_errors + 1;
      if jsonb_array_length(v_error_rows) < 50 then
        v_error_rows := v_error_rows || jsonb_build_array(
          jsonb_build_object(
            'line', v_line,
            'style_code', nullif(v_style_code, ''),
            'hsn', nullif(v_hsn_raw, ''),
            'gst_rate', nullif(v_row->>'gst_rate', ''),
            'reason', v_reason
          )
        );
      end if;
      continue;
    end if;

    v_valid := v_valid + 1;

    insert into public.erp_gst_sku_master (
      company_id,
      style_code,
      sku,
      hsn,
      gst_rate,
      is_active,
      created_at,
      created_by,
      updated_at,
      updated_by
    ) values (
      v_company_id,
      v_style_code,
      null,
      v_hsn,
      v_rate,
      true,
      now(),
      v_actor,
      now(),
      v_actor
    )
    on conflict (company_id, style_code)
    where style_code is not null and is_active = true and sku is null
    do update set
      hsn = excluded.hsn,
      gst_rate = excluded.gst_rate,
      is_active = true,
      updated_at = now(),
      updated_by = v_actor
    returning (xmax = 0) into v_inserted_flag;

    if v_inserted_flag then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'total_lines', v_total,
    'valid', v_valid,
    'inserted', v_inserted,
    'updated', v_updated,
    'upserted', v_inserted + v_updated,
    'skipped', v_skipped,
    'errors', v_errors,
    'error_rows', v_error_rows
  );
end;
$$;

revoke all on function public.erp_gst_sku_bulk_upsert(jsonb) from public;
revoke all on function public.erp_gst_sku_bulk_upsert(jsonb) from authenticated;
grant execute on function public.erp_gst_sku_bulk_upsert(jsonb) to authenticated;
