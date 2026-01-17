# Inventory Vendors + PO → GRN (Phase 1)

## Overview
This phase introduces vendor master data, purchase orders, and GRN (goods receipt) flows. GRN posting writes inventory ledger entries and updates PO received quantities + statuses.

## Setup
1. Apply the migration `0139_inventory_vendors_po_grn.sql`.
2. Ensure the canonical company/user membership is configured (required for RLS and sequences).

## Usage Notes
### Vendors
* Navigate to `/erp/inventory/vendors` to create vendor master records.
* Only owner/admin users can create or edit vendors.

### Purchase Orders
* Navigate to `/erp/inventory/purchase-orders` to create POs.
* Add at least one PO line with a positive quantity.
* PO numbers are generated per company (`PO000001`, `PO000002`, ...).

### Receiving Goods (GRN)
* Open a PO at `/erp/inventory/purchase-orders/[id]`.
* Enter received quantities (up to remaining qty) and select a warehouse.
* Posting a GRN:
  * Inserts `erp_inventory_ledger` entries with `type='grn_in'` and `ref='GRN:<id>'`.
  * Updates `erp_purchase_order_lines.received_qty`.
  * Sets PO status to `partially_received` or `received`.
  * Marks GRN status as `posted`.

### GRN Listing
* Navigate to `/erp/inventory/grns` to review GRNs across POs.

## RPC
`erp_post_grn(p_grn_id uuid)` performs the posting logic transactionally and validates:
* GRN exists and is in `draft`.
* User is owner/admin.
* GRN lines do not exceed ordered quantities.
* GRN has at least one line.

The RPC returns a JSON payload `{ status: "posted", grn_id: <uuid> }`.
