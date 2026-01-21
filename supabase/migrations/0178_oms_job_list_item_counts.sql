create or replace function public.erp_channel_job_create(
  p_channel_account_id uuid,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_id uuid;
  v_job_type text := nullif(trim(p_job_type), '');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if v_job_type is null then
    raise exception 'job_type is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'inventory')
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.erp_channel_accounts ca
    where ca.id = p_channel_account_id
      and ca.company_id = v_company_id
  ) then
    raise exception 'Channel account not found';
  end if;

  if v_job_type not in ('inventory_push', 'orders_pull', 'settlement_pull') then
    raise exception 'Invalid job type';
  end if;

  insert into public.erp_channel_jobs (
    company_id,
    channel_account_id,
    job_type,
    status,
    payload,
    requested_by,
    requested_at
  ) values (
    v_company_id,
    p_channel_account_id,
    v_job_type,
    'queued',
    coalesce(p_payload, '{}'::jsonb),
    v_actor,
    now()
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.erp_channel_job_list(
  p_channel_account_id uuid,
  p_job_type text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  job_type text,
  status text,
  payload jsonb,
  requested_by uuid,
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  item_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select j.id,
         j.job_type,
         j.status,
         j.payload,
         j.requested_by,
         j.requested_at,
         j.started_at,
         j.finished_at,
         j.error,
         coalesce(items.item_count, 0)::bigint as item_count
    from public.erp_channel_jobs j
    left join lateral (
      select count(*) as item_count
        from public.erp_channel_job_items i
       where i.job_id = j.id
    ) items on true
   where j.company_id = public.erp_current_company_id()
     and j.channel_account_id = p_channel_account_id
     and (p_job_type is null or j.job_type = p_job_type)
     and (p_status is null or j.status = p_status)
   order by j.requested_at desc
   limit p_limit
   offset p_offset;
$$;

revoke all on function public.erp_channel_job_create(uuid, text, jsonb) from public;
grant execute on function public.erp_channel_job_create(uuid, text, jsonb) to authenticated;

revoke all on function public.erp_channel_job_list(uuid, text, text, int, int) from public;
grant execute on function public.erp_channel_job_list(uuid, text, text, int, int) to authenticated;
