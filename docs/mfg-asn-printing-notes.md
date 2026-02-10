# MFG ASN PDF printing checklist

- Draft ASN with cartons + scans -> `/api/mfg/asns/:asnId/packing-slip.pdf?format=slip` opens and carton lines/qty match `erp_mfg_asn_carton_lines`.
- Rejected scans do not appear in totals (only APPLIED scan events increment `qty_packed`).
- After submit, packing slip and box labels still open for reprint.
- Vendor cannot print another vendor ASN (enforced by `erp_mfg_asn_print_data_v1` vendor/session check).
- Route lint passes (no legacy ERP API route patterns introduced).

Run:
- `npm run lint:routes`
- `npm run build`
