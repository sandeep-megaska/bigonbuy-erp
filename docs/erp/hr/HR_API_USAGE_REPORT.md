# HR API Usage Report

## Scan scope

Direct `/api/hr/*` callers were scanned across the repo (fetch/axios/helpers that hit the legacy path).

## Remaining callers

No direct `/api/hr/*` callers were found in application or script code. Legacy endpoints remain under `pages/api/hr/*` for compatibility, but active ERP UI code uses `/api/hr/*`.

## Notes

- Documentation references to `/api/hr/*` remain in historical docs for audit purposes.
- Legacy API handlers now emit dev-only deprecation warnings.
