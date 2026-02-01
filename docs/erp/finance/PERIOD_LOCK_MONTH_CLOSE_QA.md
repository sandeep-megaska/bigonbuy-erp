# Period Locks + Month Close (Phase F3) QA Notes

Use these SQL snippets in the Supabase SQL editor to sanity-check the period lock workflow.

> Replace the UUID placeholders with a real company, vendor payment, and fiscal period in your database.

```sql
-- Lock FY25-26 month 1 (Apr) and verify the lock row
select public.erp_fin_period_lock(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'FY25-26',
  1,
  'QA lock'
);

select *
from public.erp_fin_period_locks
where company_id = '00000000-0000-0000-0000-000000000000'::uuid
  and fiscal_year = 'FY25-26'
  and period_month = 1;

-- Attempt to post a vendor payment dated within the locked period
-- (should raise: "Period is locked: FY25-26 month 1")
select public.erp_ap_vendor_payment_approve(
  '00000000-0000-0000-0000-000000000000'::uuid
);

-- Unlock the period and retry the posting
select public.erp_fin_period_unlock(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'FY25-26',
  1,
  'QA unlock'
);
```
