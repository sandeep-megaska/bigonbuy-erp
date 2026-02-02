# Go-Live Hardening QA Checklist

## Ops Dashboard
- [ ] Ops dashboard loads counts for approvals, AP, bank, Razorpay, inventory, and payroll.

## Maker-Checker Flow
- [ ] Vendor bill: draft → submit for approval → approve → journal created.
- [ ] Vendor payment: submit for approval → approve → journal + allocations OK.
- [ ] Period unlock requires approval (request unlock → approve unlock).
- [ ] Month close finalize requires approval (unless bypass flag enabled).

## Feature Flag Bypass
- [ ] FIN_BYPASS_MAKER_CHECKER only works for owner/admin roles.

## UX & Error Handling
- [ ] Friendly error banner shown (no raw stack traces).
- [ ] Retry and copy technical details options available.
