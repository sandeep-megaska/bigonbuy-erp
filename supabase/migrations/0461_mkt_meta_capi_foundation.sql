begin;
create extension if not exists pgcrypto;
create table if not exists public.erp_mkt_identity_map (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id) on delete cascade,
  source text not null,
  source_customer_id text null,
  email text null,
  phone text null,
  city text null,
  state text null,
  country text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_mkt_identity_map_company_email_idx
  on public.erp_mkt_identity_map (company_id, email);
create index if not exists erp_mkt_identity_map_company_phone_idx
  on public.erp_mkt_identity_map (company_id, phone);
create index if not exists erp_mkt_identity_map_company_source_customer_idx
  on public.erp_mkt_identity_map (company_id, source, source_customer_id);

create table if not exists public.erp_mkt_touchpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id) on delete cascade,
  session_id text not null,
  identity_id uuid null references public.erp_mkt_identity_map(id),
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  fbp text null,
  fbc text null,
  landing_url text null,
  referrer text null,
  user_agent text null,
  ip text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mkt_touchpoints_company_session_uniq unique (company_id, session_id)
);

create table if not exists public.erp_mkt_capi_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies(id) on delete cascade,
  event_name text not null,
  event_time timestamptz not null,
  event_id text not null,
  action_source text not null default 'website',
  event_source_url text null,
  identity_id uuid null references public.erp_mkt_identity_map(id),
  touchpoint_id uuid null references public.erp_mkt_touchpoints(id),
  order_id uuid null,
  payload jsonb not null,
  status text not null default 'queued',
  attempt_count int not null default 0,
  last_error text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint erp_mkt_capi_events_company_event_uniq unique (company_id, event_id),
  constraint erp_mkt_capi_events_status_check check (status in ('queued', 'sent', 'failed', 'deadletter'))
);

create index if not exists erp_mkt_capi_events_company_status_idx
  on public.erp_mkt_capi_events (company_id, status, created_at);
create index if not exists erp_mkt_capi_events_company_event_name_idx
  on public.erp_mkt_capi_events (company_id, event_name, event_time desc);

create table if not exists public.erp_mkt_settings (
  company_id uuid primary key default public.erp_current_company_id() references public.erp_companies(id) on delete cascade,
  meta_pixel_id text null,
  meta_access_token text null,
  meta_dataset_id text null,
  cod_purchase_event_mode text not null default 'fulfilled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_mkt_settings_cod_mode_check check (cod_purchase_event_mode in ('paid', 'fulfilled'))
);

alter table public.erp_mkt_identity_map enable row level security;
alter table public.erp_mkt_identity_map force row level security;
alter table public.erp_mkt_touchpoints enable row level security;
alter table public.erp_mkt_touchpoints force row level security;
alter table public.erp_mkt_capi_events enable row level security;
alter table public.erp_mkt_capi_events force row level security;
alter table public.erp_mkt_settings enable row level security;
alter table public.erp_mkt_settings force row level security;

do $$
begin
  drop policy if exists erp_mkt_identity_map_select on public.erp_mkt_identity_map;
  drop policy if exists erp_mkt_identity_map_write on public.erp_mkt_identity_map;
  drop policy if exists erp_mkt_touchpoints_select on public.erp_mkt_touchpoints;
  drop policy if exists erp_mkt_touchpoints_write on public.erp_mkt_touchpoints;
  drop policy if exists erp_mkt_capi_events_select on public.erp_mkt_capi_events;
  drop policy if exists erp_mkt_capi_events_write on public.erp_mkt_capi_events;
  drop policy if exists erp_mkt_settings_select on public.erp_mkt_settings;
  drop policy if exists erp_mkt_settings_write on public.erp_mkt_settings;

  create policy erp_mkt_identity_map_select on public.erp_mkt_identity_map
    for select using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_mkt_identity_map_write on public.erp_mkt_identity_map
    for all using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    ) with check (company_id = public.erp_current_company_id());

  create policy erp_mkt_touchpoints_select on public.erp_mkt_touchpoints
    for select using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_mkt_touchpoints_write on public.erp_mkt_touchpoints
    for all using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    ) with check (company_id = public.erp_current_company_id());

  create policy erp_mkt_capi_events_select on public.erp_mkt_capi_events
    for select using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_mkt_capi_events_write on public.erp_mkt_capi_events
    for all using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    ) with check (company_id = public.erp_current_company_id());

  create policy erp_mkt_settings_select on public.erp_mkt_settings
    for select using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
        )
      )
    );

  create policy erp_mkt_settings_write on public.erp_mkt_settings
    for all using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    ) with check (company_id = public.erp_current_company_id());
end;
$$;

create or replace function public.erp_mkt_normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(trim(p_phone), ''), '[^0-9+]', '', 'g'), '');
$$;

create or replace function public.erp_mkt_hash_field(p_value text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then null
    else encode(digest(lower(trim(p_value)), 'sha256'), 'hex')
  end;
$$;

create or replace function public.erp_mkt_touchpoint_upsert(
  p_company_id uuid,
  p_session_id text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_utm_content text,
  p_utm_term text,
  p_fbp text,
  p_fbc text,
  p_landing_url text,
  p_referrer text,
  p_user_agent text,
  p_ip text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_touchpoint_id uuid;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  if nullif(trim(coalesce(p_session_id, '')), '') is null then
    raise exception 'p_session_id is required';
  end if;

  insert into public.erp_mkt_touchpoints (
    company_id, session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbp, fbc, landing_url, referrer, user_agent, ip, updated_at
  ) values (
    p_company_id,
    trim(p_session_id),
    nullif(trim(p_utm_source), ''),
    nullif(trim(p_utm_medium), ''),
    nullif(trim(p_utm_campaign), ''),
    nullif(trim(p_utm_content), ''),
    nullif(trim(p_utm_term), ''),
    nullif(trim(p_fbp), ''),
    nullif(trim(p_fbc), ''),
    nullif(trim(p_landing_url), ''),
    nullif(trim(p_referrer), ''),
    nullif(trim(p_user_agent), ''),
    nullif(trim(p_ip), ''),
    now()
  )
  on conflict (company_id, session_id)
  do update set
    utm_source = coalesce(excluded.utm_source, public.erp_mkt_touchpoints.utm_source),
    utm_medium = coalesce(excluded.utm_medium, public.erp_mkt_touchpoints.utm_medium),
    utm_campaign = coalesce(excluded.utm_campaign, public.erp_mkt_touchpoints.utm_campaign),
    utm_content = coalesce(excluded.utm_content, public.erp_mkt_touchpoints.utm_content),
    utm_term = coalesce(excluded.utm_term, public.erp_mkt_touchpoints.utm_term),
    fbp = coalesce(excluded.fbp, public.erp_mkt_touchpoints.fbp),
    fbc = coalesce(excluded.fbc, public.erp_mkt_touchpoints.fbc),
    landing_url = coalesce(excluded.landing_url, public.erp_mkt_touchpoints.landing_url),
    referrer = coalesce(excluded.referrer, public.erp_mkt_touchpoints.referrer),
    user_agent = coalesce(excluded.user_agent, public.erp_mkt_touchpoints.user_agent),
    ip = coalesce(excluded.ip, public.erp_mkt_touchpoints.ip),
    updated_at = now()
  returning id into v_touchpoint_id;

  return v_touchpoint_id;
end;
$$;

create or replace function public.erp_mkt_identity_upsert(
  p_company_id uuid,
  p_email text,
  p_phone text,
  p_city text,
  p_state text,
  p_country text,
  p_source text,
  p_source_customer_id text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := public.erp_mkt_normalize_phone(p_phone);
  v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
  v_source_customer_id text := nullif(trim(coalesce(p_source_customer_id, '')), '');
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  if v_email is not null then
    select id into v_identity_id
    from public.erp_mkt_identity_map
    where company_id = p_company_id
      and email = v_email
    order by created_at asc
    limit 1;
  end if;

  if v_identity_id is null and v_phone is not null then
    select id into v_identity_id
    from public.erp_mkt_identity_map
    where company_id = p_company_id
      and phone = v_phone
    order by created_at asc
    limit 1;
  end if;

  if v_identity_id is null and v_source_customer_id is not null then
    select id into v_identity_id
    from public.erp_mkt_identity_map
    where company_id = p_company_id
      and source = v_source
      and source_customer_id = v_source_customer_id
    order by created_at asc
    limit 1;
  end if;

  if v_identity_id is null then
    insert into public.erp_mkt_identity_map (
      company_id, source, source_customer_id, email, phone, city, state, country
    ) values (
      p_company_id,
      v_source,
      v_source_customer_id,
      v_email,
      v_phone,
      nullif(trim(p_city), ''),
      nullif(trim(p_state), ''),
      nullif(trim(p_country), '')
    ) returning id into v_identity_id;
  else
    update public.erp_mkt_identity_map
    set
      source = coalesce(v_source, source),
      source_customer_id = coalesce(v_source_customer_id, source_customer_id),
      email = coalesce(v_email, email),
      phone = coalesce(v_phone, phone),
      city = coalesce(nullif(trim(p_city), ''), city),
      state = coalesce(nullif(trim(p_state), ''), state),
      country = coalesce(nullif(trim(p_country), ''), country),
      updated_at = now()
    where id = v_identity_id;
  end if;

  return v_identity_id;
end;
$$;

create or replace function public.erp_mkt_capi_enqueue_add_to_cart(
  p_company_id uuid,
  p_session_id text,
  p_sku text,
  p_quantity int,
  p_value numeric,
  p_currency text,
  p_event_source_url text,
  p_event_id text,
  p_fbp text,
  p_fbc text,
  p_email text,
  p_phone text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_touchpoint_id uuid;
  v_identity_id uuid;
  v_event_row_id uuid;
  v_now timestamptz := now();
  v_event_id text := coalesce(nullif(trim(p_event_id), ''), 'atc_' || replace(gen_random_uuid()::text, '-', ''));
  v_ua text;
  v_payload jsonb;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  v_touchpoint_id := public.erp_mkt_touchpoint_upsert(
    p_company_id,
    p_session_id,
    null,
    null,
    null,
    null,
    null,
    p_fbp,
    p_fbc,
    p_event_source_url,
    null,
    null,
    null
  );

  if nullif(trim(coalesce(p_email, '')), '') is not null or nullif(trim(coalesce(p_phone, '')), '') is not null then
    v_identity_id := public.erp_mkt_identity_upsert(
      p_company_id,
      p_email,
      p_phone,
      null,
      null,
      null,
      'manual',
      null
    );

    update public.erp_mkt_touchpoints
      set identity_id = coalesce(identity_id, v_identity_id), updated_at = now()
    where id = v_touchpoint_id;
  end if;

  select user_agent into v_ua
  from public.erp_mkt_touchpoints
  where id = v_touchpoint_id;

  v_payload := jsonb_build_object(
    'event_name', 'AddToCart',
    'event_time', floor(extract(epoch from v_now))::bigint,
    'event_id', v_event_id,
    'action_source', 'website',
    'event_source_url', nullif(trim(p_event_source_url), ''),
    'user_data', jsonb_strip_nulls(jsonb_build_object(
      'em', case when nullif(trim(coalesce(p_email, '')), '') is null then null else jsonb_build_array(public.erp_mkt_hash_field(p_email)) end,
      'ph', case when nullif(trim(coalesce(p_phone, '')), '') is null then null else jsonb_build_array(public.erp_mkt_hash_field(public.erp_mkt_normalize_phone(p_phone))) end,
      'fbp', nullif(trim(p_fbp), ''),
      'fbc', nullif(trim(p_fbc), ''),
      'client_user_agent', nullif(trim(v_ua), '')
    )),
    'custom_data', jsonb_build_object(
      'currency', coalesce(nullif(trim(p_currency), ''), 'INR'),
      'value', coalesce(p_value, 0),
      'contents', jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(trim(p_sku), ''), 'UNKNOWN-SKU'),
        'quantity', greatest(coalesce(p_quantity, 1), 1)
      ))
    )
  );

  insert into public.erp_mkt_capi_events (
    company_id,
    event_name,
    event_time,
    event_id,
    action_source,
    event_source_url,
    identity_id,
    touchpoint_id,
    payload,
    status,
    attempt_count,
    updated_at
  ) values (
    p_company_id,
    'AddToCart',
    v_now,
    v_event_id,
    'website',
    nullif(trim(p_event_source_url), ''),
    v_identity_id,
    v_touchpoint_id,
    v_payload,
    'queued',
    0,
    now()
  )
  on conflict (company_id, event_id)
  do update set
    payload = excluded.payload,
    status = 'queued',
    last_error = null,
    updated_at = now()
  returning id into v_event_row_id;

  return v_event_row_id;
end;
$$;

create or replace function public.erp_mkt_capi_enqueue_purchase_from_shopify_order(
  p_company_id uuid,
  p_shopify_order_json jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb := coalesce(p_shopify_order_json, '{}'::jsonb);
  v_event_row_id uuid;
  v_touchpoint_id uuid;
  v_identity_id uuid;
  v_settings public.erp_mkt_settings%rowtype;
  v_order_id text := coalesce(v_order->>'id', v_order->>'order_id', v_order->>'shopify_order_id');
  v_event_id text := 'purchase_' || coalesce(nullif(trim(v_order->>'id'), ''), nullif(trim(v_order->>'order_id'), ''), replace(gen_random_uuid()::text, '-', ''));
  v_financial_status text := lower(coalesce(v_order->>'financial_status', ''));
  v_fulfillment_status text := lower(coalesce(v_order->>'fulfillment_status', ''));
  v_gateway text := lower(coalesce(v_order->>'gateway', v_order->>'gateway_name', v_order->>'payment_gateway_names', ''));
  v_has_fulfillments boolean := coalesce(jsonb_array_length(coalesce(v_order->'fulfillments', '[]'::jsonb)), 0) > 0;
  v_is_cod boolean;
  v_allow_purchase boolean := false;
  v_email text := nullif(lower(trim(coalesce(v_order->>'email', ''))), '');
  v_phone text := public.erp_mkt_normalize_phone(v_order->>'phone');
  v_fbp text;
  v_fbc text;
  v_total_price numeric := coalesce(nullif(v_order->>'total_price', '')::numeric, 0);
  v_currency text := coalesce(nullif(trim(v_order->>'currency'), ''), 'INR');
  v_payload jsonb;
  v_order_uuid uuid;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  select * into v_settings
  from public.erp_mkt_settings
  where company_id = p_company_id;

  if not found then
    insert into public.erp_mkt_settings (company_id)
    values (p_company_id)
    on conflict (company_id) do nothing;

    select * into v_settings
    from public.erp_mkt_settings
    where company_id = p_company_id;
  end if;

  select
    max(case when lower(coalesce(x->>'name', '')) in ('_fbp', 'fbp') then nullif(trim(x->>'value'), '') end),
    max(case when lower(coalesce(x->>'name', '')) in ('_fbc', 'fbc') then nullif(trim(x->>'value'), '') end)
  into v_fbp, v_fbc
  from jsonb_array_elements(coalesce(v_order->'note_attributes', '[]'::jsonb)) as x;

  v_is_cod := (v_gateway like '%cod%') or (v_gateway like '%cash on delivery%') or (v_financial_status <> 'paid');

  if v_is_cod then
    if coalesce(v_settings.cod_purchase_event_mode, 'fulfilled') = 'paid' then
      v_allow_purchase := (v_financial_status = 'paid');
    else
      v_allow_purchase := (v_fulfillment_status = 'fulfilled' or v_has_fulfillments);
    end if;
  else
    v_allow_purchase := (v_financial_status = 'paid');
  end if;

  if not v_allow_purchase then
    return null;
  end if;

  if nullif(trim(coalesce(v_order->>'session_id', '')), '') is not null then
    v_touchpoint_id := public.erp_mkt_touchpoint_upsert(
      p_company_id,
      v_order->>'session_id',
      null,
      null,
      null,
      null,
      null,
      v_fbp,
      v_fbc,
      nullif(trim(v_order->>'landing_site'), ''),
      null,
      null,
      null
    );
  end if;

  if v_email is not null or v_phone is not null then
    v_identity_id := public.erp_mkt_identity_upsert(
      p_company_id,
      v_email,
      v_phone,
      null,
      null,
      null,
      'shopify',
      v_order_id
    );
  end if;

  if v_touchpoint_id is not null and v_identity_id is not null then
    update public.erp_mkt_touchpoints
      set identity_id = coalesce(identity_id, v_identity_id), updated_at = now()
    where id = v_touchpoint_id;
  end if;

  begin
    v_order_uuid := nullif(v_order_id, '')::uuid;
  exception when others then
    v_order_uuid := null;
  end;

  v_payload := jsonb_build_object(
    'event_name', 'Purchase',
    'event_time', floor(extract(epoch from now()))::bigint,
    'event_id', v_event_id,
    'action_source', 'website',
    'event_source_url', nullif(trim(v_order->>'order_status_url'), ''),
    'user_data', jsonb_strip_nulls(jsonb_build_object(
      'em', case when v_email is null then null else jsonb_build_array(public.erp_mkt_hash_field(v_email)) end,
      'ph', case when v_phone is null then null else jsonb_build_array(public.erp_mkt_hash_field(v_phone)) end,
      'fbp', v_fbp,
      'fbc', v_fbc
    )),
    'custom_data', jsonb_build_object(
      'currency', v_currency,
      'value', v_total_price,
      'contents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', coalesce(nullif(li->>'sku', ''), nullif(li->>'variant_id', ''), 'UNKNOWN-SKU'),
          'quantity', coalesce(nullif(li->>'quantity', '')::int, 1),
          'item_price', coalesce(nullif(li->>'price', '')::numeric, 0)
        ))
        from jsonb_array_elements(coalesce(v_order->'line_items', '[]'::jsonb)) li
      ), '[]'::jsonb)
    )
  );

  insert into public.erp_mkt_capi_events (
    company_id,
    event_name,
    event_time,
    event_id,
    action_source,
    event_source_url,
    identity_id,
    touchpoint_id,
    order_id,
    payload,
    status,
    attempt_count,
    updated_at
  ) values (
    p_company_id,
    'Purchase',
    now(),
    v_event_id,
    'website',
    nullif(trim(v_order->>'order_status_url'), ''),
    v_identity_id,
    v_touchpoint_id,
    v_order_uuid,
    v_payload,
    'queued',
    0,
    now()
  )
  on conflict (company_id, event_id)
  do update set
    payload = excluded.payload,
    status = 'queued',
    last_error = null,
    updated_at = now()
  returning id into v_event_row_id;

  return v_event_row_id;
end;
$$;

create or replace function public.erp_mkt_capi_dequeue_batch(
  p_company_id uuid,
  p_limit int default 50
) returns setof public.erp_mkt_capi_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select e.*
  from public.erp_mkt_capi_events e
  where e.company_id = p_company_id
    and e.status in ('queued', 'failed')
    and e.attempt_count < 8
  order by e.created_at asc
  limit greatest(coalesce(p_limit, 50), 1);
end;
$$;

create or replace function public.erp_mkt_capi_mark_sent(
  p_company_id uuid,
  p_event_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_mkt_capi_events
  set
    status = 'sent',
    sent_at = now(),
    last_error = null,
    attempt_count = attempt_count + 1,
    updated_at = now()
  where company_id = p_company_id
    and event_id = p_event_id;
end;
$$;

create or replace function public.erp_mkt_capi_mark_failed(
  p_company_id uuid,
  p_event_id text,
  p_error text,
  p_deadletter boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.erp_mkt_capi_events
  set
    status = case when coalesce(p_deadletter, false) then 'deadletter' else 'failed' end,
    last_error = left(coalesce(p_error, 'Unknown error'), 2000),
    attempt_count = attempt_count + 1,
    updated_at = now()
  where company_id = p_company_id
    and event_id = p_event_id;
end;
$$;

revoke all on function public.erp_mkt_touchpoint_upsert(uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.erp_mkt_identity_upsert(uuid, text, text, text, text, text, text, text) from public;
revoke all on function public.erp_mkt_capi_enqueue_add_to_cart(uuid, text, text, int, numeric, text, text, text, text, text, text, text) from public;
revoke all on function public.erp_mkt_capi_enqueue_purchase_from_shopify_order(uuid, jsonb) from public;
revoke all on function public.erp_mkt_capi_dequeue_batch(uuid, int) from public;
revoke all on function public.erp_mkt_capi_mark_sent(uuid, text) from public;
revoke all on function public.erp_mkt_capi_mark_failed(uuid, text, text, boolean) from public;

grant execute on function public.erp_mkt_touchpoint_upsert(uuid, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.erp_mkt_identity_upsert(uuid, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.erp_mkt_capi_enqueue_add_to_cart(uuid, text, text, int, numeric, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.erp_mkt_capi_enqueue_purchase_from_shopify_order(uuid, jsonb) to authenticated, service_role;
grant execute on function public.erp_mkt_capi_dequeue_batch(uuid, int) to authenticated, service_role;
grant execute on function public.erp_mkt_capi_mark_sent(uuid, text) to authenticated, service_role;
grant execute on function public.erp_mkt_capi_mark_failed(uuid, text, text, boolean) to authenticated, service_role;

commit;
