create table if not exists public.erp_email_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete restrict,
  provider text not null default 'gmail',
  gmail_message_id text not null,
  gmail_thread_id text null,
  subject text null,
  from_email text null,
  received_at timestamptz null,
  status text not null default 'ingested',
  attachment_names text[] null,
  parsed_event_count integer not null default 0,
  settlement_batch_id uuid null references public.erp_settlement_batches (id) on delete set null,
  raw_headers jsonb null,
  error_text text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

alter table public.erp_email_ingest_batches
  add column if not exists company_id uuid;

alter table public.erp_email_ingest_batches
  add column if not exists provider text;

alter table public.erp_email_ingest_batches
  add column if not exists gmail_message_id text;

alter table public.erp_email_ingest_batches
  add column if not exists gmail_thread_id text;

alter table public.erp_email_ingest_batches
  add column if not exists subject text;

alter table public.erp_email_ingest_batches
  add column if not exists from_email text;

alter table public.erp_email_ingest_batches
  add column if not exists received_at timestamptz;

alter table public.erp_email_ingest_batches
  add column if not exists status text;

alter table public.erp_email_ingest_batches
  add column if not exists attachment_names text[];

alter table public.erp_email_ingest_batches
  add column if not exists parsed_event_count integer;

alter table public.erp_email_ingest_batches
  add column if not exists settlement_batch_id uuid;

alter table public.erp_email_ingest_batches
  add column if not exists raw_headers jsonb;

alter table public.erp_email_ingest_batches
  add column if not exists error_text text;

alter table public.erp_email_ingest_batches
  add column if not exists created_at timestamptz;

alter table public.erp_email_ingest_batches
  add column if not exists created_by uuid;

create unique index if not exists erp_email_ingest_batches_company_message_idx
  on public.erp_email_ingest_batches (company_id, gmail_message_id);

create index if not exists erp_email_ingest_batches_company_received_idx
  on public.erp_email_ingest_batches (company_id, received_at desc);

create index if not exists erp_email_ingest_batches_company_status_idx
  on public.erp_email_ingest_batches (company_id, status);

alter table public.erp_email_ingest_batches enable row level security;
alter table public.erp_email_ingest_batches force row level security;

do $$
begin
  drop policy if exists erp_email_ingest_batches_select on public.erp_email_ingest_batches;
  drop policy if exists erp_email_ingest_batches_insert on public.erp_email_ingest_batches;
  drop policy if exists erp_email_ingest_batches_update on public.erp_email_ingest_batches;

  create policy erp_email_ingest_batches_select
    on public.erp_email_ingest_batches
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_email_ingest_batches_insert
    on public.erp_email_ingest_batches
    for insert
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );

  create policy erp_email_ingest_batches_update
    on public.erp_email_ingest_batches
    for update
    using (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and exists (
        select 1
        from public.erp_company_users cu
        where cu.company_id = public.erp_current_company_id()
          and cu.user_id = auth.uid()
          and coalesce(cu.is_active, true)
          and cu.role_key in ('owner', 'admin', 'finance')
      )
    );
end;
$$;

create or replace function public.erp_email_ingest_batch_create_or_get(
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
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
begin
  perform public.erp_require_finance_writer();

  select id
    into v_id
    from public.erp_email_ingest_batches
   where company_id = v_company_id
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
    v_company_id,
    'gmail',
    p_gmail_message_id,
    nullif(p_thread_id, ''),
    nullif(p_subject, ''),
    nullif(p_from, ''),
    p_received_at,
    'ingested',
    p_attachment_names,
    p_headers,
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_email_ingest_batch_create_or_get(text, text, text, text, timestamptz, jsonb, text[]) from public;
grant execute on function public.erp_email_ingest_batch_create_or_get(text, text, text, text, timestamptz, jsonb, text[]) to authenticated;

create or replace function public.erp_email_ingest_batch_mark(
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
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_writer();

  update public.erp_email_ingest_batches
     set status = coalesce(nullif(p_status, ''), status),
         error_text = nullif(p_error, ''),
         parsed_event_count = coalesce(p_parsed_event_count, parsed_event_count),
         settlement_batch_id = coalesce(p_settlement_batch_id, settlement_batch_id)
   where id = p_id
     and company_id = v_company_id;
end;
$$;

revoke all on function public.erp_email_ingest_batch_mark(uuid, text, text, integer, uuid) from public;
grant execute on function public.erp_email_ingest_batch_mark(uuid, text, text, integer, uuid) to authenticated;

create or replace function public.erp_email_ingest_batches_recent(
  p_limit integer default 10
) returns table (
  id uuid,
  gmail_message_id text,
  subject text,
  from_email text,
  received_at timestamptz,
  status text,
  parsed_event_count integer,
  error_text text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    b.id,
    b.gmail_message_id,
    b.subject,
    b.from_email,
    b.received_at,
    b.status,
    b.parsed_event_count,
    b.error_text
  from public.erp_email_ingest_batches b
  where b.company_id = public.erp_current_company_id()
  order by b.received_at desc nulls last, b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

revoke all on function public.erp_email_ingest_batches_recent(integer) from public;
grant execute on function public.erp_email_ingest_batches_recent(integer) to authenticated;
