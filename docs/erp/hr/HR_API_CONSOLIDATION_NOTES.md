# HR API Consolidation Notes

## Inventory of legacy `/api/hr/*` usage (pre-consolidation)

| Legacy endpoint | Previously referenced by | Canonical replacement |
| --- | --- | --- |
| `/api/hr/roles/list` | `pages/erp/hr/roles.js`, `pages/erp/admin/company-users.tsx` | `/api/erp/hr/roles/list` |
| `/api/hr/roles/create` | `pages/erp/hr/roles.js` | `/api/erp/hr/roles/create` |
| `/api/hr/roles/update` | `pages/erp/hr/roles.js` | `/api/erp/hr/roles/update` |
| `/api/hr/roles/delete` | `pages/erp/hr/roles.js` | `/api/erp/hr/roles/delete` |
| `/api/hr/link-employee-user` | `pages/erp/hr/employee-logins.js`, `scripts/verify-erp-linking.mjs` | `/api/erp/hr/link-employee-user` |
| `/api/hr/employees` | `pages/erp/hr/employee-logins.js`, `pages/erp/hr/employees/[id]/index.js` | `/api/erp/hr/employees` |

## Notes

- Legacy endpoints still exist under `pages/api/hr/*` for compatibility, but now delegate to shared handlers that also power the canonical `/api/erp/hr/*` routes.
- No DB migrations were required; the canonical endpoints reuse the same RPCs/tables as the legacy endpoints.
