-- 0345_fix_vendor_advance_post_locking.sql

create or replace function public.erp_ap_vendor_advance_approve_and_post(
  p_advance_id uuid
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
  v_role_id uuid;
begin
  perform public.erp_require_finance_writer();

  select a.*, j.doc_no as posted_doc
    into v_advance
    from public.erp_ap_vendor_advances a
    left join public.erp_fin_journals j
      on j.id = a.finance_journal_id
     and j.company_id = a.company_id
    where a.company_id = v_company_id
      and a.id = p_advance_id
    for update of a;

  if v_advance.id is null then
    raise exception 'Vendor advance not found';
  end if;

  if v_advance.is_void or v_advance.status = 'void' then
    raise exception 'Vendor advance is void';
  end if;

  if v_advance.finance_journal_id is not null then
    raise exception 'Vendor advance already posted';
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
    raise exception 'Advance posting accounts missing';
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
    v_advance.advance_date,
    'posted',
    format('Vendor advance %s', v_advance.reference),
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
  ) values (
    v_company_id,
    v_journal_id,
    1,
    v_advances_account.code,
    v_advances_account.name,
    'Vendor advance',
    v_advance.amount,
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

revoke all on function public.erp_ap_vendor_advance_approve_and_post(uuid) from public;
grant execute on function public.erp_ap_vendor_advance_approve_and_post(uuid) to authenticated;
