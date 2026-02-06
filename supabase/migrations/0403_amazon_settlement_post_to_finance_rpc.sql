-- 0403_amazon_settlement_post_to_finance_rpc.sql
-- Add Amazon settlement batch Post-to-Finance RPC expected by UI

begin;

drop function if exists public.erp_amazon_settlement_batch_post_to_finance(uuid, uuid);

create function public.erp_amazon_settlement_batch_post_to_finance(
  p_actor_user_id uuid,
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor_user_id uuid := coalesce(p_actor_user_id, auth.uid());
  v_batch record;
  v_post record;
  v_preview jsonb;
  v_can_post boolean := false;
  v_warnings jsonb := '[]'::jsonb;
  v_line jsonb;
  v_account record;
  v_journal_id uuid;
  v_journal_no text;
  v_journal_date date;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_line_no integer := 1;
begin
  perform public.erp_require_finance_writer();

  if p_batch_id is null then
    raise exception 'p_batch_id is required';
  end if;

  select b.*
    into v_batch
  from public.erp_marketplace_settlement_batches b
  join public.erp_sales_channels ch
    on ch.id = b.channel_id
  where b.company_id = v_company_id
    and b.id = p_batch_id
    and lower(coalesce(ch.code, '')) = 'amazon'
  for update;

  if v_batch.id is null then
    raise exception 'Settlement batch not found for id %', p_batch_id;
  end if;

  select
    p.journal_id,
    j.doc_no,
    p.posting_state
    into v_post
  from public.erp_marketplace_settlement_finance_posts p
  left join public.erp_fin_journals j
    on j.company_id = v_company_id
   and j.id = p.journal_id
  where p.company_id = v_company_id
    and p.batch_id = p_batch_id
    and p.platform = 'amazon'
  for update;

  if v_post.journal_id is not null and coalesce(v_post.posting_state, 'posted') = 'posted' then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'journal_id', v_post.journal_id,
      'journal_no', v_post.doc_no
    );
  end if;

  if coalesce(v_post.posting_state, '') = 'excluded' then
    raise exception 'Settlement batch is excluded from posting';
  end if;

  v_preview := public.erp_amazon_settlement_batch_preview_post_to_finance(p_batch_id);
  v_can_post := coalesce((v_preview ->> 'can_post')::boolean, false);
  v_warnings := coalesce(v_preview -> 'warnings', '[]'::jsonb);

  if not v_can_post then
    raise exception 'Cannot post settlement batch: %',
      coalesce((select string_agg(value, '; ') from jsonb_array_elements_text(v_warnings) as w(value)), 'Unknown warning');
  end if;

  for v_line in
    select value
    from jsonb_array_elements(coalesce(v_preview -> 'lines', '[]'::jsonb))
  loop
    v_total_debit := v_total_debit + round(coalesce((v_line ->> 'dr')::numeric, 0), 2);
    v_total_credit := v_total_credit + round(coalesce((v_line ->> 'cr')::numeric, 0), 2);
  end loop;

  v_total_debit := round(v_total_debit, 2);
  v_total_credit := round(v_total_credit, 2);

  if v_total_debit <= 0 and v_total_credit <= 0 then
    raise exception 'Cannot post settlement batch: no journal lines generated';
  end if;

  if v_total_debit <> v_total_credit then
    raise exception 'Cannot post settlement batch: journal is not balanced (% vs %)', v_total_debit, v_total_credit;
  end if;

  v_journal_date := coalesce(v_batch.deposit_date, v_batch.period_end, v_batch.period_start, current_date);
  perform public.erp_require_fin_open_period(v_company_id, v_journal_date);

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
    v_journal_date,
    'posted',
    format('Amazon Settlement %s', coalesce(v_batch.batch_ref, v_batch.id::text)),
    'amazon_settlement_batch',
    v_batch.id,
    v_total_debit,
    v_total_credit,
    v_actor_user_id
  )
  returning id into v_journal_id;

  for v_line in
    select value
    from jsonb_array_elements(coalesce(v_preview -> 'lines', '[]'::jsonb))
  loop
    if coalesce((v_line ->> 'dr')::numeric, 0) = 0 and coalesce((v_line ->> 'cr')::numeric, 0) = 0 then
      continue;
    end if;

    select a.code, a.name
      into v_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.id = nullif(v_line ->> 'account_id', '')::uuid
    limit 1;

    if v_account.code is null and nullif(v_line ->> 'account_code', '') is not null then
      v_account.code := nullif(v_line ->> 'account_code', '');
      v_account.name := nullif(v_line ->> 'account_name', '');
    end if;

    if v_account.code is null then
      raise exception 'Missing account mapping for role %', coalesce(v_line ->> 'role_key', 'unknown');
    end if;

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
      v_line_no,
      v_account.code,
      v_account.name,
      coalesce(nullif(v_line ->> 'label', ''), coalesce(v_line ->> 'role_key', 'Amazon settlement')),
      round(coalesce((v_line ->> 'dr')::numeric, 0), 2),
      round(coalesce((v_line ->> 'cr')::numeric, 0), 2)
    );

    v_line_no := v_line_no + 1;
  end loop;

  v_journal_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals j
  set doc_no = v_journal_no
  where j.company_id = v_company_id
    and j.id = v_journal_id;

  insert into public.erp_marketplace_settlement_finance_posts (
    company_id,
    platform,
    batch_id,
    posting_state,
    journal_id,
    posted_at,
    posted_by,
    updated_at,
    updated_by
  ) values (
    v_company_id,
    'amazon',
    p_batch_id,
    'posted',
    v_journal_id,
    now(),
    v_actor_user_id,
    now(),
    v_actor_user_id
  )
  on conflict (company_id, platform, batch_id)
  do update set
    posting_state = excluded.posting_state,
    journal_id = excluded.journal_id,
    posted_at = excluded.posted_at,
    posted_by = excluded.posted_by,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'journal_id', v_journal_id,
    'journal_no', v_journal_no
  );
exception
  when unique_violation then
    select
      p.journal_id,
      j.doc_no
      into v_journal_id,
      v_journal_no
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = p.company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.platform = 'amazon'
      and p.batch_id = p_batch_id
      and p.posting_state = 'posted'
    limit 1;

    if v_journal_id is not null then
      return jsonb_build_object(
        'batch_id', p_batch_id,
        'journal_id', v_journal_id,
        'journal_no', v_journal_no
      );
    end if;

    raise;
end;
$$;

revoke all on function public.erp_amazon_settlement_batch_post_to_finance(uuid, uuid) from public;
grant execute on function public.erp_amazon_settlement_batch_post_to_finance(uuid, uuid) to authenticated;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;

commit;
