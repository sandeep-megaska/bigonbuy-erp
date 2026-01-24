-- 0225_bank_txn_unique_refno.sql
-- Enforce unique bank txn by reference_no for ICICI (audit-safe)
-- Also auto-void existing duplicates so the unique index can be created.
-- IMPORTANT: No BEGIN/COMMIT here (Supabase migration runner already runs in a transaction).

-- 1) Void duplicates for ICICI where reference_no is a real value (not blank, not '-')
with ranked as (
  select
    t.id,
    t.company_id,
    t.source,
    t.reference_no,
    t.debit,
    t.credit,
    t.balance,
    t.created_at,
    t.created_by,
    row_number() over (
      partition by t.company_id, t.source, t.reference_no
      order by
        (case when (coalesce(t.debit,0) <> 0 or coalesce(t.credit,0) <> 0) then 1 else 0 end) desc,
        (case when t.balance is not null then 1 else 0 end) desc,
        t.created_at desc
    ) as rn
  from public.erp_bank_transactions t
  where t.is_void = false
    and t.source = 'icici'
    and t.reference_no is not null
    and btrim(t.reference_no) <> ''
    and btrim(t.reference_no) <> '-'
),
to_void as (
  select id, created_by
  from ranked
  where rn > 1
)
update public.erp_bank_transactions t
set
  is_void = true,
  void_reason = 'Duplicate Transaction ID (auto-voided by migration 0225)',
  voided_at = now(),
  voided_by = t.created_by,
  updated_at = now(),
  updated_by = t.created_by
where t.id in (select id from to_void);

-- 2) Unique index by (company_id, source, reference_no) for active rows only
drop index if exists public.erp_bank_transactions_company_source_ref_uq;

create unique index erp_bank_transactions_company_source_ref_uq
on public.erp_bank_transactions(company_id, source, reference_no)
where is_void = false
  and reference_no is not null
  and btrim(reference_no) <> ''
  and btrim(reference_no) <> '-';
