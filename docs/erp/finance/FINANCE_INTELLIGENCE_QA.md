# Finance Intelligence QA Guide

## Profit & Loss (P&L)

1. Pick a closed period in **Finance → Reports → Profit & Loss**.
2. Export the trial balance for the same date range.
3. Confirm:
   - The sum of P&L **revenue** roles equals trial balance net for those mapped revenue accounts.
   - The sum of **expense/COGS/depreciation** roles equals trial balance net for those mapped expense accounts.
4. Drill into a P&L row and confirm the journal lines list matches the ledger report for the mapped account(s).

## Balance Sheet

1. Open **Finance → Reports → Balance Sheet** and select an as-of date.
2. Run **Trial Balance** for the same date range (start of fiscal year to as-of date).
3. Confirm:
   - Asset, liability, and equity totals match the cumulative trial balance net for mapped accounts.
   - Drilldowns show the same journal lines as account ledger entries.

## Cash Flow (Direct Method MVP)

1. Open **Finance → Reports → Cash Flow** for a closed period.
2. Validate that **net cash (cash in - cash out)** equals the net movement in the mapped bank account(s) for the period.
3. Drill into a cash flow subgroup and confirm that the journal lines are the same bank-linked journals.
4. Review any **unclassified** cash flow rows and map missing control roles in **Finance → Settings → COA Roles**.
