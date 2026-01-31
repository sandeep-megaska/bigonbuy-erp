-- Razorpay settlements -> bank posting (Phase 2D)

create table if not exists public.erp_razorpay_settlement_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  is_active boolean not null default true,
  razorpay_clearing_account_id uuid not null references public.erp_gl_accounts (id),
  bank_account_id uuid not null references public.erp_gl_accounts (id),
  gateway_fees_account_id uuid null references public.erp_gl_accounts (id),
  gst_input_on_fees_account_id uuid null references public.erp_gl_accounts (id),
  razorpay_key_id text not null,
  razorpay_key_secret text not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null
);

create unique index if not exists erp_razorpay_settlement_config_company_active_unique
  on public.erp_razorpay_settlement_config (company_id)
  where is_active = true
    and is_void = false;

alter table public.erp_razorpay_settlement_config enable row level security;
alter table public.erp_razorpay_settlement_config force row level security;

do $$
begin
  drop policy if exists erp_razorpay_settlement_config_select on public.erp_razorpay_settlement_config;
  drop policy if exists erp_razorpay_settlement_config_write on public.erp_razorpay_settlement_config;

  create policy erp_razorpay_settlement_config_select
    on public.erp_razorpay_settlement_config
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

  create policy erp_razorpay_settlement_config_write
    on public.erp_razorpay_settlement_config
    for all
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
    )
    with check (
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
end;
$$;

create table if not exists public.erp_razorpay_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  razorpay_settlement_id text not null,
  settlement_utr text null,
  amount numeric(14,2) null,
  currency text null,
  status text null,
  settled_at timestamptz null,
  raw jsonb not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by_user_id uuid null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null
);

create unique index if not exists erp_razorpay_settlements_company_razorpay_unique
  on public.erp_razorpay_settlements (company_id, razorpay_settlement_id)
  where is_void = false;

create index if not exists erp_razorpay_settlements_company_settled_idx
  on public.erp_razorpay_settlements (company_id, settled_at desc);

alter table public.erp_razorpay_settlements enable row level security;
alter table public.erp_razorpay_settlements force row level security;

do $$
begin
  drop policy if exists erp_razorpay_settlements_select on public.erp_razorpay_settlements;
  drop policy if exists erp_razorpay_settlements_write on public.erp_razorpay_settlements;

  create policy erp_razorpay_settlements_select
    on public.erp_razorpay_settlements
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

  create policy erp_razorpay_settlements_write
    on public.erp_razorpay_settlements
    for all
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
    )
    with check (
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
end;
$$;

create table if not exists public.erp_razorpay_settlement_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  razorpay_settlement_id text not null,
  finance_journal_id uuid not null references public.erp_fin_journals (id),
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null,
  idempotency_key uuid null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by_user_id uuid null
);

create unique index if not exists erp_razorpay_settlement_posts_company_unique
  on public.erp_razorpay_settlement_posts (company_id, razorpay_settlement_id)
  where is_void = false;

create unique index if not exists erp_razorpay_settlement_posts_company_idempotency_key
  on public.erp_razorpay_settlement_posts (company_id, idempotency_key)
  where idempotency_key is not null
    and is_void = false;

alter table public.erp_razorpay_settlement_posts enable row level security;
alter table public.erp_razorpay_settlement_posts force row level security;

do $$
begin
  drop policy if exists erp_razorpay_settlement_posts_select on public.erp_razorpay_settlement_posts;
  drop policy if exists erp_razorpay_settlement_posts_write on public.erp_razorpay_settlement_posts;

  create policy erp_razorpay_settlement_posts_select
    on public.erp_razorpay_settlement_posts
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

  create policy erp_razorpay_settlement_posts_write
    on public.erp_razorpay_settlement_posts
    for all
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
    )
    with check (
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
end;
$$;

create or replace function public.erp_razorpay_settlement_config_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_config record;
begin
  perform public.erp_require_finance_reader();

  select
    id,
    is_active,
    razorpay_clearing_account_id,
    bank_account_id,
    gateway_fees_account_id,
    gst_input_on_fees_account_id,
    razorpay_key_id,
    razorpay_key_secret,
    updated_at
    into v_config
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id
    and c.is_void = false
  order by c.updated_at desc
  limit 1;

  return jsonb_build_object(
    'company_id', v_company_id,
    'id', v_config.id,
    'is_active', coalesce(v_config.is_active, false),
    'razorpay_clearing_account_id', v_config.razorpay_clearing_account_id,
    'bank_account_id', v_config.bank_account_id,
    'gateway_fees_account_id', v_config.gateway_fees_account_id,
    'gst_input_on_fees_account_id', v_config.gst_input_on_fees_account_id,
    'razorpay_key_id', v_config.razorpay_key_id,
    'razorpay_key_secret', v_config.razorpay_key_secret,
    'updated_at', v_config.updated_at
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_config_get() from public;
grant execute on function public.erp_razorpay_settlement_config_get() to authenticated;

create or replace function public.erp_razorpay_settlement_config_upsert(
  p_razorpay_key_id text,
  p_razorpay_key_secret text,
  p_razorpay_clearing_account_id uuid,
  p_bank_account_id uuid,
  p_gateway_fees_account_id uuid default null,
  p_gst_input_on_fees_account_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_existing_id uuid;
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if p_razorpay_key_id is null or length(trim(p_razorpay_key_id)) = 0 then
    raise exception 'Razorpay key id is required';
  end if;

  if p_razorpay_key_secret is null or length(trim(p_razorpay_key_secret)) = 0 then
    raise exception 'Razorpay key secret is required';
  end if;

  select id
    into v_existing_id
    from public.erp_razorpay_settlement_config c
    where c.company_id = v_company_id
      and c.is_void = false
    order by c.updated_at desc
    limit 1
    for update;

  if v_existing_id is null then
    insert into public.erp_razorpay_settlement_config (
      company_id,
      is_active,
      razorpay_clearing_account_id,
      bank_account_id,
      gateway_fees_account_id,
      gst_input_on_fees_account_id,
      razorpay_key_id,
      razorpay_key_secret,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id
    ) values (
      v_company_id,
      true,
      p_razorpay_clearing_account_id,
      p_bank_account_id,
      p_gateway_fees_account_id,
      p_gst_input_on_fees_account_id,
      p_razorpay_key_id,
      p_razorpay_key_secret,
      now(),
      v_actor,
      now(),
      v_actor
    )
    returning id into v_id;
  else
    update public.erp_razorpay_settlement_config
    set is_active = true,
        razorpay_clearing_account_id = p_razorpay_clearing_account_id,
        bank_account_id = p_bank_account_id,
        gateway_fees_account_id = p_gateway_fees_account_id,
        gst_input_on_fees_account_id = p_gst_input_on_fees_account_id,
        razorpay_key_id = p_razorpay_key_id,
        razorpay_key_secret = p_razorpay_key_secret,
        updated_at = now(),
        updated_by_user_id = v_actor
    where id = v_existing_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.erp_razorpay_settlement_config_upsert(text, text, uuid, uuid, uuid, uuid) from public;
grant execute on function public.erp_razorpay_settlement_config_upsert(text, text, uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.erp_razorpay_settlement_config_seed_minimal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_clearing_id uuid;
  v_bank_id uuid;
  v_missing text[] := '{}'::text[];
  v_existing_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select id into v_clearing_id
  from public.erp_gl_accounts
  where company_id = v_company_id and code = '1102'
  limit 1;

  select id into v_bank_id
  from public.erp_gl_accounts
  where company_id = v_company_id
    and (code = '1001' or lower(name) like '%bank%')
  order by case when code = '1001' then 0 else 1 end, code
  limit 1;

  if v_clearing_id is null then
    v_missing := array_append(v_missing, '1102');
  end if;

  if v_bank_id is null then
    v_missing := array_append(v_missing, 'BANK');
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object(
      'company_id', v_company_id,
      'applied', false,
      'missing_codes', v_missing
    );
  end if;

  select id into v_existing_id
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id
    and c.is_void = false
  order by c.updated_at desc
  limit 1;

  if v_existing_id is null then
    return jsonb_build_object(
      'company_id', v_company_id,
      'applied', false,
      'missing_codes', array['RAZORPAY_KEYS']
    );
  end if;

  return jsonb_build_object(
    'company_id', v_company_id,
    'applied', true,
    'config_id', v_existing_id
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_config_seed_minimal() from public;
grant execute on function public.erp_razorpay_settlement_config_seed_minimal() to authenticated;

create or replace function public.erp_razorpay_settlements_upsert(
  p_razorpay_settlement_id text,
  p_settlement_utr text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_settled_at timestamptz,
  p_raw jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  insert into public.erp_razorpay_settlements (
    company_id,
    razorpay_settlement_id,
    settlement_utr,
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
    p_razorpay_settlement_id,
    p_settlement_utr,
    p_amount,
    p_currency,
    p_status,
    p_settled_at,
    coalesce(p_raw, '{}'::jsonb),
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
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    settled_at = excluded.settled_at,
    raw = excluded.raw,
    fetched_at = now(),
    updated_at = now(),
    updated_by_user_id = v_actor
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_razorpay_settlements_upsert(text, text, numeric, text, text, timestamptz, jsonb) from public;
grant execute on function public.erp_razorpay_settlements_upsert(text, text, numeric, text, text, timestamptz, jsonb) to authenticated;

create or replace function public.erp_razorpay_settlements_list(
  p_limit int default 200,
  p_offset int default 0
)
returns table(
  id uuid,
  razorpay_settlement_id text,
  settlement_utr text,
  amount numeric,
  currency text,
  status text,
  settled_at timestamptz,
  fetched_at timestamptz,
  posted_journal_id uuid,
  posted_doc_no text,
  post_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  select
    s.id,
    s.razorpay_settlement_id,
    s.settlement_utr,
    s.amount,
    s.currency,
    s.status,
    s.settled_at,
    s.fetched_at,
    p.finance_journal_id,
    j.doc_no,
    p.status
  from public.erp_razorpay_settlements s
  left join public.erp_razorpay_settlement_posts p
    on p.company_id = s.company_id
   and p.razorpay_settlement_id = s.razorpay_settlement_id
   and p.is_void = false
  left join public.erp_fin_journals j
    on j.company_id = s.company_id
   and j.id = p.finance_journal_id
  where s.company_id = public.erp_current_company_id()
    and s.is_void = false
  order by s.settled_at desc nulls last, s.fetched_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.erp_razorpay_settlements_list(int, int) from public;
grant execute on function public.erp_razorpay_settlements_list(int, int) to authenticated;

create or replace function public.erp_razorpay_settlement_posting_preview(
  p_razorpay_settlement_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_settlement record;
  v_config record;
  v_clearing record;
  v_bank record;
  v_fees record;
  v_gst record;
  v_bank_amount numeric(14,2) := 0;
  v_fee_amount numeric(14,2) := 0;
  v_tax_amount numeric(14,2) := 0;
  v_clearing_total numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_errors text[] := '{}'::text[];
  v_warnings text[] := '{}'::text[];
  v_can_post boolean := false;
  v_post record;
  v_has_recon boolean := false;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_settlement
    from public.erp_razorpay_settlements s
    where s.company_id = v_company_id
      and s.razorpay_settlement_id = p_razorpay_settlement_id
      and s.is_void = false
    limit 1;

  if v_settlement.id is null then
    return jsonb_build_object(
      'settlement', jsonb_build_object('razorpay_settlement_id', p_razorpay_settlement_id),
      'lines', '[]'::jsonb,
      'errors', jsonb_build_array('Settlement not found'),
      'warnings', '[]'::jsonb,
      'can_post', false
    );
  end if;

  select
    razorpay_clearing_account_id,
    bank_account_id,
    gateway_fees_account_id,
    gst_input_on_fees_account_id
    into v_config
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id
    and c.is_void = false
    and c.is_active
  order by c.updated_at desc
  limit 1;

  if v_config.razorpay_clearing_account_id is null or v_config.bank_account_id is null then
    v_errors := array_append(v_errors, 'Razorpay settlement config missing');
  else
    select id, code, name into v_clearing from public.erp_gl_accounts a where a.id = v_config.razorpay_clearing_account_id;
    select id, code, name into v_bank from public.erp_gl_accounts a where a.id = v_config.bank_account_id;
    select id, code, name into v_fees from public.erp_gl_accounts a where a.id = v_config.gateway_fees_account_id;
    select id, code, name into v_gst from public.erp_gl_accounts a where a.id = v_config.gst_input_on_fees_account_id;
  end if;

  if v_clearing.id is null or v_bank.id is null then
    v_errors := array_append(v_errors, 'Razorpay settlement config missing');
  end if;

  if v_clearing.id is not null and v_clearing.code <> '1102' then
    v_errors := array_append(v_errors, 'Razorpay clearing account (1102) missing');
  end if;

  v_bank_amount := round(coalesce(v_settlement.amount, 0), 2);
  v_has_recon := v_settlement.raw ? 'recon_summary';

  if v_has_recon then
    v_fee_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'fee_total')::numeric, 0), 2);
    v_tax_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'tax_total')::numeric, 0), 2);
  else
    v_warnings := array_append(v_warnings, 'Recon not available; fees not booked');
  end if;

  if v_bank_amount <= 0 then
    v_errors := array_append(v_errors, 'Settlement amount missing');
  end if;

  if v_fee_amount > 0 and v_fees.id is null then
    v_errors := array_append(v_errors, 'Gateway fees account missing');
  end if;

  if v_tax_amount > 0 and v_gst.id is null then
    v_errors := array_append(v_errors, 'GST input on fees account missing');
  end if;

  v_clearing_total := round(v_bank_amount + v_fee_amount + v_tax_amount, 2);

  if array_length(v_errors, 1) is null then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'memo', 'Razorpay settlement bank payout',
        'side', 'debit',
        'amount', v_bank_amount,
        'account_id', v_bank.id,
        'account_code', v_bank.code,
        'account_name', v_bank.name
      ),
      jsonb_build_object(
        'memo', 'Razorpay clearing',
        'side', 'credit',
        'amount', v_clearing_total,
        'account_id', v_clearing.id,
        'account_code', v_clearing.code,
        'account_name', v_clearing.name
      )
    );

    if v_fee_amount > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'memo', 'Payment gateway fees',
          'side', 'debit',
          'amount', v_fee_amount,
          'account_id', v_fees.id,
          'account_code', v_fees.code,
          'account_name', v_fees.name
        )
      );
    end if;

    if v_tax_amount > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'memo', 'GST input on fees',
          'side', 'debit',
          'amount', v_tax_amount,
          'account_id', v_gst.id,
          'account_code', v_gst.code,
          'account_name', v_gst.name
        )
      );
    end if;

    v_can_post := true;
  end if;

  select p.finance_journal_id, j.doc_no
    into v_post
    from public.erp_razorpay_settlement_posts p
    join public.erp_fin_journals j
      on j.id = p.finance_journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.razorpay_settlement_id = v_settlement.razorpay_settlement_id
      and p.is_void = false
    limit 1;

  return jsonb_build_object(
    'settlement', jsonb_build_object(
      'razorpay_settlement_id', v_settlement.razorpay_settlement_id,
      'settled_at', v_settlement.settled_at,
      'amount', v_bank_amount,
      'status', v_settlement.status,
      'utr', v_settlement.settlement_utr
    ),
    'config', jsonb_build_object(
      'clearing_account', jsonb_build_object('id', v_clearing.id, 'code', v_clearing.code, 'name', v_clearing.name),
      'bank_account', jsonb_build_object('id', v_bank.id, 'code', v_bank.code, 'name', v_bank.name),
      'gateway_fees_account', jsonb_build_object('id', v_fees.id, 'code', v_fees.code, 'name', v_fees.name),
      'gst_input_on_fees_account', jsonb_build_object('id', v_gst.id, 'code', v_gst.code, 'name', v_gst.name)
    ),
    'totals', jsonb_build_object(
      'clearing_credit_total', v_clearing_total,
      'bank_debit_total', v_bank_amount,
      'fees_debit_total', v_fee_amount,
      'gst_on_fees_debit_total', v_tax_amount
    ),
    'journal_lines', v_lines,
    'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', v_post.finance_journal_id,
      'doc_no', v_post.doc_no
    )
  );
end;
$$;

revoke all on function public.erp_razorpay_settlement_posting_preview(text) from public;
grant execute on function public.erp_razorpay_settlement_posting_preview(text) to authenticated;

create or replace function public.erp_razorpay_settlement_post(
  p_razorpay_settlement_id text,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_settlement record;
  v_existing_doc_id uuid;
  v_config record;
  v_clearing record;
  v_bank record;
  v_fees record;
  v_gst record;
  v_bank_amount numeric(14,2) := 0;
  v_fee_amount numeric(14,2) := 0;
  v_tax_amount numeric(14,2) := 0;
  v_clearing_total numeric(14,2) := 0;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_has_recon boolean := false;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select *
    into v_settlement
    from public.erp_razorpay_settlements s
    where s.company_id = v_company_id
      and s.razorpay_settlement_id = p_razorpay_settlement_id
      and s.is_void = false
    for update;

  if v_settlement.id is null then
    raise exception 'Settlement not found';
  end if;

  if p_idempotency_key is not null then
    select p.finance_journal_id
      into v_existing_doc_id
      from public.erp_razorpay_settlement_posts p
      where p.company_id = v_company_id
        and p.idempotency_key = p_idempotency_key
        and p.is_void = false;

    if v_existing_doc_id is not null then
      return v_existing_doc_id;
    end if;
  end if;

  select p.finance_journal_id
    into v_existing_doc_id
    from public.erp_razorpay_settlement_posts p
    where p.company_id = v_company_id
      and p.razorpay_settlement_id = p_razorpay_settlement_id
      and p.is_void = false;

  if v_existing_doc_id is not null then
    return v_existing_doc_id;
  end if;

  select
    razorpay_clearing_account_id,
    bank_account_id,
    gateway_fees_account_id,
    gst_input_on_fees_account_id
    into v_config
  from public.erp_razorpay_settlement_config c
  where c.company_id = v_company_id
    and c.is_void = false
    and c.is_active
  order by c.updated_at desc
  limit 1;

  if v_config.razorpay_clearing_account_id is null or v_config.bank_account_id is null then
    raise exception 'Razorpay settlement config missing';
  end if;

  select id, code, name into v_clearing from public.erp_gl_accounts a where a.id = v_config.razorpay_clearing_account_id;
  select id, code, name into v_bank from public.erp_gl_accounts a where a.id = v_config.bank_account_id;
  select id, code, name into v_fees from public.erp_gl_accounts a where a.id = v_config.gateway_fees_account_id;
  select id, code, name into v_gst from public.erp_gl_accounts a where a.id = v_config.gst_input_on_fees_account_id;

  if v_clearing.id is null or v_bank.id is null then
    raise exception 'Razorpay settlement config missing';
  end if;

  if v_clearing.code <> '1102' then
    raise exception 'Razorpay clearing account (1102) missing';
  end if;

  v_bank_amount := round(coalesce(v_settlement.amount, 0), 2);
  v_has_recon := v_settlement.raw ? 'recon_summary';

  if v_has_recon then
    v_fee_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'fee_total')::numeric, 0), 2);
    v_tax_amount := round(coalesce((v_settlement.raw->'recon_summary'->>'tax_total')::numeric, 0), 2);
  end if;

  if v_bank_amount <= 0 then
    raise exception 'Settlement amount missing';
  end if;

  if v_fee_amount > 0 and v_fees.id is null then
    raise exception 'Gateway fees account missing';
  end if;

  if v_tax_amount > 0 and v_gst.id is null then
    raise exception 'GST input on fees account missing';
  end if;

  v_clearing_total := round(v_bank_amount + v_fee_amount + v_tax_amount, 2);

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    coalesce(v_settlement.settled_at::date, current_date),
    'posted',
    format('Razorpay settlement %s payout', v_settlement.razorpay_settlement_id),
    'razorpay_settlement',
    v_settlement.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_bank.code,
      v_bank.name,
      'Razorpay settlement bank payout',
      v_bank_amount,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_clearing.code,
      v_clearing.name,
      'Razorpay clearing',
      0,
      v_clearing_total
    );

  if v_fee_amount > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      3,
      v_fees.code,
      v_fees.name,
      'Payment gateway fees',
      v_fee_amount,
      0
    );
  end if;

  if v_tax_amount > 0 then
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      case when v_fee_amount > 0 then 4 else 3 end,
      v_gst.code,
      v_gst.name,
      'GST input on fees',
      v_tax_amount,
      0
    );
  end if;

  select
    coalesce(sum(l.debit), 0),
    coalesce(sum(l.credit), 0)
    into v_total_debit, v_total_credit
  from public.erp_fin_journal_lines l
  where l.company_id = v_company_id
    and l.journal_id = v_journal_id;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must be balanced';
  end if;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  insert into public.erp_razorpay_settlement_posts (
    company_id,
    razorpay_settlement_id,
    finance_journal_id,
    status,
    posted_at,
    posted_by_user_id,
    idempotency_key,
    created_at,
    created_by_user_id,
    updated_at,
    updated_by_user_id,
    is_void
  ) values (
    v_company_id,
    v_settlement.razorpay_settlement_id,
    v_journal_id,
    'posted',
    now(),
    v_actor,
    p_idempotency_key,
    now(),
    v_actor,
    now(),
    v_actor,
    false
  );

  return v_journal_id;
end;
$$;

revoke all on function public.erp_razorpay_settlement_post(text, uuid) from public;
grant execute on function public.erp_razorpay_settlement_post(text, uuid) to authenticated;
