-- 0356_fin_maker_checker.sql
-- Phase F3-C/F3-B hardening: maker-checker approvals + period summary + report defaults

create table if not exists public.erp_fin_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.erp_companies (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  state text not null default 'draft',
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  review_comment text null,
  constraint erp_fin_approvals_entity_unique unique (company_id, entity_type, entity_id),
  constraint erp_fin_approvals_state_check check (state in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  constraint erp_fin_approvals_entity_type_check check (entity_type in (
    'ap_bill',
    'ap_payment',
    'ap_advance',
    'journal',
    'month_close',
    'period_unlock'
  ))
);

create index if not exists erp_fin_approvals_company_state_idx
  on public.erp_fin_approvals (company_id, state, entity_type);

alter table public.erp_fin_approvals enable row level security;
alter table public.erp_fin_approvals force row level security;

do $$
begin
  drop policy if exists erp_fin_approvals_select on public.erp_fin_approvals;
  drop policy if exists erp_fin_approvals_insert on public.erp_fin_approvals;
  drop policy if exists erp_fin_approvals_update on public.erp_fin_approvals;

  create policy erp_fin_approvals_select
    on public.erp_fin_approvals
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

  create policy erp_fin_approvals_insert
    on public.erp_fin_approvals
    for insert
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

  create policy erp_fin_approvals_update
    on public.erp_fin_approvals
    for update
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
        or (
          state in ('draft', 'submitted', 'cancelled')
          and exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin', 'finance')
          )
        )
        or (
          state in ('approved', 'rejected')
          and exists (
            select 1
            from public.erp_company_users cu
            where cu.company_id = public.erp_current_company_id()
              and cu.user_id = auth.uid()
              and coalesce(cu.is_active, true)
              and cu.role_key in ('owner', 'admin', 'finance')
          )
        )
      )
    );
end $$;

create or replace view public.erp_fin_pending_approvals_v as
select
  a.id,
  a.company_id,
  a.entity_type,
  a.entity_id,
  a.state,
  a.requested_by,
  a.requested_at,
  a.reviewed_by,
  a.reviewed_at,
  a.review_comment
from public.erp_fin_approvals a
where a.state = 'submitted';

create or replace function public.erp_fin_submit_for_approval(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_note text default null
) returns public.erp_fin_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.erp_fin_approvals;
  v_row public.erp_fin_approvals;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  select *
    into v_existing
    from public.erp_fin_approvals a
    where a.company_id = p_company_id
      and a.entity_type = p_entity_type
      and a.entity_id = p_entity_id
    for update;

  if v_existing.id is not null and v_existing.state = 'approved' then
    return v_existing;
  end if;

  insert into public.erp_fin_approvals (
    company_id,
    entity_type,
    entity_id,
    state,
    requested_by,
    requested_at,
    reviewed_by,
    reviewed_at,
    review_comment
  ) values (
    p_company_id,
    p_entity_type,
    p_entity_id,
    'submitted',
    v_actor,
    now(),
    null,
    null,
    p_note
  )
  on conflict (company_id, entity_type, entity_id)
  do update set
    state = 'submitted',
    requested_by = v_actor,
    requested_at = now(),
    reviewed_by = null,
    reviewed_at = null,
    review_comment = p_note
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.erp_fin_reject(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_comment text default null
) returns public.erp_fin_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.erp_fin_approvals;
  v_is_approver boolean := false;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance')
  ) into v_is_approver;

  if not v_is_approver then
    raise exception 'Not authorized to reject approvals';
  end if;

  update public.erp_fin_approvals
     set state = 'rejected',
         reviewed_by = v_actor,
         reviewed_at = now(),
         review_comment = p_comment
   where company_id = p_company_id
     and entity_type = p_entity_type
     and entity_id = p_entity_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Approval record not found';
  end if;

  return v_row;
end;
$$;

create or replace function public.erp_fin_approve(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.erp_fin_approvals;
  v_is_approver boolean := false;
  v_result jsonb := null;
  v_month_close record;
  v_lock record;
begin
  perform public.erp_require_finance_writer();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  select exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance')
  ) into v_is_approver;

  if not v_is_approver then
    raise exception 'Not authorized to approve';
  end if;

  select *
    into v_row
    from public.erp_fin_approvals a
    where a.company_id = p_company_id
      and a.entity_type = p_entity_type
      and a.entity_id = p_entity_id
    for update;

  if v_row.id is null then
    raise exception 'Approval record not found';
  end if;

  if v_row.state = 'approved' then
    return jsonb_build_object(
      'approval_id', v_row.id,
      'state', v_row.state
    );
  end if;

  if v_row.state not in ('submitted', 'draft') then
    raise exception 'Only submitted approvals can be approved';
  end if;

  case p_entity_type
    when 'ap_bill' then
      v_result := public.erp_ap_vendor_bill_post(p_entity_id, false);
    when 'ap_payment' then
      v_result := public.erp_ap_vendor_payment_approve(p_entity_id, false);
    when 'ap_advance' then
      v_result := public.erp_ap_vendor_advance_approve_and_post(p_entity_id, false);
    when 'month_close' then
      select *
        into v_month_close
        from public.erp_fin_month_close mc
        where mc.company_id = p_company_id
          and mc.id = p_entity_id;
      if v_month_close.id is null then
        raise exception 'Month close record not found';
      end if;
      v_result := jsonb_build_object(
        'month_close_id', public.erp_fin_month_close_finalize(
          p_company_id,
          v_month_close.fiscal_year,
          v_month_close.period_month,
          false
        )
      );
    when 'period_unlock' then
      select *
        into v_lock
        from public.erp_fin_period_locks l
        where l.company_id = p_company_id
          and l.id = p_entity_id;
      if v_lock.id is null then
        raise exception 'Period lock record not found';
      end if;
      v_result := jsonb_build_object(
        'period_lock_id', public.erp_fin_period_unlock(
          p_company_id,
          v_lock.fiscal_year,
          v_lock.period_month,
          p_comment,
          false
        )
      );
    else
      raise exception 'Unsupported approval entity_type: %', p_entity_type;
  end case;

  update public.erp_fin_approvals
     set state = 'approved',
         reviewed_by = v_actor,
         reviewed_at = now(),
         review_comment = p_comment
   where id = v_row.id;

  return jsonb_build_object(
    'approval_id', v_row.id,
    'state', 'approved',
    'result', v_result
  );
end;
$$;

create or replace function public.erp_fin_approvals_list(
  p_company_id uuid,
  p_state text default null,
  p_entity_type text default null
) returns table(
  id uuid,
  company_id uuid,
  entity_type text,
  entity_id uuid,
  state text,
  requested_by uuid,
  requested_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_comment text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  return query
  select
    a.id,
    a.company_id,
    a.entity_type,
    a.entity_id,
    a.state,
    a.requested_by,
    a.requested_at,
    a.reviewed_by,
    a.reviewed_at,
    a.review_comment
  from public.erp_fin_approvals a
  where a.company_id = p_company_id
    and (p_state is null or a.state = p_state)
    and (p_entity_type is null or a.entity_type = p_entity_type)
  order by a.requested_at desc;
end;
$$;

revoke all on function public.erp_fin_submit_for_approval(uuid, text, uuid, text) from public;
revoke all on function public.erp_fin_reject(uuid, text, uuid, text) from public;
revoke all on function public.erp_fin_approve(uuid, text, uuid, text) from public;
revoke all on function public.erp_fin_approvals_list(uuid, text, text) from public;

grant execute on function public.erp_fin_submit_for_approval(uuid, text, uuid, text) to authenticated;
grant execute on function public.erp_fin_reject(uuid, text, uuid, text) to authenticated;
grant execute on function public.erp_fin_approve(uuid, text, uuid, text) to authenticated;
grant execute on function public.erp_fin_approvals_list(uuid, text, text) to authenticated;

create or replace function public.erp_fin_period_lock_summary(
  p_company_id uuid
) returns table(
  last_locked_fiscal_year text,
  last_locked_period_month int,
  open_months int[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_fy text := public.erp_fiscal_year(current_date);
  v_last_locked record;
  v_locked_months int[];
  v_open_months int[];
  v_month int;
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  select l.fiscal_year, l.period_month
    into v_last_locked
    from public.erp_fin_period_locks l
   where l.company_id = p_company_id
     and l.is_locked = true
   order by substring(l.fiscal_year from 3 for 2)::int desc, l.period_month desc
   limit 1;

  select array_agg(l.period_month order by l.period_month)
    into v_locked_months
    from public.erp_fin_period_locks l
   where l.company_id = p_company_id
     and l.fiscal_year = v_current_fy
     and l.is_locked = true;

  v_open_months := '{}'::int[];
  for v_month in 1..12 loop
    if v_locked_months is null or not (v_month = any (v_locked_months)) then
      v_open_months := array_append(v_open_months, v_month);
    end if;
  end loop;

  return query
  select
    v_last_locked.fiscal_year,
    v_last_locked.period_month,
    coalesce(v_open_months, '{}'::int[]);
end;
$$;

revoke all on function public.erp_fin_period_lock_summary(uuid) from public;
grant execute on function public.erp_fin_period_lock_summary(uuid) to authenticated;

create or replace function public.erp_fin_reports_default_period(
  p_company_id uuid
) returns table(
  from_date date,
  to_date date,
  label text,
  is_locked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period jsonb;
  v_from date;
  v_to date;
  v_fiscal_year text;
  v_period_month int;
  v_label text;
begin
  perform public.erp_require_finance_reader();

  if p_company_id is null or p_company_id <> public.erp_current_company_id() then
    raise exception 'invalid company_id';
  end if;

  v_period := public.erp_fin_default_reporting_period(p_company_id);
  v_from := (v_period->>'from_date')::date;
  v_to := (v_period->>'to_date')::date;
  v_fiscal_year := v_period->>'fiscal_year';
  v_period_month := (v_period->>'period_month')::int;
  v_label := format('%s · Month %s', v_fiscal_year, v_period_month);

  return query
  select
    v_from,
    v_to,
    v_label,
    public.erp_fin_period_is_locked(p_company_id, v_from);
end;
$$;

revoke all on function public.erp_fin_reports_default_period(uuid) from public;
grant execute on function public.erp_fin_reports_default_period(uuid) to authenticated;

create or replace function public.erp_fin_month_close_checks(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_year int;
  v_month int;
  v_year int;
  v_start_date date;
  v_end_date date;
  v_bank_ok boolean := false;
  v_bank_details jsonb := jsonb_build_object('message', 'Bank reconciliation close not implemented yet');
  v_sales_ok boolean := true;
  v_sales_details jsonb;
  v_purchase_ok boolean := true;
  v_purchase_details jsonb;
  v_inventory_ok boolean := true;
  v_ap_ok boolean := true;
  v_payroll_ok boolean := true;
  v_approvals_ok boolean := true;
  v_approvals_details jsonb := jsonb_build_object('pending', 0);
  v_sales_drafts int := 0;
  v_purchase_drafts int := 0;
  v_pending_approvals int := 0;
  v_all_ok boolean;
  v_bank_table regclass;
begin
  perform public.erp_require_finance_reader();

  if p_period_month < 1 or p_period_month > 12 then
    raise exception 'period_month must be between 1 and 12';
  end if;

  v_start_year := 2000 + substring(p_fiscal_year from 3 for 2)::int;

  if p_period_month <= 9 then
    v_month := p_period_month + 3;
    v_year := v_start_year;
  else
    v_month := p_period_month - 9;
    v_year := v_start_year + 1;
  end if;

  v_start_date := make_date(v_year, v_month, 1);
  v_end_date := (date_trunc('month', v_start_date) + interval '1 month - 1 day')::date;

  v_bank_table := to_regclass('public.erp_bank_reconciliations');
  if v_bank_table is not null then
    v_bank_ok := false;
    v_bank_details := jsonb_build_object('message', 'Bank reconciliation close not implemented yet');
  end if;

  select count(*)
    into v_sales_drafts
    from public.erp_invoices i
    where i.company_id = p_company_id
      and i.status = 'draft'
      and i.invoice_date between v_start_date and v_end_date;

  if v_sales_drafts > 0 then
    v_sales_ok := false;
    v_sales_details := jsonb_build_object('draft_count', v_sales_drafts);
  else
    v_sales_details := jsonb_build_object('draft_count', 0);
  end if;

  select count(*)
    into v_purchase_drafts
    from public.erp_gst_purchase_invoices i
    where i.company_id = p_company_id
      and i.is_void = false
      and i.status in ('draft', 'approved')
      and i.invoice_date between v_start_date and v_end_date;

  if v_purchase_drafts > 0 then
    v_purchase_ok := false;
    v_purchase_details := jsonb_build_object('draft_count', v_purchase_drafts);
  else
    v_purchase_details := jsonb_build_object('draft_count', 0);
  end if;

  select count(*)
    into v_pending_approvals
    from public.erp_fin_approvals a
    where a.company_id = p_company_id
      and a.state = 'submitted';

  if v_pending_approvals > 0 then
    v_approvals_ok := false;
    v_approvals_details := jsonb_build_object('pending', v_pending_approvals);
  end if;

  v_all_ok := v_bank_ok
    and v_sales_ok
    and v_purchase_ok
    and v_inventory_ok
    and v_ap_ok
    and v_payroll_ok
    and v_approvals_ok;

  return jsonb_build_object(
    'bank_reco_done', jsonb_build_object('ok', v_bank_ok, 'details', v_bank_details),
    'gst_sales_posted', jsonb_build_object('ok', v_sales_ok, 'details', v_sales_details),
    'gst_purchase_posted', jsonb_build_object('ok', v_purchase_ok, 'details', v_purchase_details),
    'inventory_closed', jsonb_build_object('ok', v_inventory_ok, 'details', jsonb_build_object('not_applicable', true)),
    'ap_reviewed', jsonb_build_object('ok', v_ap_ok, 'details', jsonb_build_object('not_applicable', true)),
    'payroll_posted', jsonb_build_object('ok', v_payroll_ok, 'details', jsonb_build_object('not_applicable', true)),
    'approvals_pending', jsonb_build_object('ok', v_approvals_ok, 'details', v_approvals_details),
    'all_ok', v_all_ok
  );
end;
$$;

-- Maker-checker enforcement additions

drop function if exists public.erp_ap_vendor_bill_post(uuid);
create function public.erp_ap_vendor_bill_post(
  p_bill_id uuid,
  p_use_maker_checker boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill record;
  v_preview jsonb;
  v_errors jsonb;
  v_totals jsonb;
  v_lines jsonb;
  v_journal_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_tds_section text;
  v_tds_rate numeric;
  v_tds_amount numeric;
  v_net_payable numeric;
  v_subtotal numeric;
  v_gst_total numeric;
  v_total numeric;
  v_posted_doc text;
  v_approval_state text;
begin
  perform public.erp_require_finance_writer();

  select i.*, j.doc_no as posted_doc
    into v_bill
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
     and j.company_id = i.company_id
    where i.company_id = v_company_id
      and i.id = p_bill_id
    for update;

  if v_bill.id is null then
    raise exception 'Vendor bill not found';
  end if;

  if v_bill.is_void then
    raise exception 'Vendor bill is void';
  end if;

  if v_bill.status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be posted';
  end if;

  if v_bill.finance_journal_id is not null then
    return jsonb_build_object(
      'journal_id', v_bill.finance_journal_id,
      'doc_no', v_bill.posted_doc
    );
  end if;

  if coalesce(p_use_maker_checker, true) then
    select a.state
      into v_approval_state
      from public.erp_fin_approvals a
      where a.company_id = v_company_id
        and a.entity_type = 'ap_bill'
        and a.entity_id = v_bill.id;

    if v_approval_state is distinct from 'approved' then
      raise exception 'Approval required before posting vendor bill';
    end if;
  end if;

  perform public.erp_ap_vendor_bill_recalc(p_bill_id);

  v_preview := public.erp_ap_vendor_bill_post_preview(p_bill_id);
  v_errors := coalesce(v_preview->'errors', '[]'::jsonb);

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'Posting blocked: %', v_errors::text;
  end if;

  v_totals := v_preview->'totals';
  v_lines := v_preview->'journal_lines';

  v_subtotal := coalesce((v_totals->>'subtotal')::numeric, 0);
  v_gst_total := coalesce((v_totals->>'gst_total')::numeric, 0);
  v_total := coalesce((v_totals->>'total')::numeric, 0);
  v_tds_section := nullif(v_totals->>'tds_section', '');
  v_tds_rate := coalesce((v_totals->>'tds_rate')::numeric, 0);
  v_tds_amount := coalesce((v_totals->>'tds_amount')::numeric, 0);
  v_net_payable := coalesce((v_totals->>'net_payable')::numeric, 0);

  perform public.erp_require_fin_open_period(v_company_id, v_bill.invoice_date);

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
    v_bill.invoice_date,
    'posted',
    format('Vendor bill %s', v_bill.invoice_no),
    'vendor_bill',
    v_bill.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  for v_line in
    select * from jsonb_array_elements(v_lines)
  loop
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
      v_line->>'account_code',
      v_line->>'account_name',
      v_line->>'memo',
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0)
    );

    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_line_no := v_line_no + 1;
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Posting error: journal totals do not balance';
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

  update public.erp_gst_purchase_invoices
  set finance_journal_id = v_journal_id,
      status = 'posted',
      subtotal = v_subtotal,
      gst_total = v_gst_total,
      total = v_total,
      tds_section = v_tds_section,
      tds_rate = v_tds_rate,
      tds_amount = v_tds_amount,
      net_payable = v_net_payable,
      updated_at = now(),
      updated_by = v_actor
  where id = v_bill.id
    and company_id = v_company_id;

  return jsonb_build_object(
    'journal_id', v_journal_id,
    'doc_no', v_doc_no
  );
end;
$$;

drop function if exists public.erp_ap_vendor_advance_approve_and_post(uuid);
create function public.erp_ap_vendor_advance_approve_and_post(
  p_advance_id uuid,
  p_use_maker_checker boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_advance record;
  v_advances_account record;
  v_payment_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_approval_state text;
  v_role_id uuid;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select a.*, j.doc_no as posted_doc
    into v_advance
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
     and j.company_id = a.company_id
    where a.company_id = v_company_id
      and a.id = p_advance_id
    for update;

  if v_advance.id is null then
    raise exception 'Vendor advance not found';
  end if;

  if v_advance.is_void then
    raise exception 'Vendor advance is void';
  end if;

  if v_advance.status not in ('draft', 'approved') then
    raise exception 'Only draft/approved advances can be posted';
  end if;

  if v_advance.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_advance.finance_journal_id, 'doc_no', v_advance.posted_doc);
  end if;

  if coalesce(p_use_maker_checker, true) then
    select a.state
      into v_approval_state
      from public.erp_fin_approvals a
      where a.company_id = v_company_id
        and a.entity_type = 'ap_advance'
        and a.entity_id = v_advance.id;

    if v_approval_state is distinct from 'approved' then
      raise exception 'Approval required before posting vendor advance';
    end if;
  end if;

  v_role_id := public.erp_fin_account_by_role('vendor_advance');
  select id, code, name into v_advances_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  v_role_id := public.erp_fin_account_by_role('bank_main');
  select id, code, name into v_payment_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_advances_account.id is null or v_payment_account.id is null then
    raise exception 'Vendor advance posting accounts missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_advance.advance_date);

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
    v_advance.advance_date,
    'posted',
    format('Vendor advance %s', coalesce(v_advance.reference, v_advance.id::text)),
    'vendor_advance',
    v_advance.id,
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
      v_advances_account.code,
      v_advances_account.name,
      'Vendor advance',
      v_advance.amount,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_payment_account.code,
      v_payment_account.name,
      'Advance payment',
      0,
      v_advance.amount
    );

  v_total_debit := v_advance.amount;
  v_total_credit := v_advance.amount;

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

  update public.erp_ap_vendor_advances
     set finance_journal_id = v_journal_id,
         status = 'posted',
         updated_at = now(),
         updated_by = v_actor
   where id = v_advance.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

drop function if exists public.erp_ap_vendor_payment_approve(uuid);
create function public.erp_ap_vendor_payment_approve(
  p_vendor_payment_id uuid,
  p_use_maker_checker boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_payment record;
  v_vendor_name text;
  v_payable_account record;
  v_bank_account record;
  v_journal_id uuid;
  v_doc_no text;
  v_role_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_approval_state text;
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select p.*, j.doc_no as posted_doc
    into v_payment
    from public.erp_ap_vendor_payments p
    left join public.erp_fin_journals j
      on j.id = p.finance_journal_id
     and j.company_id = p.company_id
    where p.company_id = v_company_id
      and p.id = p_vendor_payment_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    raise exception 'Vendor payment is void';
  end if;

  if v_payment.finance_journal_id is not null then
    return jsonb_build_object('journal_id', v_payment.finance_journal_id, 'doc_no', v_payment.posted_doc);
  end if;

  if coalesce(p_use_maker_checker, true) then
    select a.state
      into v_approval_state
      from public.erp_fin_approvals a
      where a.company_id = v_company_id
        and a.entity_type = 'ap_payment'
        and a.entity_id = v_payment.id;

    if v_approval_state is distinct from 'approved' then
      raise exception 'Approval required before approving vendor payment';
    end if;
  end if;

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payment.payment_instrument_id is not null then
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_payment.payment_instrument_id
        and a.company_id = v_company_id;
  else
    v_role_id := public.erp_fin_account_by_role('bank_main');
    select id, code, name into v_bank_account
      from public.erp_gl_accounts a
      where a.id = v_role_id;
  end if;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment posting accounts missing';
  end if;

  perform public.erp_require_fin_open_period(v_company_id, v_payment.payment_date);

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
    v_payment.payment_date,
    'posted',
    format('Vendor payment %s', coalesce(v_payment.reference_no, v_vendor_name, v_payment.id::text)),
    'vendor_payment',
    v_payment.id,
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
  ) values (
    v_company_id,
    v_journal_id,
    1,
    v_payable_account.code,
    v_payable_account.name,
    format('Vendor payment %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    v_payment.amount,
    0
  );

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
    2,
    v_bank_account.code,
    v_bank_account.name,
    format('Vendor payment %s', coalesce(v_vendor_name, v_payment.vendor_id::text)),
    0,
    v_payment.amount
  );

  v_total_debit := v_payment.amount;
  v_total_credit := v_payment.amount;

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

  update public.erp_ap_vendor_payments
     set status = 'approved',
         finance_journal_id = v_journal_id,
         updated_at = now(),
         updated_by = v_actor
   where id = v_payment.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

drop function if exists public.erp_fin_month_close_finalize(uuid, text, int);
create function public.erp_fin_month_close_finalize(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int,
  p_use_maker_checker boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_checks jsonb;
  v_all_ok boolean;
  v_id uuid;
  v_approval_state text;
begin
  perform public.erp_require_finance_writer();

  select id
    into v_id
    from public.erp_fin_month_close
    where company_id = p_company_id
      and fiscal_year = p_fiscal_year
      and period_month = p_period_month
    for update;

  if v_id is null then
    raise exception 'Month close record not found';
  end if;

  if coalesce(p_use_maker_checker, true) then
    select a.state
      into v_approval_state
      from public.erp_fin_approvals a
      where a.company_id = p_company_id
        and a.entity_type = 'month_close'
        and a.entity_id = v_id;

    if v_approval_state is distinct from 'approved' then
      raise exception 'Approval required before finalizing month close';
    end if;
  end if;

  v_checks := public.erp_fin_month_close_checks(p_company_id, p_fiscal_year, p_period_month);
  v_all_ok := coalesce((v_checks->>'all_ok')::boolean, false);

  if not v_all_ok then
    raise exception 'Month close checks failed: %', v_checks::text;
  end if;

  update public.erp_fin_month_close
     set status = 'closed',
         closed_at = now(),
         closed_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where company_id = p_company_id
     and fiscal_year = p_fiscal_year
     and period_month = p_period_month;

  perform public.erp_fin_period_lock(p_company_id, p_fiscal_year, p_period_month, 'Month close');

  return v_id;
end;
$$;

drop function if exists public.erp_fin_period_unlock(uuid, text, int, text);
create function public.erp_fin_period_unlock(
  p_company_id uuid,
  p_fiscal_year text,
  p_period_month int,
  p_reason text default null,
  p_use_maker_checker boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_reason text;
  v_existing_reason text;
  v_approval_state text;
begin
  perform public.erp_require_finance_writer();

  select id, lock_reason
    into v_id, v_existing_reason
    from public.erp_fin_period_locks
    where company_id = p_company_id
      and fiscal_year = p_fiscal_year
      and period_month = p_period_month
    for update;

  if v_id is null then
    raise exception 'Lock record not found';
  end if;

  if coalesce(p_use_maker_checker, true) then
    select a.state
      into v_approval_state
      from public.erp_fin_approvals a
      where a.company_id = p_company_id
        and a.entity_type = 'period_unlock'
        and a.entity_id = v_id;

    if v_approval_state is distinct from 'approved' then
      raise exception 'Approval required before unlocking period';
    end if;
  end if;

  if p_reason is not null then
    v_reason := case
      when v_existing_reason is null or v_existing_reason = '' then
        format('Unlocked: %s', p_reason)
      else
        v_existing_reason || E'\n' || format('Unlocked: %s', p_reason)
    end;
  else
    v_reason := v_existing_reason;
  end if;

  update public.erp_fin_period_locks
     set is_locked = false,
         lock_reason = v_reason,
         updated_at = now(),
         updated_by = v_actor
   where id = v_id
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post(uuid, boolean) from public;
revoke all on function public.erp_ap_vendor_advance_approve_and_post(uuid, boolean) from public;
revoke all on function public.erp_ap_vendor_payment_approve(uuid, boolean) from public;
revoke all on function public.erp_fin_month_close_finalize(uuid, text, int, boolean) from public;
revoke all on function public.erp_fin_period_unlock(uuid, text, int, text, boolean) from public;

grant execute on function public.erp_ap_vendor_bill_post(uuid, boolean) to authenticated;
grant execute on function public.erp_ap_vendor_advance_approve_and_post(uuid, boolean) to authenticated;
grant execute on function public.erp_ap_vendor_payment_approve(uuid, boolean) to authenticated;
grant execute on function public.erp_fin_month_close_finalize(uuid, text, int, boolean) to authenticated;
grant execute on function public.erp_fin_period_unlock(uuid, text, int, text, boolean) to authenticated;
