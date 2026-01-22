import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Vendor = {
  id: string;
  vendor_type: string;
  legal_name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  payment_terms_days: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export default function InventoryVendorsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [vendorType, setVendorType] = useState("");
  const [legalName, setLegalName] = useState("");
  const [gstin, setGstin] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("0");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadVendors(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadVendors(companyId: string, isActiveFetch = true) {
    setError("");
    const { data, error: loadError } = await supabase
      .from("erp_vendors")
      .select(
        "id, vendor_type, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country, payment_terms_days, notes, is_active, created_at"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (loadError) {
      if (isActiveFetch) setError(loadError.message);
      return;
    }
    if (isActiveFetch) setVendors((data || []) as Vendor[]);
  }

  function resetForm() {
    setEditingId(null);
    setVendorType("");
    setLegalName("");
    setGstin("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setAddress("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setStateValue("");
    setPincode("");
    setCountry("");
    setPaymentTermsDays("0");
    setNotes("");
    setIsActive(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can manage vendors.");
      return;
    }
    if (!vendorType.trim() || !legalName.trim()) {
      setError("Vendor type and legal name are required.");
      return;
    }

    setError("");
    const payload = {
      p_id: editingId || null,
      p_vendor_type: vendorType.trim(),
      p_legal_name: legalName.trim(),
      p_gstin: gstin.trim() || null,
      p_contact_person: contactPerson.trim() || null,
      p_phone: phone.trim() || null,
      p_email: email.trim() || null,
      p_address: address.trim() || null,
      p_address_line1: addressLine1.trim() || null,
      p_address_line2: addressLine2.trim() || null,
      p_city: city.trim() || null,
      p_state: stateValue.trim() || null,
      p_pincode: pincode.trim() || null,
      p_country: country.trim() || null,
      p_payment_terms_days: Number(paymentTermsDays) || 0,
      p_notes: notes.trim() || null,
      p_is_active: isActive,
      p_updated_by: ctx.userId,
    };

    if (editingId) {
      const { error: updateError } = await supabase.rpc("erp_inventory_vendor_upsert", payload);
      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.rpc("erp_inventory_vendor_upsert", payload);
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }

    resetForm();
    await loadVendors(ctx.companyId);
  }

  function handleEdit(vendor: Vendor) {
    setEditingId(vendor.id);
    setVendorType(vendor.vendor_type);
    setLegalName(vendor.legal_name);
    setGstin(vendor.gstin || "");
    setContactPerson(vendor.contact_person || "");
    setPhone(vendor.phone || "");
    setEmail(vendor.email || "");
    setAddress(vendor.address || "");
    setAddressLine1(vendor.address_line1 || "");
    setAddressLine2(vendor.address_line2 || "");
    setCity(vendor.city || "");
    setStateValue(vendor.state || "");
    setPincode(vendor.pincode || "");
    setCountry(vendor.country || "");
    setPaymentTermsDays(String(vendor.payment_terms_days ?? 0));
    setNotes(vendor.notes || "");
    setIsActive(vendor.is_active);
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>Vendors</h1>
            <p style={subtitleStyle}>Track supplier master data for purchasing.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Add / Edit Vendor</h2>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                Vendor Type
                <input style={inputStyle} value={vendorType} onChange={(e) => setVendorType(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Legal Name
                <input style={inputStyle} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                GSTIN
                <input style={inputStyle} value={gstin} onChange={(e) => setGstin(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Contact Person
                <input style={inputStyle} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Phone
                <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Email
                <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Address Line 1
                <input style={inputStyle} value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Address Line 2
                <input style={inputStyle} value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                City
                <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                State
                <input style={inputStyle} value={stateValue} onChange={(e) => setStateValue(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Pincode
                <input style={inputStyle} value={pincode} onChange={(e) => setPincode(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Country
                <input style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Payment Terms (days)
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Active
                <select style={inputStyle} value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              Address Notes
              <textarea
                style={{ ...inputStyle, minHeight: 80 }}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Notes
              <textarea style={{ ...inputStyle, minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite}>
                {editingId ? "Update Vendor" : "Create Vendor"}
              </button>
              {editingId ? (
                <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Type</th>
                <th style={tableHeaderCellStyle}>Contact</th>
                <th style={tableHeaderCellStyle}>Payment Terms</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    Loading vendors...
                  </td>
                </tr>
              ) : vendors.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No vendors yet.
                  </td>
                </tr>
              ) : (
                vendors.map((vendor) => (
                  <tr key={vendor.id}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{vendor.legal_name}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{vendor.gstin || "No GSTIN"}</div>
                    </td>
                    <td style={tableCellStyle}>{vendor.vendor_type}</td>
                    <td style={tableCellStyle}>
                      <div>{vendor.contact_person || "-"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{vendor.phone || vendor.email || "-"}</div>
                    </td>
                    <td style={tableCellStyle}>{vendor.payment_terms_days} days</td>
                    <td style={tableCellStyle}>{vendor.is_active ? "Active" : "Inactive"}</td>
                    <td style={tableCellStyle}>
                      <button style={secondaryButtonStyle} onClick={() => handleEdit(vendor)} disabled={!canWrite}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
