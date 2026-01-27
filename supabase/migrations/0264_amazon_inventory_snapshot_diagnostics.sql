alter table public.erp_external_inventory_batches
  add column if not exists report_processing_status text null,
  add column if not exists report_document_id text null,
  add column if not exists report_type text null,
  add column if not exists report_request jsonb null,
  add column if not exists report_response jsonb null;

create or replace function public.erp_inventory_external_batch_update(
  p_batch_id uuid,
  p_status text default null,
  p_error text default null,
  p_report_id text default null,
  p_report_type text default null,
  p_external_report_id text default null,
  p_report_document_id text default null,
  p_pulled_at timestamptz default null,
  p_rows_total int default null,
  p_matched_count int default null,
  p_unmatched_count int default null,
  p_report_processing_status text default null,
  p_report_request jsonb default null,
  p_report_response jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_inventory_writer();
  end if;

  update public.erp_external_inventory_batches
     set status = coalesce(p_status, status),
         error = p_error,
         report_id = coalesce(p_report_id, report_id),
         report_type = coalesce(p_report_type, report_type),
         external_report_id = coalesce(p_external_report_id, external_report_id),
         report_document_id = coalesce(p_report_document_id, report_document_id),
         pulled_at = coalesce(p_pulled_at, pulled_at),
         rows_total = coalesce(p_rows_total, rows_total),
         matched_count = coalesce(p_matched_count, matched_count),
         unmatched_count = coalesce(p_unmatched_count, unmatched_count),
         report_processing_status = coalesce(p_report_processing_status, report_processing_status),
         report_request = coalesce(p_report_request, report_request),
         report_response = coalesce(p_report_response, report_response)
   where id = p_batch_id
     and company_id = v_company_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Batch not found';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
