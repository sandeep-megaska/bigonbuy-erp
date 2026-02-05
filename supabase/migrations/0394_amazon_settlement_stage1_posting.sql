begin;

alter table public.erp_marketplace_settlement_finance_posts
  add column if not exists posted_by_user_id uuid,
  add column if not exists error jsonb;

update public.erp_marketplace_settlement_finance_posts
set posted_by_user_id = coalesce(posted_by_user_id, posted_by)
where posted_by_user_id is null
  and posted_by is not null;

alter table public.erp_marketplace_settlement_finance_posts
  drop constraint if exists erp_marketplace_settlement_finance_posts_state_check;

alter table public.erp_marketplace_settlement_finance_posts
  add constraint erp_marketplace_settlement_finance_posts_state_check
  check (posting_state in ('posted', 'missing', 'excluded', 'error'));

create unique index if not exists erp_marketplace_settlement_finance_posts_company_platform_batch_uk
  on public.erp_marketplace_settlement_finance_posts (company_id, platform, batch_id);
-- Pre-drop to avoid 42P13 return type mismatch across iterations
drop function if exists public.erp_amazon_settlement_posting_summary(date, date);

drop function if exists public.erp_amazon_settlement_post_to_finance(uuid);
drop function if exists public.erp_amazon_settlement_batches_list_with_posting(date, date, text, integer, integer);
create or replace function public.erp__amazon_parse_amount(p_text text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_clean text;
begin
  if p_text is null then
    return 0;
  end if;

  v_clean := regexp_replace(p_text, '[^0-9\.-]', '', 'g');
  if v_clean is null or trim(v_clean) = '' or v_clean = '-' or v_clean = '.' then
    return 0;
  end if;

  return v_clean::numeric;
exception
  when others then
    return 0;
end;
$$;

create function public.erp_amazon_settlement_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_count int,
  posted_count int,
  missing_count int,
  excluded_count int,
  total_amount numeric,
  posted_amount numeric,
  missing_amount numeric,
  excluded_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with base as (
    select
      b.id as batch_id,
      coalesce(b.period_end, b.period_start, b.uploaded_at::date) as posting_date,
      coalesce((
        select sum(public.erp__amazon_parse_amount(t.raw ->> 'amount'))
        from public.erp_marketplace_settlement_txns t
        where t.company_id = v_company_id
          and t.batch_id = b.id
      ), 0) as net_amount
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and lower(ch.code) = 'amazon'
      and coalesce(b.period_end, b.period_start, b.uploaded_at::date) between p_from and p_to
  ), posts as (
    select p.batch_id, p.posting_state
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  )
  select
    count(*)::int as total_count,
    sum(case when coalesce(p.posting_state, 'missing') = 'posted' then 1 else 0 end)::int as posted_count,
    sum(case when coalesce(p.posting_state, 'missing') in ('missing', 'error') then 1 else 0 end)::int as missing_count,
    sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then 1 else 0 end)::int as excluded_count,
    coalesce(sum(b.net_amount), 0) as total_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'posted' then b.net_amount else 0 end), 0) as posted_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') in ('missing', 'error') then b.net_amount else 0 end), 0) as missing_amount,
    coalesce(sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then b.net_amount else 0 end), 0) as excluded_amount
  from base b
  left join posts p on p.batch_id = b.batch_id;
end;
$$;

create or replace function public.erp_amazon_settlement_journal_preview(
  p_batch_id uuid
) returns table (
  role text,
  account_id uuid,
  account_name text,
  debit numeric,
  credit numeric,
  warnings text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_batch record;
  v_sales_id uuid;
  v_sales_name text;
  v_refunds_id uuid;
  v_refunds_name text;
  v_fees_id uuid;
  v_fees_name text;
  v_adjust_id uuid;
  v_adjust_name text;
  v_clearing_id uuid;
  v_clearing_name text;
  v_sales_total numeric := 0;
  v_refunds_total numeric := 0;
  v_fees_total numeric := 0;
  v_adjust_total numeric := 0;
  v_header_total numeric := null;
  v_credit_total numeric := 0;
  v_debit_total numeric := 0;
  v_diff numeric := 0;
  v_warnings text[] := array[]::text[];
begin
  perform public.erp_require_finance_reader();

  select b.*
    into v_batch
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch
      on ch.id = b.channel_id
   where b.company_id = v_company_id
     and b.id = p_batch_id
     and lower(ch.code) = 'amazon'
   limit 1;

  if v_batch.id is null then
    return query select 'missing'::text, null::uuid, null::text, 0::numeric, 0::numeric, array['Settlement batch not found']::text[];
    return;
  end if;

  with rows as (
    select
      lower(coalesce(nullif(trim(t.raw ->> 'transaction-type'), ''), '')) as txn_type,
      lower(coalesce(t.raw ->> 'amount-type', '')) as amount_type,
      lower(coalesce(t.raw ->> 'amount-description', '')) as amount_desc,
      public.erp__amazon_parse_amount(coalesce(t.raw ->> 'amount', t.raw ->> 'total-amount')) as amount,
      public.erp__amazon_parse_amount(t.raw ->> 'total-amount') as total_amount,
      lower(coalesce(t.raw ->> 'settlement-id', t.raw ->> 'settlement_id', '')) as settlement_id
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id = p_batch_id
  )
  select
    coalesce(sum(case when amount_desc similar to '%(principal|itemprice|item-price|product)%' and txn_type not like '%refund%' then abs(amount) else 0 end), 0),
    coalesce(sum(case when txn_type like '%refund%' or amount_desc like '%refund%' then abs(amount) else 0 end), 0),
    coalesce(sum(case when amount_desc like '%fee%' or amount_type like '%fee%' then abs(amount) else 0 end), 0),
    coalesce(sum(case
      when (amount_desc similar to '%(principal|itemprice|item-price|product)%' and txn_type not like '%refund%')
        or txn_type like '%refund%'
        or amount_desc like '%refund%'
        or amount_desc like '%fee%'
        or amount_type like '%fee%'
      then 0
      else amount
    end), 0),
    max(case when (txn_type = '' or txn_type is null) and total_amount <> 0 then total_amount end)
  into v_sales_total, v_refunds_total, v_fees_total, v_adjust_total, v_header_total
  from rows;

  if v_header_total is null then
    v_warnings := array_append(v_warnings, 'Header total-amount missing; using component fallback totals');
  end if;

  select id, name into v_sales_id, v_sales_name
  from public.erp_gl_accounts
  where company_id = v_company_id
    and control_role = 'amazon_settlement_sales_account'
  limit 1;

  select id, name into v_refunds_id, v_refunds_name
  from public.erp_gl_accounts
  where company_id = v_company_id
    and control_role = 'amazon_settlement_refunds_account'
  limit 1;

  select id, name into v_fees_id, v_fees_name
  from public.erp_gl_accounts
  where company_id = v_company_id
    and control_role = 'amazon_settlement_fees_account'
  limit 1;

  select id, name into v_adjust_id, v_adjust_name
  from public.erp_gl_accounts
  where company_id = v_company_id
    and control_role = 'amazon_settlement_adjustments_account'
  limit 1;

  select id, name into v_clearing_id, v_clearing_name
  from public.erp_gl_accounts
  where company_id = v_company_id
    and control_role = 'amazon_settlement_clearing_account'
  limit 1;

  if v_sales_total > 0 and v_sales_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_sales_account');
  end if;
  if v_refunds_total > 0 and v_refunds_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_refunds_account');
  end if;
  if v_fees_total > 0 and v_fees_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_fees_account');
  end if;
  if abs(v_adjust_total) > 0 and v_adjust_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_adjustments_account');
  end if;
  if v_clearing_id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_clearing_account');
  end if;

  v_credit_total := coalesce(v_sales_total, 0) + greatest(v_adjust_total, 0);
  v_debit_total := coalesce(v_refunds_total, 0) + coalesce(v_fees_total, 0) + greatest(-v_adjust_total, 0);
  v_diff := round(v_credit_total - v_debit_total, 2);

  return query
  with lines as (
    select 'amazon_settlement_sales_account'::text as role_key, v_sales_id as account_id, v_sales_name as account_name, 0::numeric as debit, round(v_sales_total,2) as credit
    where round(v_sales_total,2) > 0
    union all
    select 'amazon_settlement_refunds_account', v_refunds_id, v_refunds_name, round(v_refunds_total,2), 0::numeric
    where round(v_refunds_total,2) > 0
    union all
    select 'amazon_settlement_fees_account', v_fees_id, v_fees_name, round(v_fees_total,2), 0::numeric
    where round(v_fees_total,2) > 0
    union all
    select 'amazon_settlement_adjustments_account', v_adjust_id, v_adjust_name, round(greatest(-v_adjust_total,0),2), round(greatest(v_adjust_total,0),2)
    where round(abs(v_adjust_total),2) > 0
    union all
    select 'amazon_settlement_clearing_account', v_clearing_id, v_clearing_name,
      case when v_diff > 0 then v_diff else 0 end,
      case when v_diff < 0 then abs(v_diff) else 0 end
    where round(abs(v_diff),2) > 0
  )
  select role_key, account_id, account_name, greatest(debit,0), greatest(credit,0), v_warnings
  from lines;
end;
$$;

create function public.erp_amazon_settlement_post_to_finance(
  p_batch_id uuid
) returns table (
  journal_id uuid,
  journal_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_batch record;
  v_existing_journal_id uuid;
  v_journal_id uuid;
  v_journal_no text;
  v_posting_date date;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_warnings text[] := array[]::text[];
  v_error jsonb;
begin
  perform public.erp_require_finance_writer();

  select b.*, ch.code as channel_code
    into v_batch
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch on ch.id = b.channel_id
    where b.company_id = v_company_id
      and b.id = p_batch_id
    for update;

  if v_batch.id is null or lower(coalesce(v_batch.channel_code, '')) <> 'amazon' then
    raise exception 'Amazon settlement batch not found';
  end if;

  select p.journal_id
    into v_existing_journal_id
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id
      and p.platform = 'amazon'
      and p.batch_id = p_batch_id
      and p.posting_state = 'posted'
    limit 1;

  if v_existing_journal_id is not null then
    return query
    select j.id, j.doc_no
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.id = v_existing_journal_id;
    return;
  end if;

  v_posting_date := coalesce(v_batch.period_end, v_batch.period_start, current_date);
  perform public.erp_require_fin_open_period(v_company_id, v_posting_date);

  with preview as (
    select * from public.erp_amazon_settlement_journal_preview(p_batch_id)
  )
  select
    coalesce(sum(p.debit), 0),
    coalesce(sum(p.credit), 0),
    coalesce((array_agg(p.warnings))[1], array[]::text[])
  into v_total_debit, v_total_credit, v_warnings
  from preview p;

  if exists (
    select 1 from public.erp_amazon_settlement_journal_preview(p_batch_id) p
    where p.account_id is null
  ) then
    v_warnings := array_append(v_warnings, 'Cannot post: one or more accounts are not mapped');
  end if;

  if round(v_total_debit,2) <= 0 or round(v_total_credit,2) <= 0 then
    v_warnings := array_append(v_warnings, 'Cannot post: no valid journal lines');
  end if;

  if round(v_total_debit,2) <> round(v_total_credit,2) then
    v_warnings := array_append(v_warnings, 'Cannot post: journal is not balanced');
  end if;

  if array_length(v_warnings, 1) is not null then
    v_error := jsonb_build_object('warnings', v_warnings);
    insert into public.erp_marketplace_settlement_finance_posts (
      company_id, platform, batch_id, posting_state, error, updated_at
    ) values (
      v_company_id, 'amazon', p_batch_id, 'missing', v_error, now()
    )
    on conflict (company_id, platform, batch_id)
    do update set posting_state = excluded.posting_state, error = excluded.error, updated_at = now();

    raise exception '%', array_to_string(v_warnings, '; ');
  end if;

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
    v_posting_date,
    'posted',
    format('Amazon settlement %s', coalesce(v_batch.batch_ref, p_batch_id::text)),
    'amazon_settlement_batch',
    p_batch_id,
    round(v_total_debit,2),
    round(v_total_credit,2),
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
  )
  select
    v_company_id,
    v_journal_id,
    row_number() over (order by p.role) as line_no,
    a.code,
    a.name,
    p.role,
    round(p.debit,2),
    round(p.credit,2)
  from public.erp_amazon_settlement_journal_preview(p_batch_id) p
  join public.erp_gl_accounts a
    on a.company_id = v_company_id
   and a.id = p.account_id;

  v_journal_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_journal_no
  where company_id = v_company_id
    and id = v_journal_id;

  insert into public.erp_marketplace_settlement_finance_posts (
    company_id,
    platform,
    batch_id,
    posting_state,
    journal_id,
    posted_at,
    posted_by_user_id,
    error,
    updated_at
  ) values (
    v_company_id,
    'amazon',
    p_batch_id,
    'posted',
    v_journal_id,
    now(),
    v_actor,
    null,
    now()
  )
  on conflict (company_id, platform, batch_id)
  do update set
    posting_state = excluded.posting_state,
    journal_id = excluded.journal_id,
    posted_at = excluded.posted_at,
    posted_by_user_id = excluded.posted_by_user_id,
    error = null,
    updated_at = now();

  return query select v_journal_id, v_journal_no;
exception
  when others then
    insert into public.erp_marketplace_settlement_finance_posts (
      company_id,
      platform,
      batch_id,
      posting_state,
      error,
      updated_at
    ) values (
      v_company_id,
      'amazon',
      p_batch_id,
      'error',
      jsonb_build_object('message', sqlerrm),
      now()
    )
    on conflict (company_id, platform, batch_id)
    do update set posting_state = 'error', error = excluded.error, updated_at = now();
    raise;
end;
$$;

revoke all on function public.erp_amazon_settlement_journal_preview(uuid) from public;
grant execute on function public.erp_amazon_settlement_journal_preview(uuid) to authenticated;

revoke all on function public.erp_amazon_settlement_post_to_finance(uuid) from public;
grant execute on function public.erp_amazon_settlement_post_to_finance(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
