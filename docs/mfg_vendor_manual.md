# Manufacturer Portal (MFG) - Vendor User Manual

> Audience: Small manufacturers (non-technical users)
> 
> Language: Simple step-by-step English

---

## 1) Getting Started

### What this portal is for
The Manufacturer Portal helps your team do daily work in one place:
- Sign in securely
- See your dashboard
- Manage raw materials stock
- Create and maintain BOMs (Bill of Materials) for assigned SKUs

[Screenshot Placeholder: Portal Home / Header]

### Supported devices
- Laptop/Desktop browser (recommended)
- Mobile browser (supported)

Tip: For long data entry (materials and BOM lines), laptop is easier.

### Multi-device login
You can sign in from more than one device/browser at the same time. If you sign out on one device, other active sessions may remain signed in.

---

## 2) Login & Password

### 2.1 First login
1. Open: `/mfg/login`
2. Enter **Vendor Code**
3. Enter **Password**
4. Click **Sign in**

If your account is set to reset on first use, you will be sent to **Reset Password**.

[Screenshot Placeholder: Vendor Sign in page]

### 2.2 Reset password
1. On reset page, enter **New password**
2. Enter **Confirm new password**
3. Click **Set password**

Rules:
- Minimum 8 characters
- Both password fields must match

Common errors:
- `Password must be at least 8 characters`
- `Passwords do not match`

[Screenshot Placeholder: Reset Password form]

### 2.3 Change password (after login)
1. Open: `/mfg/change-password`
2. Enter new password and confirm it
3. Click **Set password**

### 2.4 Logout
- Click **Sign Out** in the top-right header.

---

## 3) Dashboard

Path: `/mfg/v/[vendor_code]`

Dashboard page title: **Vendor Dashboard**

You will see 3 main tiles:
- **Open POs**
- **Pending Deliveries**
- **Quality Issues**

There is also a **Recent Activity** section.

> Note: In MVP, some dashboard values may be placeholders while integrations are being completed.

[Screenshot Placeholder: Dashboard tiles and recent activity]

---

## 4) Raw Materials

Path: `/mfg/materials`

Page title: **Raw Materials**

Top action buttons:
- **Add Material**
- **Stock In / Adjustment**

Sections on page:
- **Alerts**
- **Materials**

### 4.1 Add Material
1. Go to **Materials** tab.
2. Click **Add Material**.
3. Fill the form:
   - **Name**
   - **Category**
   - **Default UOM**
   - **Reorder point**
   - **Lead time (days)**
4. Click **Save**.

[Screenshot Placeholder: Add material modal]

### 4.2 Stock In / Adjustment
1. Click **Stock In / Adjustment**.
2. Fill the **Stock movement** form:
   - **Material**
   - **Type**: Purchase In / Adjustment In / Adjustment Out / Opening
   - **Quantity**
   - **Entry date**
   - **Notes**
3. Click **Submit**.

System note: UOM is auto-recorded from selected material.

[Screenshot Placeholder: Stock movement modal]

### 4.3 Alerts (Low / Out)
The **Alerts** section shows materials that need attention, for example:
- **LOW** stock
- **OUT** of stock

### 4.4 Best practices
- Update stock as soon as new material is received.
- Record stock usage/adjustments daily.
- Keep reorder points realistic based on lead time.

---

## 5) BOM Management

Path: `/mfg/bom`

Page title: **BOM Management**

### 5.1 SKU dropdown behavior
- Use the **SKU** dropdown.
- SKUs shown are assigned to your vendor (typically from PO mapping).
- If no SKUs are assigned, you will see: `No SKUs assigned yet. Please contact Megaska.`

[Screenshot Placeholder: BOM SKU dropdown]

### 5.2 Create or edit BOM lines
1. Select a SKU.
2. Add details:
   - **Status** (draft/active)
   - **Notes**
3. Click **Add line** for each material row.
4. For each line, fill:
   - **Material**
   - **Qty per unit**
   - **UOM**
   - **Waste %**
   - **Notes**
5. Use **Remove** if you need to delete a line.

### 5.3 Save Draft and Activate
- Click **Save Draft** to save without activating.
- Click **Activate** to make BOM active.

Success messages:
- `Draft saved`
- `BOM activated`

[Screenshot Placeholder: BOM lines table and action buttons]

---

## 6) Common Errors and What They Mean

- `Not authenticated`
  - Your session expired or you are signed out.
  - Fix: login again at `/mfg/login`.

- `SKU is not assigned to this vendor.`
  - You tried BOM operations on a SKU not mapped to your vendor.
  - Fix: ask admin to assign SKU.

- `BOM not found for vendor`
  - The requested BOM does not exist for your vendor/company context.
  - Fix: select correct SKU/BOM or create a new BOM.

---

## 7) Navigation Summary

Main header tabs:
- **Dashboard**
- **Production** (may be present depending on workflow)
- **Materials**
- **BOM**

Header button:
- **Sign Out**

---

## 8) Daily Workflow (Recommended)

1. Sign in
2. Check **Dashboard** for urgent items
3. Update **Materials** stock changes
4. Review **Alerts** for LOW/OUT stock
5. Maintain BOMs for assigned SKUs
6. Sign out when done

