-- 0334_bank_recon_match_rpc.sql
-- Phase 2F: Bank recon match/unmatch RPCs and link columns

begin;

alter table public.erp_bank_recon_links
  add column if not exists match_confidence text null;

alter table public.erp_bank_recon_links
  add column if not exists match_notes text null;

alter table public.erp_bank_recon_links
  add column if not exists voided_by_user_id uuid null;

update public.erp_bank_recon_links
   set match_confidence = coalesce(match_confidence, confidence),
       match_notes = coalesce(match_notes, notes)
 where match_confidence is null
    or match_notes is null;

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

  if v_entity_type <> 'razorpay_settlement' then
    raise exception 'Unsupported entity type';
  end if;

  perform 1
    from public.erp_razorpay_settlements s
   where s.id = p_entity_id
     and s.company_id = v_company_id
     and s.is_void = false;

  if not found then
    raise exception 'Razorpay settlement not found';
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

create or replace function public.erp_bank_recon_unmatch(
  p_bank_txn_id uuid
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
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_actor is null and auth.role() <> 'service_role' then
    raise exception 'Not authenticated';
  end if;

  select
    t.id,
    t.is_void
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

  select l.id
    into v_link
    from public.erp_bank_recon_links l
   where l.company_id = v_company_id
     and l.bank_txn_id = p_bank_txn_id
     and l.status = 'matched'
     and l.is_void = false
   order by l.matched_at desc
   limit 1
   for update;

  if v_link.id is not null then
    update public.erp_bank_recon_links
       set status = 'unmatched',
           unmatched_at = now(),
           unmatched_by_user_id = v_actor,
           updated_at = now(),
           updated_by = coalesce(v_actor, updated_by)
     where id = v_link.id;
  end if;

  update public.erp_bank_transactions t
     set is_matched = false,
         matched_entity_type = null,
         matched_entity_id = null,
         match_confidence = null,
         match_notes = null,
         updated_at = now(),
         updated_by = coalesce(v_actor, updated_by)
   where t.id = p_bank_txn_id
     and t.company_id = v_company_id
     and t.is_void = false;

  return jsonb_build_object(
    'ok', true,
    'bank_txn_id', p_bank_txn_id,
    'link_id', v_link.id,
    'message', case when v_link.id is null then 'already unmatched' else 'unmatched' end
  );
end;
$$;

create or replace function public.erp_bank_recon_suggest_razorpay_settlements(
  p_bank_txn_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.erp_require_finance_reader();

  select public.erp_bank_txn_match_suggest_razorpay(p_bank_txn_id, 5)
    into v_result;

  return v_result;
end;
$$;

revoke all on function public.erp_bank_recon_match(uuid, text, uuid, text, text) from public;
revoke all on function public.erp_bank_recon_unmatch(uuid) from public;
revoke all on function public.erp_bank_recon_suggest_razorpay_settlements(uuid) from public;

grant execute on function public.erp_bank_recon_match(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.erp_bank_recon_unmatch(uuid) to authenticated;
grant execute on function public.erp_bank_recon_suggest_razorpay_settlements(uuid) to authenticated;

commit;
