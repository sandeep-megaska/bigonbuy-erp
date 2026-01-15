# UI Cleanup + Branding + Company Settings QA

## Visual cleanup
- [ ] `/erp` shows grouped tiles for Workspace, HR, Finance, Admin and no duplicate navigation strip under the top nav.
- [ ] `/erp/hr` shows grouped tiles for HR Masters, HR Operations, Access & Governance; Weekly Off Rules is under HR Masters.

## Branding
- [ ] `erp-assets` storage bucket exists (create if missing).
- [ ] BIGONBUY logo upload persists and renders in the ERP top navigation.
- [ ] Megaska logo upload persists and renders in the ERP top navigation.
- [ ] HR report pages display the branding header block above report tables.

## Company settings
- [ ] `/erp/admin/company-settings` loads for owner/admin only.
- [ ] Organization details update `erp_companies` fields (legal/brand name, country/currency codes).
- [ ] Logo upload saves paths into `erp_company_settings`.
- [ ] Setup checklist reflects status and “Mark Setup Complete” sets flags.

## Build
- [ ] `npm run build`
