import type { CSSProperties } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";

const sectionStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
  marginTop: 14,
};

const placeholderStyle: CSSProperties = {
  marginTop: 8,
  border: "1px dashed #cbd5e1",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#475569",
  background: "#f8fafc",
  fontSize: 13,
};

export default function MfgHelpPage() {
  return (
    <MfgLayout title="Help" subtitle="Vendor User Manual">
      <div style={{ color: "#334155" }}>
        <h2 style={{ marginTop: 0 }}>Manufacturer Portal (MFG) - Vendor User Manual</h2>
        <p style={{ marginTop: 4, color: "#64748b" }}>Simple guide for day-to-day use.</p>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>1) Getting Started</h3>
          <ul>
            <li>Use this portal to manage dashboard, materials, and BOM.</li>
            <li>Works on laptop/desktop and mobile browser.</li>
            <li>You can login on multiple devices.</li>
          </ul>
          <div style={placeholderStyle}>[Screenshot Placeholder: Portal header and navigation]</div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>2) Login & Password</h3>
          <ol>
            <li>Open <code>/mfg/login</code>.</li>
            <li>Enter Vendor Code and Password, then click <strong>Sign in</strong>.</li>
            <li>If prompted, reset password using <strong>Set password</strong>.</li>
            <li>To logout, click <strong>Sign Out</strong> in header.</li>
          </ol>
          <div style={placeholderStyle}>[Screenshot Placeholder: Login / Reset Password screens]</div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>3) Dashboard</h3>
          <p>Path: <code>/mfg/v/[vendor_code]</code></p>
          <ul>
            <li>Open POs</li>
            <li>Pending Deliveries</li>
            <li>Quality Issues</li>
          </ul>
          <p style={{ marginBottom: 0, color: "#64748b" }}>Note: some values may be placeholders in MVP.</p>
          <div style={placeholderStyle}>[Screenshot Placeholder: Dashboard tiles]</div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>4) Raw Materials</h3>
          <p>Path: <code>/mfg/materials</code></p>
          <ul>
            <li><strong>Add Material</strong>: Name, Category, Default UOM, Reorder point, Lead time (days)</li>
            <li><strong>Stock In / Adjustment</strong>: Material, Type, Quantity, Entry date, Notes</li>
            <li>Alerts show LOW/OUT stock.</li>
          </ul>
          <p style={{ marginBottom: 0 }}>Best practice: update stock after every purchase or usage.</p>
          <div style={placeholderStyle}>[Screenshot Placeholder: Add material and Stock movement modals]</div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>5) BOM Management</h3>
          <p>Path: <code>/mfg/bom</code></p>
          <ol>
            <li>Select SKU from dropdown (assigned SKUs from PO mapping).</li>
            <li>Click <strong>Add line</strong> and fill Material, Qty per unit, UOM, Waste %, Notes.</li>
            <li>Use <strong>Save Draft</strong> for draft or <strong>Activate</strong> to publish BOM.</li>
          </ol>
          <div style={placeholderStyle}>[Screenshot Placeholder: BOM editor]</div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>Common Errors</h3>
          <ul>
            <li><code>Not authenticated</code> - login again.</li>
            <li><code>SKU is not assigned to this vendor.</code> - ask admin to assign SKU.</li>
            <li><code>BOM not found for vendor</code> - choose valid SKU/BOM or create a new BOM.</li>
          </ul>
        </section>
      </div>
    </MfgLayout>
  );
}
