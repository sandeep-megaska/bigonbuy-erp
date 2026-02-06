-- 0405_payout_placeholders.sql
-- Add placeholder entities for marketplace/COD payout credit reconciliation.

begin;

create table if not exists public.erp_payout_placeholders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  source text not null,
  bank_txn_id uuid not null references public.erp_bank_transactions (id) on delete cascade,
  txn_date date not null,
  amount numeric not null,
  description text not null,
  extracted_ref text null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_payout_placeholders_source_check check (source in ('myntra', 'flipkart', 'delhivery_cod', 'snapdeal')),
  constraint erp_payout_placeholders_company_bank_txn_unique unique (company_id, bank_txn_id)
);

create index if not exists erp_payout_placeholders_company_source_txn_date_idx
  on public.erp_payout_placeholders (company_id, source, txn_date desc);

create index if not exists erp_payout_placeholders_company_bank_txn_idx
  on public.erp_payout_placeholders (company_id, bank_txn_id);

alter table public.erp_payout_placeholders enable row level security;
alter table public.erp_payout_placeholders force row level security;

do $$
begin
  drop policy if exists erp_payout_placeholders_select on public.erp_payout_placeholders;
  drop policy if exists erp_payout_placeholders_write on public.erp_payout_placeholders;

  create policy erp_payout_placeholders_select
    on public.erp_payout_placeholders
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

  create policy erp_payout_placeholders_write
    on public.erp_payout_placeholders
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

create or replace function public.erp_payout_placeholder_upsert_from_bank_txn(
  p_bank_txn_id uuid,
  p_source text,
  p_extracted_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_source text := lower(nullif(btrim(p_source), ''));
  v_extracted_ref text := nullif(btrim(p_extracted_ref), '');
  v_txn record;
  v_placeholder_id uuid;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_source is null or v_source not in ('myntra', 'flipkart', 'delhivery_cod', 'snapdeal') then
    raise exception 'Unsupported payout placeholder source';
  end if;

  select id, txn_date, value_date, credit, description
    into v_txn
    from public.erp_bank_transactions
   where id = p_bank_txn_id
     and company_id = v_company_id
     and is_void = false
   for update;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  if coalesce(v_txn.credit, 0) <= 0 then
    raise exception 'Bank transaction must be a credit';
  end if;

  insert into public.erp_payout_placeholders (
    company_id,
    source,
    bank_txn_id,
    txn_date,
    amount,
    description,
    extracted_ref,
    created_by,
    updated_by
  ) values (
    v_company_id,
    v_source,
    p_bank_txn_id,
    coalesce(v_txn.value_date, v_txn.txn_date),
    v_txn.credit,
    coalesce(v_txn.description, ''),
    v_extracted_ref,
    v_actor,
    v_actor
  )
  on conflict (company_id, bank_txn_id)
  do update
    set source = excluded.source,
        extracted_ref = coalesce(excluded.extracted_ref, public.erp_payout_placeholders.extracted_ref),
        updated_at = now(),
        updated_by = coalesce(v_actor, public.erp_payout_placeholders.updated_by)
  returning id into v_placeholder_id;

  return v_placeholder_id;
end;
$$;

revoke all on function public.erp_payout_placeholder_upsert_from_bank_txn(uuid, text, text) from public;
grant execute on function public.erp_payout_placeholder_upsert_from_bank_txn(uuid, text, text) to authenticated;
grant execute on function public.erp_payout_placeholder_upsert_from_bank_txn(uuid, text, text) to service_role;

notify pgrst, 'reload schema';

commit;

begin;

create or replace function public.erp_bank_recon_match(
  p_bank_txn_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_confidence text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_txn record;
  v_link record;
  v_link_id uuid;
  v_confidence text := coalesce(nullif(btrim(p_confidence), ''), 'manual');
  v_notes text := nullif(btrim(p_notes), '');
  v_entity_type text := lower(btrim(p_entity_type));
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_actor is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  if v_entity_type is null or v_entity_type = '' then
    raise exception 'entity_type is required';
  end if;

  if p_entity_id is null then
    raise exception 'entity_id is required';
  end if;

  select
    t.id,
    t.is_void,
    t.is_matched,
    t.matched_entity_type,
    t.matched_entity_id
  from public.erp_bank_transactions t
  where t.id = p_bank_txn_id
    and t.company_id = v_company_id
  for update
  into v_txn;

  if not found then
    raise exception 'Bank transaction not found';
  end if;

  if v_txn.is_void then
    raise exception 'Bank transaction is void';
  end if;

  if v_txn.is_matched then
    if v_txn.matched_entity_type = v_entity_type
      and v_txn.matched_entity_id = p_entity_id then
      select l.id
        into v_link_id
        from public.erp_bank_recon_links l
       where l.company_id = v_company_id
         and l.bank_txn_id = v_txn.id
         and l.status = 'matched'
         and l.is_void = false
       order by l.matched_at desc
       limit 1;

      return jsonb_build_object(
        'ok', true,
        'bank_txn_id', v_txn.id,
        'entity_type', v_entity_type,
        'entity_id', p_entity_id,
        'link_id', v_link_id
      );
    end if;

    raise exception 'Bank transaction already matched to another entity';
  end if;

  if v_entity_type = 'razorpay_settlement' then
    perform 1
      from public.erp_razorpay_settlements s
     where s.id = p_entity_id
       and s.company_id = v_company_id
       and s.is_void = false;

    if not found then
      raise exception 'Razorpay settlement not found';
    end if;
  elsif v_entity_type = 'payout_placeholder' then
    perform 1
      from public.erp_payout_placeholders p
     where p.id = p_entity_id
       and p.company_id = v_company_id
       and p.bank_txn_id = p_bank_txn_id;

    if not found then
      raise exception 'Payout placeholder not found for bank transaction';
    end if;
  else
    raise exception 'Unsupported entity type';
  end if;

  select l.id, l.bank_txn_id
    into v_link
    from public.erp_bank_recon_links l
   where l.company_id = v_company_id
     and l.entity_type = v_entity_type
     and l.entity_id = p_entity_id
     and l.status = 'matched'
     and l.is_void = false
   limit 1
   for update;

  if v_link.id is not null then
    if v_link.bank_txn_id = p_bank_txn_id then
      v_link_id := v_link.id;
      update public.erp_bank_transactions t
         set is_matched = true,
             matched_entity_type = v_entity_type,
             matched_entity_id = p_entity_id,
             match_confidence = v_confidence,
             match_notes = v_notes,
             updated_at = now(),
             updated_by = coalesce(v_actor, updated_by)
       where t.id = p_bank_txn_id
         and t.company_id = v_company_id
         and t.is_void = false;

      return jsonb_build_object(
        'ok', true,
        'bank_txn_id', p_bank_txn_id,
        'entity_type', v_entity_type,
        'entity_id', p_entity_id,
        'link_id', v_link_id
      );
    end if;

    raise exception 'Entity already matched to another bank transaction';
  end if;

  insert into public.erp_bank_recon_links (
    company_id,
    bank_txn_id,
    entity_type,
    entity_id,
    confidence,
    notes,
    match_confidence,
    match_notes,
    status,
    matched_by_user_id,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_bank_txn_id,
    v_entity_type,
    p_entity_id,
    v_confidence,
    v_notes,
    v_confidence,
    v_notes,
    'matched',
    v_actor,
    v_actor,
    v_actor
  )
  returning id into v_link_id;

  update public.erp_bank_transactions t
     set is_matched = true,
         matched_entity_type = v_entity_type,
         matched_entity_id = p_entity_id,
         match_confidence = v_confidence,
         match_notes = v_notes,
         updated_at = now(),
         updated_by = coalesce(v_actor, updated_by)
   where t.id = p_bank_txn_id
     and t.company_id = v_company_id
     and t.is_void = false;

  return jsonb_build_object(
    'ok', true,
    'bank_txn_id', p_bank_txn_id,
    'entity_type', v_entity_type,
    'entity_id', p_entity_id,
    'link_id', v_link_id
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
