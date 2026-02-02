# Finance F3/F4 QA Checklist

## Period Lock + Month Close (F3-B)

1. **Lock a month**
   - Lock a fiscal period using the Period Lock page.
   - Attempt to post a vendor bill/payroll/settlement in the locked month.
   - ✅ Expect posting RPCs to fail with a clear "Period is locked" error.

2. **Month close checklist + finalize**
   - Open Month Close and refresh checks for a target period.
   - ✅ Ensure checklist includes pending approval count.
   - Finalize after passing checks.
   - ✅ Expect the period to be locked automatically.

## Maker-Checker (F3-C)

1. **Vendor bill workflow**
   - Create a draft vendor bill.
   - Submit for approval via `erp_fin_submit_for_approval` with entity_type `ap_bill`.
   - Approve via `erp_fin_approve`.
   - ✅ Expect the bill to post and finance_journal_id to be populated.

2. **Vendor payment workflow**
   - Create a draft vendor payment.
   - Submit for approval with entity_type `ap_payment`.
   - Approve via `erp_fin_approve`.
   - ✅ Expect payment status `approved` and finance_journal_id populated.

3. **Vendor advance workflow**
   - Create a draft vendor advance.
   - Submit for approval with entity_type `ap_advance`.
   - Approve via `erp_fin_approve`.
   - ✅ Expect advance status `posted` and finance_journal_id populated.

4. **Period unlock approval**
   - Submit approval for `period_unlock` using the lock record id.
   - Approve via `erp_fin_approve`.
   - ✅ Expect period to unlock and lock_reason updated.

## Finance Intelligence (F4)

1. **Default period loads**
   - Open P&L, Balance Sheet, Cash Flow pages.
   - ✅ Default period should be latest locked month, else current month-to-date.

2. **P&L vs Trial Balance**
   - Compare P&L totals for period with trial balance movement for the same period.
   - ✅ Totals should reconcile by normal balance.

3. **Balance Sheet as-of**
   - Compare balance sheet as-of with trial balance cumulative as-of.
   - ✅ Totals should match.

4. **Cash Flow**
   - Compare cash flow net movement with bank control account movement.
   - ✅ Net cash flow should reconcile to bank movement (MVP).
