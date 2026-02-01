-- 0351_fix_ap_vendor_payment_approve_locking.sql

create or replace function public.erp_ap_vendor_payment_approve(
  p_vendor_payment_id uuid
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
begin
  perform public.erp_require_finance_writer();

  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_payment
    from public.erp_ap_vendor_payments
    where company_id = v_company_id
      and id = p_vendor_payment_id
    for update;

  if v_payment.id is null then
    raise exception 'Vendor payment not found';
  end if;

  if v_payment.is_void or v_payment.status = 'void' then
    raise exception 'Vendor payment is void';
  end if;

  if v_payment.finance_journal_id is not null then
    raise exception 'Already posted';
  end if;

  if v_payment.status <> 'draft' then
    raise exception 'Vendor payment is not draft';
  end if;

  select legal_name into v_vendor_name
  from public.erp_vendors
  where id = v_payment.vendor_id
    and company_id = v_company_id;

  v_role_id := public.erp_fin_account_by_role('vendor_payable');
  select id, code, name into v_payable_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  v_role_id := public.erp_fin_account_by_role('bank_main');
  select id, code, name into v_bank_account
    from public.erp_gl_accounts a
    where a.id = v_role_id;

  if v_payable_account.id is null or v_bank_account.id is null then
    raise exception 'Payment posting accounts missing';
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
    'Vendor payment',
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
     set finance_journal_id = v_journal_id,
         status = 'approved',
         updated_at = now(),
         updated_by = v_actor
   where id = v_payment.id
     and company_id = v_company_id;

  return jsonb_build_object('journal_id', v_journal_id, 'doc_no', v_doc_no);
end;
$$;

revoke all on function public.erp_ap_vendor_payment_approve(uuid) from public;

grant execute on function public.erp_ap_vendor_payment_approve(uuid) to authenticated;
