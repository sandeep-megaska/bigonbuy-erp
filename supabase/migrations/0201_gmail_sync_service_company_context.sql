-- 0201_gmail_sync_service_company_context.sql
-- Purpose:
-- Add service-only RPCs that accept explicit company_id for Gmail sync jobs
-- running with service_role where auth.uid() is null.

create or replace function public.erp_company_settings_get_service(
  p_company_id uuid
) returns setof public.erp_company_settings
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select *
  from public.erp_company_settings
  where company_id = p_company_id;
end;
$$;

revoke all on function public.erp_company_settings_get_service(uuid) from public;
revoke all on function public.erp_company_settings_get_service(uuid) from authenticated;
grant execute on function public.erp_company_settings_get_service(uuid) to service_role;

create or replace function public.erp_company_settings_update_gmail_service(
  p_company_id uuid,
  p_gmail_user text,
  p_connected boolean,
  p_last_synced_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_company_settings
     set gmail_user = p_gmail_user,
         gmail_connected = p_connected,
         gmail_last_synced_at = p_last_synced_at,
         updated_at = now(),
         updated_by = null
   where company_id = p_company_id;
end;
$$;

revoke all on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) from public;
revoke all on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) from authenticated;
grant execute on function public.erp_company_settings_update_gmail_service(
  uuid,
  text,
  boolean,
  timestamptz
) to service_role;

create or replace function public.erp_email_ingest_batch_create_or_get_service(
  p_company_id uuid,
  p_gmail_message_id text,
  p_thread_id text,
  p_subject text,
  p_from text,
  p_received_at timestamptz,
  p_headers jsonb,
  p_attachment_names text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  select id
    into v_id
    from public.erp_email_ingest_batches
   where company_id = p_company_id
     and gmail_message_id = p_gmail_message_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.erp_email_ingest_batches (
    company_id,
    provider,
    gmail_message_id,
    gmail_thread_id,
    subject,
    from_email,
    received_at,
    status,
    attachment_names,
    raw_headers,
    created_by
  ) values (
    p_company_id,
    'gmail',
    p_gmail_message_id,
    nullif(p_thread_id, ''),
    nullif(p_subject, ''),
    nullif(p_from, ''),
    p_received_at,
    'ingested',
    p_attachment_names,
    p_headers,
    null
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_email_ingest_batch_create_or_get_service(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb,
  text[]
) from public;
revoke all on function public.erp_email_ingest_batch_create_or_get_service(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb,
  text[]
) from authenticated;
grant execute on function public.erp_email_ingest_batch_create_or_get_service(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb,
  text[]
) to service_role;

create or replace function public.erp_email_ingest_batch_mark_service(
  p_company_id uuid,
  p_id uuid,
  p_status text,
  p_error text,
  p_parsed_event_count integer,
  p_settlement_batch_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_email_ingest_batches
     set status = coalesce(nullif(p_status, ''), status),
         error_text = nullif(p_error, ''),
         parsed_event_count = coalesce(p_parsed_event_count, parsed_event_count),
         settlement_batch_id = coalesce(p_settlement_batch_id, settlement_batch_id)
   where id = p_id
     and company_id = p_company_id;
end;
$$;

revoke all on function public.erp_email_ingest_batch_mark_service(
  uuid,
  uuid,
  text,
  text,
  integer,
  uuid
) from public;
revoke all on function public.erp_email_ingest_batch_mark_service(
  uuid,
  uuid,
  text,
  text,
  integer,
  uuid
) from authenticated;
grant execute on function public.erp_email_ingest_batch_mark_service(
  uuid,
  uuid,
  text,
  text,
  integer,
  uuid
) to service_role;

create or replace function public.erp_settlement_batch_create_service(
  p_company_id uuid,
  p_source text,
  p_source_ref text,
  p_received_at timestamptz,
  p_raw jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.erp_settlement_batches (
    company_id,
    source,
    source_ref,
    received_at,
    raw_payload,
    created_by
  ) values (
    p_company_id,
    p_source,
    p_source_ref,
    coalesce(p_received_at, now()),
    p_raw,
    null
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_settlement_batch_create_service(
  uuid,
  text,
  text,
  timestamptz,
  jsonb
) from public;
revoke all on function public.erp_settlement_batch_create_service(
  uuid,
  text,
  text,
  timestamptz,
  jsonb
) from authenticated;
grant execute on function public.erp_settlement_batch_create_service(
  uuid,
  text,
  text,
  timestamptz,
  jsonb
) to service_role;

create or replace function public.erp_settlement_event_insert_service(
  p_company_id uuid,
  p_batch_id uuid,
  p_platform text,
  p_event_type text,
  p_event_date date,
  p_amount numeric,
  p_currency text,
  p_reference_no text,
  p_party text,
  p_payload jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.erp_settlement_events (
    company_id,
    platform,
    event_type,
    event_date,
    amount,
    currency,
    reference_no,
    party,
    batch_id,
    raw_payload,
    created_by
  ) values (
    p_company_id,
    p_platform,
    p_event_type,
    p_event_date,
    p_amount,
    coalesce(p_currency, 'INR'),
    nullif(p_reference_no, ''),
    p_party,
    p_batch_id,
    p_payload,
    null
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_settlement_event_insert_service(
  uuid,
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  jsonb
) from public;
revoke all on function public.erp_settlement_event_insert_service(
  uuid,
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.erp_settlement_event_insert_service(
  uuid,
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  jsonb
) to service_role;
