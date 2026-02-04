-- 0390_amazon_settlement_posting.sql
-- Amazon settlement posting coverage + finance posting bridge

begin;

-- -------------------------------------------------------------------
-- 1) Bridge table: erp_marketplace_settlement_finance_posts
-- -------------------------------------------------------------------

create table if not exists public.erp_marketplace_settlement_finance_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id()
    references public.erp_companies (id) on delete cascade,
  platform text not null,
  batch_id uuid not null references public.erp_marketplace_settlement_batches (id) on delete cascade,
  posting_state text not null default 'missing',
  journal_id uuid null references public.erp_fin_journals (id),
  posted_at timestamptz null,
  posted_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid null default auth.uid(),
  constraint erp_marketplace_settlement_finance_posts_state_check
    check (posting_state in ('posted', 'missing', 'excluded')),
  constraint erp_marketplace_settlement_finance_posts_unique
    unique (company_id, platform, batch_id)
);

create index if not exists erp_marketplace_settlement_finance_posts_company_state_idx
  on public.erp_marketplace_settlement_finance_posts (company_id, platform, posting_state);

alter table public.erp_marketplace_settlement_finance_posts enable row level security;
alter table public.erp_marketplace_settlement_finance_posts force row level security;

do $$
begin
  drop policy if exists erp_marketplace_settlement_finance_posts_select on public.erp_marketplace_settlement_finance_posts;
  drop policy if exists erp_marketplace_settlement_finance_posts_write on public.erp_marketplace_settlement_finance_posts;

  create policy erp_marketplace_settlement_finance_posts_select
    on public.erp_marketplace_settlement_finance_posts
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

  create policy erp_marketplace_settlement_finance_posts_write
    on public.erp_marketplace_settlement_finance_posts
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

-- -------------------------------------------------------------------
-- 2) Extend COA control roles for Amazon settlement posting
-- -------------------------------------------------------------------

create or replace function public.erp_fin_coa_control_roles_list()
returns table(
  role_key text,
  account_id uuid,
  account_code text,
  account_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  return query
  with roles(role_key) as (
    values
      ('bank_main'),
      ('vendor_payable'),
      ('vendor_advance'),
      ('tds_payable'),
      ('input_gst_cgst'),
      ('input_gst_sgst'),
      ('input_gst_igst'),
      ('inventory_asset'),
      ('gateway_clearing'),
      ('gst_payable'),
      ('sales_revenue'),
      ('cogs_inventory'),
      ('operating_expense'),
      ('other_income'),
      ('interest_income'),
      ('depreciation_expense'),
      ('fixed_asset'),
      ('loan_payable'),
      ('equity_capital'),
      ('amazon_settlement_clearing_account'),
      ('amazon_settlement_sales_account'),
      ('amazon_settlement_fees_account'),
      ('amazon_settlement_refunds_account'),
      ('amazon_settlement_tcs_account'),
      ('amazon_settlement_tds_account'),
      ('amazon_settlement_adjustments_account')
  )
  select
    r.role_key,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name
  from roles r
  left join public.erp_gl_accounts a
    on a.company_id = public.erp_current_company_id()
    and a.control_role = r.role_key
  order by r.role_key;
end;
$$;

revoke all on function public.erp_fin_coa_control_roles_list() from public;
grant execute on function public.erp_fin_coa_control_roles_list() to authenticated;

create or replace function public.erp_fin_coa_control_role_set(
  p_role text,
  p_account_id uuid,
  p_is_control boolean default true
) returns public.erp_gl_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := nullif(trim(lower(p_role)), '');
  v_company_id uuid := public.erp_current_company_id();
  v_row public.erp_gl_accounts;
  v_allowed boolean := false;
  v_account_exists boolean := false;
begin
  perform public.erp_require_finance_writer();

  if v_role is null then
    raise exception 'control role is required';
  end if;

  v_allowed := v_role = any (array[
    'bank_main',
    'vendor_payable',
    'vendor_advance',
    'tds_payable',
    'input_gst_cgst',
    'input_gst_sgst',
    'input_gst_igst',
    'inventory_asset',
    'gateway_clearing',
    'gst_payable',
    'sales_revenue',
    'cogs_inventory',
    'operating_expense',
    'other_income',
    'interest_income',
    'depreciation_expense',
    'fixed_asset',
    'loan_payable',
    'equity_capital',
    'amazon_settlement_clearing_account',
    'amazon_settlement_sales_account',
    'amazon_settlement_fees_account',
    'amazon_settlement_refunds_account',
    'amazon_settlement_tcs_account',
    'amazon_settlement_tds_account',
    'amazon_settlement_adjustments_account'
  ]);

  if not v_allowed then
    raise exception 'unsupported control role: %', v_role;
  end if;

  if p_account_id is null then
    raise exception 'account_id is required for role %', v_role;
  end if;

  select true
    into v_account_exists
    from public.erp_gl_accounts a
   where a.company_id = v_company_id
     and a.id = p_account_id;

  if not v_account_exists then
    raise exception 'account not found for role %', v_role;
  end if;

  update public.erp_gl_accounts
     set control_role = null,
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and control_role = v_role
     and id <> p_account_id;

  update public.erp_gl_accounts
     set control_role = v_role,
         is_control_account = coalesce(p_is_control, true),
         updated_at = now(),
         updated_by_user_id = auth.uid()
   where company_id = v_company_id
     and id = p_account_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.erp_fin_coa_control_role_set(text, uuid, boolean) from public;
grant execute on function public.erp_fin_coa_control_role_set(text, uuid, boolean) to authenticated;

-- -------------------------------------------------------------------
-- 3) RPC: list Amazon settlement batches with posting state
-- -------------------------------------------------------------------

create or replace function public.erp_amazon_settlement_batches_list_with_posting(
  p_from date,
  p_to date,
  p_status text default 'all',
  p_limit int default 50,
  p_offset int default 0
) returns table (
  batch_id uuid,
  batch_ref text,
  settlement_start_date date,
  settlement_end_date date,
  deposit_date date,
  currency text,
  net_payout numeric,
  posting_state text,
  journal_id uuid,
  journal_no text,
  has_txns boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = v_company_id
      and lower(code) = 'amazon'
    limit 1
  ),
  base as (
    select
      b.id,
      b.batch_ref,
      b.period_start,
      b.period_end,
      b.currency,
      b.created_at
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(sum(coalesce(t.net_payout, 0)), 0) as net_payout,
      count(*) as txn_count
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select id from base)
    group by t.batch_id
  ),
  posts as (
    select
      p.batch_id,
      p.posting_state,
      p.journal_id,
      j.doc_no as journal_no
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  )
  select
    b.id as batch_id,
    b.batch_ref,
    b.period_start as settlement_start_date,
    b.period_end as settlement_end_date,
    null::date as deposit_date,
    b.currency,
    coalesce(t.net_payout, 0) as net_payout,
    coalesce(p.posting_state, 'missing') as posting_state,
    p.journal_id,
    p.journal_no,
    coalesce(t.txn_count, 0) > 0 as has_txns
  from base b
  left join totals t
    on t.batch_id = b.id
  left join posts p
    on p.batch_id = b.id
  where
    v_status = 'all'
    or coalesce(p.posting_state, 'missing') = v_status
  order by coalesce(b.period_end, b.period_start) desc, b.created_at desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.erp_amazon_settlement_batches_list_with_posting(date, date, text, int, int) from public;
grant execute on function public.erp_amazon_settlement_batches_list_with_posting(date, date, text, int, int) to authenticated;

-- -------------------------------------------------------------------
-- 4) RPC: posting summary for Amazon settlement batches
-- -------------------------------------------------------------------

create or replace function public.erp_amazon_settlement_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_batches int,
  posted int,
  missing int,
  excluded int,
  total_net_payout numeric
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
  with channel as (
    select id
    from public.erp_sales_channels
    where company_id = v_company_id
      and lower(code) = 'amazon'
    limit 1
  ),
  base as (
    select
      b.id
    from public.erp_marketplace_settlement_batches b
    join channel ch
      on ch.id = b.channel_id
    where b.company_id = v_company_id
      and coalesce(b.period_end, b.period_start) between p_from and p_to
  ),
  totals as (
    select
      t.batch_id,
      coalesce(sum(coalesce(t.net_payout, 0)), 0) as net_payout
    from public.erp_marketplace_settlement_txns t
    where t.company_id = v_company_id
      and t.batch_id in (select id from base)
    group by t.batch_id
  ),
  posts as (
    select
      p.batch_id,
      p.posting_state
    from public.erp_marketplace_settlement_finance_posts p
    where p.company_id = v_company_id
      and p.platform = 'amazon'
  )
  select
    count(*)::int as total_batches,
    sum(case when coalesce(p.posting_state, 'missing') = 'posted' then 1 else 0 end)::int as posted,
    sum(case when coalesce(p.posting_state, 'missing') = 'missing' then 1 else 0 end)::int as missing,
    sum(case when coalesce(p.posting_state, 'missing') = 'excluded' then 1 else 0 end)::int as excluded,
    coalesce(sum(t.net_payout), 0) as total_net_payout
  from base b
  left join totals t
    on t.batch_id = b.id
  left join posts p
    on p.batch_id = b.id;
end;
$$;

revoke all on function public.erp_amazon_settlement_posting_summary(date, date) from public;
grant execute on function public.erp_amazon_settlement_posting_summary(date, date) to authenticated;

-- -------------------------------------------------------------------
-- 5) RPC: posting preview (journal lines) for a batch
-- -------------------------------------------------------------------

create or replace function public.erp_amazon_settlement_posting_preview(
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_batch record;
  v_totals record;
  v_net_payout numeric(14,2) := 0;
  v_sales_total numeric(14,2) := 0;
  v_fees_total numeric(14,2) := 0;
  v_refunds_total numeric(14,2) := 0;
  v_tcs_total numeric(14,2) := 0;
  v_tds_total numeric(14,2) := 0;
  v_adjustments_total numeric(14,2) := 0;
  v_warnings text[] := '{}'::text[];
  v_lines jsonb := '[]'::jsonb;
  v_can_post boolean := false;
  v_post record;
  v_clearing record;
  v_sales record;
  v_fees record;
  v_refunds record;
  v_tcs record;
  v_tds record;
  v_adjustments record;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
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
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'lines', '[]'::jsonb,
      'warnings', jsonb_build_array('Settlement batch not found'),
      'can_post', false
    );
  end if;

  select
    coalesce(sum(coalesce(t.gross_sales, 0)), 0) as sales_total,
    coalesce(
      sum(
        coalesce(
          t.total_fees,
          coalesce(t.shipping_fee, 0) + coalesce(t.commission_fee, 0) + coalesce(t.fixed_fee, 0) + coalesce(t.closing_fee, 0)
        )
      ),
      0
    ) as fees_total,
    coalesce(sum(coalesce(t.refund_amount, 0)), 0) as refunds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tcs_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tds%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%'
            or lower(coalesce(t.settlement_type, '')) like '%tds%'
          then 0
          else coalesce(t.other_charges, 0)
        end
      ),
      0
    ) as adjustments_total,
    coalesce(sum(coalesce(t.net_payout, 0)), 0) as net_payout_total,
    count(*) as txn_count
    into v_totals
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  v_sales_total := round(coalesce(v_totals.sales_total, 0), 2);
  v_fees_total := round(coalesce(v_totals.fees_total, 0), 2);
  v_refunds_total := round(coalesce(v_totals.refunds_total, 0), 2);
  v_tcs_total := round(coalesce(v_totals.tcs_total, 0), 2);
  v_tds_total := round(coalesce(v_totals.tds_total, 0), 2);
  v_adjustments_total := round(coalesce(v_totals.adjustments_total, 0), 2);
  v_net_payout := round(coalesce(v_totals.net_payout_total, 0), 2);

  if coalesce(v_totals.txn_count, 0) = 0 then
    v_warnings := array_append(v_warnings, 'No settlement transactions found');
  end if;

  if v_net_payout = 0 and (v_sales_total + v_fees_total + v_refunds_total + v_tcs_total + v_tds_total + v_adjustments_total) <> 0 then
    v_net_payout := round(v_sales_total - v_fees_total - v_refunds_total - v_tcs_total - v_tds_total - v_adjustments_total, 2);
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_clearing_account';

  select id, code, name into v_sales
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_sales_account';

  select id, code, name into v_fees
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_fees_account';

  select id, code, name into v_refunds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_refunds_account';

  select id, code, name into v_tcs
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tcs_account';

  select id, code, name into v_tds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tds_account';

  select id, code, name into v_adjustments
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_adjustments_account';

  if v_net_payout <= 0 then
    v_warnings := array_append(v_warnings, 'Net payout total is not positive');
  end if;

  if v_net_payout > 0 and v_clearing.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_clearing_account');
  end if;

  if v_sales_total > 0 and v_sales.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_sales_account');
  end if;

  if v_fees_total > 0 and v_fees.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_fees_account');
  end if;

  if v_refunds_total > 0 and v_refunds.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_refunds_account');
  end if;

  if v_tcs_total > 0 and v_tcs.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_tcs_account');
  end if;

  if v_tds_total > 0 and v_tds.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_tds_account');
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is null then
    v_warnings := array_append(v_warnings, 'Missing COA mapping: amazon_settlement_adjustments_account');
  end if;

  if v_net_payout > 0 and v_clearing.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_clearing_account',
        'account_id', v_clearing.id,
        'account_code', v_clearing.code,
        'account_name', v_clearing.name,
        'dr', v_net_payout,
        'cr', 0,
        'label', 'Amazon settlement clearing'
      )
    );
    v_total_debit := v_total_debit + v_net_payout;
  end if;

  if v_sales_total > 0 and v_sales.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_sales_account',
        'account_id', v_sales.id,
        'account_code', v_sales.code,
        'account_name', v_sales.name,
        'dr', 0,
        'cr', v_sales_total,
        'label', 'Amazon settlement sales'
      )
    );
    v_total_credit := v_total_credit + v_sales_total;
  end if;

  if v_fees_total > 0 and v_fees.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_fees_account',
        'account_id', v_fees.id,
        'account_code', v_fees.code,
        'account_name', v_fees.name,
        'dr', v_fees_total,
        'cr', 0,
        'label', 'Amazon settlement fees'
      )
    );
    v_total_debit := v_total_debit + v_fees_total;
  end if;

  if v_refunds_total > 0 and v_refunds.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_refunds_account',
        'account_id', v_refunds.id,
        'account_code', v_refunds.code,
        'account_name', v_refunds.name,
        'dr', v_refunds_total,
        'cr', 0,
        'label', 'Amazon settlement refunds'
      )
    );
    v_total_debit := v_total_debit + v_refunds_total;
  end if;

  if v_tcs_total > 0 and v_tcs.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_tcs_account',
        'account_id', v_tcs.id,
        'account_code', v_tcs.code,
        'account_name', v_tcs.name,
        'dr', v_tcs_total,
        'cr', 0,
        'label', 'Amazon settlement TCS'
      )
    );
    v_total_debit := v_total_debit + v_tcs_total;
  end if;

  if v_tds_total > 0 and v_tds.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_tds_account',
        'account_id', v_tds.id,
        'account_code', v_tds.code,
        'account_name', v_tds.name,
        'dr', v_tds_total,
        'cr', 0,
        'label', 'Amazon settlement TDS'
      )
    );
    v_total_debit := v_total_debit + v_tds_total;
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is not null then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'role_key', 'amazon_settlement_adjustments_account',
        'account_id', v_adjustments.id,
        'account_code', v_adjustments.code,
        'account_name', v_adjustments.name,
        'dr', v_adjustments_total,
        'cr', 0,
        'label', 'Amazon settlement adjustments'
      )
    );
    v_total_debit := v_total_debit + v_adjustments_total;
  end if;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    v_warnings := array_append(v_warnings, 'Journal out of balance');
  end if;

  if array_length(v_warnings, 1) is null then
    v_can_post := true;
  end if;

  select p.journal_id, j.doc_no
    into v_post
    from public.erp_marketplace_settlement_finance_posts p
    left join public.erp_fin_journals j
      on j.company_id = v_company_id
     and j.id = p.journal_id
    where p.company_id = v_company_id
      and p.platform = 'amazon'
      and p.batch_id = v_batch.id
      and p.posting_state = 'posted'
    limit 1;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_ref', v_batch.batch_ref,
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end,
    'currency', v_batch.currency,
    'totals', jsonb_build_object(
      'net_payout', v_net_payout,
      'sales', v_sales_total,
      'fees', v_fees_total,
      'refunds', v_refunds_total,
      'tcs', v_tcs_total,
      'tds', v_tds_total,
      'adjustments', v_adjustments_total,
      'total_debit', v_total_debit,
      'total_credit', v_total_credit
    ),
    'lines', v_lines,
    'warnings', to_jsonb(v_warnings),
    'can_post', v_can_post,
    'posted', jsonb_build_object(
      'journal_id', v_post.journal_id,
      'journal_no', v_post.doc_no
    )
  );
end;
$$;

revoke all on function public.erp_amazon_settlement_posting_preview(uuid) from public;
grant execute on function public.erp_amazon_settlement_posting_preview(uuid) to authenticated;

-- -------------------------------------------------------------------
-- 6) RPC: post settlement batch to finance (idempotent)
-- -------------------------------------------------------------------

create or replace function public.erp_amazon_settlement_post_to_finance(
  p_batch_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_batch record;
  v_existing uuid;
  v_post record;
  v_post_date date;
  v_journal_id uuid;
  v_doc_no text;
  v_line_no int := 1;
  v_sales_total numeric(14,2) := 0;
  v_fees_total numeric(14,2) := 0;
  v_refunds_total numeric(14,2) := 0;
  v_tcs_total numeric(14,2) := 0;
  v_tds_total numeric(14,2) := 0;
  v_adjustments_total numeric(14,2) := 0;
  v_net_payout numeric(14,2) := 0;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_clearing record;
  v_sales record;
  v_fees record;
  v_refunds record;
  v_tcs record;
  v_tds record;
  v_adjustments record;
  v_totals record;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  select b.*
    into v_batch
    from public.erp_marketplace_settlement_batches b
    join public.erp_sales_channels ch
      on ch.id = b.channel_id
   where b.company_id = v_company_id
     and b.id = p_batch_id
     and lower(ch.code) = 'amazon'
   for update;

  if v_batch.id is null then
    raise exception 'Settlement batch not found';
  end if;

  select posting_state, journal_id
    into v_post
    from public.erp_marketplace_settlement_finance_posts p
   where p.company_id = v_company_id
     and p.platform = 'amazon'
     and p.batch_id = p_batch_id
   for update;

  if v_post.journal_id is not null and v_post.posting_state = 'posted' then
    return v_post.journal_id;
  end if;

  if v_post.posting_state = 'excluded' then
    raise exception 'Settlement batch is excluded from posting';
  end if;

  select j.id
    into v_existing
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.reference_type = 'amazon_settlement_batch'
      and j.reference_id = p_batch_id
    order by j.created_at desc nulls last
    limit 1;

  if v_existing is not null then
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
      v_existing,
      now(),
      v_actor,
      now(),
      v_actor
    )
    on conflict (company_id, platform, batch_id)
    do update set
      posting_state = excluded.posting_state,
      journal_id = excluded.journal_id,
      posted_at = excluded.posted_at,
      posted_by = excluded.posted_by,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

    return v_existing;
  end if;

  select
    coalesce(sum(coalesce(t.gross_sales, 0)), 0) as sales_total,
    coalesce(
      sum(
        coalesce(
          t.total_fees,
          coalesce(t.shipping_fee, 0) + coalesce(t.commission_fee, 0) + coalesce(t.fixed_fee, 0) + coalesce(t.closing_fee, 0)
        )
      ),
      0
    ) as fees_total,
    coalesce(sum(coalesce(t.refund_amount, 0)), 0) as refunds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tcs_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tds%' then coalesce(t.other_charges, 0)
          else 0
        end
      ),
      0
    ) as tds_total,
    coalesce(
      sum(
        case
          when lower(coalesce(t.settlement_type, '')) like '%tcs%'
            or lower(coalesce(t.settlement_type, '')) like '%tds%'
          then 0
          else coalesce(t.other_charges, 0)
        end
      ),
      0
    ) as adjustments_total,
    coalesce(sum(coalesce(t.net_payout, 0)), 0) as net_payout_total,
    count(*) as txn_count
    into v_totals
  from public.erp_marketplace_settlement_txns t
  where t.company_id = v_company_id
    and t.batch_id = p_batch_id;

  v_sales_total := round(coalesce(v_totals.sales_total, 0), 2);
  v_fees_total := round(coalesce(v_totals.fees_total, 0), 2);
  v_refunds_total := round(coalesce(v_totals.refunds_total, 0), 2);
  v_tcs_total := round(coalesce(v_totals.tcs_total, 0), 2);
  v_tds_total := round(coalesce(v_totals.tds_total, 0), 2);
  v_adjustments_total := round(coalesce(v_totals.adjustments_total, 0), 2);
  v_net_payout := round(coalesce(v_totals.net_payout_total, 0), 2);

  if coalesce(v_totals.txn_count, 0) = 0 then
    raise exception 'No settlement transactions found';
  end if;

  if v_net_payout = 0 and (v_sales_total + v_fees_total + v_refunds_total + v_tcs_total + v_tds_total + v_adjustments_total) <> 0 then
    v_net_payout := round(v_sales_total - v_fees_total - v_refunds_total - v_tcs_total - v_tds_total - v_adjustments_total, 2);
  end if;

  if v_net_payout <= 0 then
    raise exception 'Net payout total is not positive';
  end if;

  select id, code, name into v_clearing
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_clearing_account';

  select id, code, name into v_sales
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_sales_account';

  select id, code, name into v_fees
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_fees_account';

  select id, code, name into v_refunds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_refunds_account';

  select id, code, name into v_tcs
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tcs_account';

  select id, code, name into v_tds
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_tds_account';

  select id, code, name into v_adjustments
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.control_role = 'amazon_settlement_adjustments_account';

  if v_clearing.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_clearing_account';
  end if;

  if v_sales_total > 0 and v_sales.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_sales_account';
  end if;

  if v_fees_total > 0 and v_fees.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_fees_account';
  end if;

  if v_refunds_total > 0 and v_refunds.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_refunds_account';
  end if;

  if v_tcs_total > 0 and v_tcs.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_tcs_account';
  end if;

  if v_tds_total > 0 and v_tds.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_tds_account';
  end if;

  if v_adjustments_total > 0 and v_adjustments.id is null then
    raise exception 'COA control role not mapped: amazon_settlement_adjustments_account';
  end if;

  v_total_debit := v_net_payout + v_fees_total + v_refunds_total + v_tcs_total + v_tds_total + v_adjustments_total;
  v_total_credit := v_sales_total;

  if abs(v_total_debit - v_total_credit) > 0.01 then
    raise exception 'Journal out of balance';
  end if;

  v_post_date := coalesce(v_batch.period_end, v_batch.period_start, current_date);
  perform public.erp_require_fin_open_period(v_company_id, v_post_date);

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
    v_post_date,
    'posted',
    format('Amazon settlement %s', coalesce(v_batch.batch_ref, v_batch.id::text)),
    'amazon_settlement_batch',
    v_batch.id,
    v_total_debit,
    v_total_credit,
    v_actor
  ) returning id into v_journal_id;

  if v_net_payout > 0 then
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
      v_clearing.code,
      v_clearing.name,
      'Amazon settlement clearing',
      v_net_payout,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_sales_total > 0 then
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
      v_sales.code,
      v_sales.name,
      'Amazon settlement sales',
      0,
      v_sales_total
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_fees_total > 0 then
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
      v_fees.code,
      v_fees.name,
      'Amazon settlement fees',
      v_fees_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_refunds_total > 0 then
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
      v_refunds.code,
      v_refunds.name,
      'Amazon settlement refunds',
      v_refunds_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_tcs_total > 0 then
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
      v_tcs.code,
      v_tcs.name,
      'Amazon settlement TCS',
      v_tcs_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_tds_total > 0 then
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
      v_tds.code,
      v_tds.name,
      'Amazon settlement TDS',
      v_tds_total,
      0
    );
    v_line_no := v_line_no + 1;
  end if;

  if v_adjustments_total > 0 then
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
      v_adjustments.code,
      v_adjustments.name,
      'Amazon settlement adjustments',
      v_adjustments_total,
      0
    );
  end if;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

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
    v_actor,
    now(),
    v_actor
  )
  on conflict (company_id, platform, batch_id)
  do update set
    posting_state = excluded.posting_state,
    journal_id = excluded.journal_id,
    posted_at = excluded.posted_at,
    posted_by = excluded.posted_by,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return v_journal_id;
exception
  when unique_violation then
    select p.journal_id
      into v_existing
      from public.erp_marketplace_settlement_finance_posts p
      where p.company_id = v_company_id
        and p.platform = 'amazon'
        and p.batch_id = p_batch_id
        and p.posting_state = 'posted'
      limit 1;

    if v_existing is not null then
      return v_existing;
    end if;

    raise;
end;
$$;

revoke all on function public.erp_amazon_settlement_post_to_finance(uuid) from public;
grant execute on function public.erp_amazon_settlement_post_to_finance(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
