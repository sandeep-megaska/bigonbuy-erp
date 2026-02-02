# Go-Live Finalization QA

## Vendor Bill Approval → Posting
1. Open a vendor bill in **Finance → AP → Vendor Bills**.
2. Confirm the approval badge shows **draft**.
3. Click **Submit for Approval**.
4. As an approver, click **Approve**.
5. Click **Post Bill**.
6. Verify a journal is created and the journal link is available on the bill detail.

## Vendor Payment Approval → Posting
1. Open a vendor payment in **Finance → Vendor Payments**.
2. Confirm the approval badge shows **draft**.
3. Click **Submit for Approval**.
4. As an approver, click **Approve**.
5. Click **Post**.
6. Verify the payment shows **Posted** and allocations are still correct.

## Period Unlock Approval Required
1. Navigate to **Finance → Control → Period Locks**.
2. For a locked month, click **Submit Unlock**.
3. As an approver, click **Approve** on the submitted request.
4. Verify the period shows **Open** after approval.

## Month Close Approval Required
1. Navigate to **Finance → Control → Month Close**.
2. Run checks until **All OK** is true.
3. Click **Submit for Approval**.
4. As an approver, click **Approve & Finalize**.
5. Verify the period is finalized and locked.

## Maker-Checker Bypass Flag
1. Sign in as **owner** or **admin**.
2. Set `NEXT_PUBLIC_FIN_BYPASS_MAKER_CHECKER=true`.
3. Confirm posting actions can bypass approvals.
4. Remove the flag and confirm approvals are required again.
