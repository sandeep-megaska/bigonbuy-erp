# MFG Vendor Quick Start (1 Page)

## 1) Login
1. Open `/mfg/login`
2. Enter **Vendor Code** + **Password**
3. Click **Sign in**
4. If asked, reset password (minimum 8 chars)

[Screenshot Placeholder: Login page]

## 2) Check Dashboard
Open `/mfg/v/[vendor_code]` and review:
- **Open POs**
- **Pending Deliveries**
- **Quality Issues**

[Screenshot Placeholder: Dashboard tiles]

## 3) Update Materials
Open `/mfg/materials`:
- Click **Add Material** to create new material
- Click **Stock In / Adjustment** after purchase/usage
- Watch **Alerts** (LOW/OUT)

Stock movement fields:
- Material, Type, Quantity, Entry date, Notes

[Screenshot Placeholder: Stock movement modal]

## 4) Manage BOM
Open `/mfg/bom`:
1. Select SKU from dropdown (assigned SKUs only)
2. Click **Add line** and fill Material, Qty per unit, UOM, Waste %, Notes
3. Click **Save Draft** or **Activate**

[Screenshot Placeholder: BOM editor]

## 5) Logout
Click **Sign Out** from header.

## Common errors
- `Not authenticated` -> Login again
- `SKU is not assigned to this vendor.` -> Contact admin
- `BOM not found for vendor` -> Select correct SKU/BOM or create one

