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
  vendor_code: string | null;
  portal_enabled: boolean;
  portal_status: string;
  portal_logo_path: string | null;
  created_at: string;
};

type TdsProfile = {
  profile_id: string;
  vendor_id: string;
  tds_section: string;
  tds_rate: number;
  threshold_amount: number | null;
  effective_from: string;
  effective_to: string | null;
  is_void: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function InventoryVendorsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string>("");

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

  const [tdsProfiles, setTdsProfiles] = useState<TdsProfile[]>([]);
  const [tdsSection, setTdsSection] = useState("194C");
  const [tdsRate, setTdsRate] = useState("");
  const [tdsThreshold, setTdsThreshold] = useState("");
  const [tdsEffectiveFrom, setTdsEffectiveFrom] = useState("");
  const [tdsEffectiveTo, setTdsEffectiveTo] = useState("");

  const [portalLoading, setPortalLoading] = useState(false);
  const [syncingPoSkus, setSyncingPoSkus] = useState(false);
  const [portalLogoUploading, setPortalLogoUploading] = useState(false);
  const [portalLogoFile, setPortalLogoFile] = useState<File | null>(null);
  const [portalLogoPreview, setPortalLogoPreview] = useState<string | null>(null);
  const [portalTempPassword, setPortalTempPassword] = useState<string | null>(null);
  const [portalVendorCode, setPortalVendorCode] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  function toPublicUrl(path?: string | null) {
    if (!path) return null;
    const { data } = supabase.storage.from("erp-assets").getPublicUrl(path);
    return data?.publicUrl ?? null;
  }

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      setAccessToken(session.access_token || "");

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
        "id, vendor_type, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country, payment_terms_days, notes, is_active, vendor_code, portal_enabled, portal_status, portal_logo_path, created_at",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (loadError) {
      if (isActiveFetch) setError(loadError.message);
      return;
    }
    if (isActiveFetch) setVendors((data || []) as Vendor[]);
  }

  async function loadTdsProfiles(vendorId: string) {
    const { data, error: loadError } = await supabase.rpc("erp_vendor_tds_profiles_list", {
      p_vendor_id: vendorId,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load TDS profiles.");
      return;
    }

    setTdsProfiles((data || []) as TdsProfile[]);
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
    setTdsProfiles([]);
    setPortalTempPassword(null);
    setPortalVendorCode(null);
    setPortalLogoFile(null);
    setPortalLogoPreview(null);
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

    const { error: upsertError } = await supabase.rpc("erp_inventory_vendor_upsert", payload);
    if (upsertError) {
      setError(upsertError.message);
      return;
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

    setTdsSection("194C");
    setTdsRate("");
    setTdsThreshold("");
    setTdsEffectiveFrom("");
    setTdsEffectiveTo("");

    setPortalTempPassword(null);
    setPortalVendorCode(null);
    setPortalLogoFile(null);
    setPortalLogoPreview(toPublicUrl(vendor.portal_logo_path));
    setToast(null);
    setError("");

    loadTdsProfiles(vendor.id);
  }

  async function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        const base64 = value.includes(",") ? value.split(",")[1] : value;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Failed to read logo file"));
      reader.readAsDataURL(file);
    });
  }

  async function handlePortalLogoUpload() {
    if (!editingId) return;
    if (!portalLogoFile) {
      setToast({ type: "error", message: "Select a vendor logo file first." });
      return;
    }
    if (!accessToken) {
      setToast({ type: "error", message: "Missing access token. Please sign in again." });
      return;
    }

    setPortalLogoUploading(true);
    setToast(null);
    setError("");
    try {
      const fileBase64 = await fileToBase64(portalLogoFile);
      const res = await fetch("/api/inventory/vendors/upload-portal-logo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vendor_id: editingId,
          file_base64: fileBase64,
          filename: portalLogoFile.name,
          mime_type: portalLogoFile.type || "image/png",
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to upload vendor logo");
      }
      setPortalLogoPreview(payload.public_url || null);
      setPortalLogoFile(null);
      setToast({ type: "success", message: "Vendor logo uploaded." });
      if (ctx?.companyId) await loadVendors(ctx.companyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload vendor logo";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setPortalLogoUploading(false);
    }
  }

  async function handlePortalLogoRemove() {
    if (!editingId || !accessToken) return;

    setPortalLogoUploading(true);
    setToast(null);
    setError("");
    try {
      const res = await fetch("/api/inventory/vendors/upload-portal-logo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vendor_id: editingId, remove: true }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to remove vendor logo");
      }
      setPortalLogoPreview(null);
      setPortalLogoFile(null);
      setToast({ type: "success", message: "Vendor logo removed." });
      if (ctx?.companyId) await loadVendors(ctx.companyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove vendor logo";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setPortalLogoUploading(false);
    }
  }

  async function handlePortalEnable() {
    if (!editingId || !ctx?.companyId) return;

    const selectedVendor = vendors.find((vendor) => vendor.id === editingId);
    const vendorEmail = (email || selectedVendor?.email || "").trim().toLowerCase();

    if (!vendorEmail) {
      const message = "Vendor email is required to generate portal access.";
      setError(message);
      setToast({ type: "error", message });
      return;
    }

    if (!accessToken) {
      const message = "Not authenticated (missing access token). Please reload and sign in again.";
      setError(message);
      setToast({ type: "error", message });
      return;
    }

    setPortalLoading(true);
    setPortalTempPassword(null);
    setPortalVendorCode(null);
    setToast(null);
    setError("");

    try {
      const res = await fetch("/api/mfg/admin/grant-vendor-portal-access", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vendor_id: editingId, email: vendorEmail, role_key: "vendor" }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        const message =
          data?.error || `Failed to enable portal access (HTTP ${res.status})`;
        setError(message);
        setToast({ type: "error", message });
        return;
      }

      setPortalVendorCode(data?.vendor_code || selectedVendor?.vendor_code || null);
      setPortalTempPassword(data?.temp_password || null);
      setToast({ type: "success", message: "Vendor portal access/password generated." });
      await loadVendors(ctx.companyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to enable portal access";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setPortalLoading(false);
    }
  }

  async function handlePortalDisable() {
    if (!editingId || !ctx?.companyId) return;

    if (!accessToken) {
      const message = "Not authenticated (missing access token). Please reload and sign in again.";
      setError(message);
      setToast({ type: "error", message });
      return;
    }

    setPortalLoading(true);
    setToast(null);
    setError("");

    try {
      const res = await fetch("/api/mfg/admin/vendor-portal-disable", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vendor_id: editingId, reason: "Disabled from vendor master" }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        const message = data?.error || "Failed to disable portal access";
        setError(message);
        setToast({ type: "error", message });
        return;
      }

      setPortalTempPassword(null);
      setPortalVendorCode(null);
      setToast({ type: "success", message: "Vendor portal access disabled." });
      await loadVendors(ctx.companyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disable portal access";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleSyncSkuAssignmentsFromPo() {
    if (!ctx?.companyId || !editingId) return;

    if (!canWrite) {
      setToast({ type: "error", message: "Only owner/admin can sync vendor SKUs." });
      return;
    }

    setSyncingPoSkus(true);
    setToast(null);
    setError("");

    try {
      const { data, error: rpcError } = await supabase.rpc("erp_vendor_sku_assignments_sync_from_pos_v1", {
        p_company_id: ctx.companyId,
        p_vendor_id: editingId,
        p_since: null,
      });

      if (rpcError) {
        throw new Error(rpcError.message || "Failed to sync vendor SKUs from PO history");
      }

      const summary = Array.isArray(data) ? data[0] : data;
      const insertedCount = Number(summary?.inserted_count || 0);
      const updatedCount = Number(summary?.updated_count || 0);
      const totalDistinctSkus = Number(summary?.total_distinct_skus || 0);

      setToast({
        type: "success",
        message: `PO SKU sync complete. Inserted: ${insertedCount}, Updated: ${updatedCount}, Distinct SKUs: ${totalDistinctSkus}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync vendor SKUs from PO history";
      setError(message);
      setToast({ type: "error", message });
    } finally {
      setSyncingPoSkus(false);
    }
  }

  async function handleTdsProfileSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) {
      setError("Select a vendor before adding TDS profile.");
      return;
    }

    if (!tdsRate.trim()) {
      setError("TDS rate is required.");
      return;
    }

    const payload = {
      vendor_id: editingId,
      tds_section: tdsSection.trim(),
      tds_rate: Number(tdsRate) || 0,
      threshold_amount: tdsThreshold.trim() ? Number(tdsThreshold) : null,
      effective_from: tdsEffectiveFrom || new Date().toISOString().slice(0, 10),
      effective_to: tdsEffectiveTo || null,
    };

    const { error: upsertError } = await supabase.rpc("erp_vendor_tds_profile_upsert", {
      p_profile: payload,
    });

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setTdsSection("194C");
    setTdsRate("");
    setTdsThreshold("");
    setTdsEffectiveFrom("");
    setTdsEffectiveTo("");
    await loadTdsProfiles(editingId);
  }

  async function handleTdsVoid(profileId: string) {
    if (!profileId) return;
    const { error: voidError } = await supabase.rpc("erp_vendor_tds_profile_void", {
      p_profile_id: profileId,
      p_reason: "Voided from vendor master",
    });

    if (voidError) {
      setError(voidError.message);
      return;
    }

    if (editingId) {
      await loadTdsProfiles(editingId);
    }
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

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div>
        ) : null}

        {toast ? (
          <div
            style={{
              ...cardStyle,
              borderColor: toast.type === "success" ? "#86efac" : "#fecaca",
              color: toast.type === "success" ? "#166534" : "#b91c1c",
              background: toast.type === "success" ? "#ecfdf5" : "#fef2f2",
              fontWeight: 600,
            }}
          >
            {toast.message}
          </div>
        ) : null}

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
                <select
                  style={inputStyle}
                  value={isActive ? "yes" : "no"}
                  onChange={(e) => setIsActive(e.target.value === "yes")}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              Address Notes
              <textarea style={{ ...inputStyle, minHeight: 80 }} value={address} onChange={(e) => setAddress(e.target.value)} />
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

          {editingId ? (
            <div style={{ marginTop: 18, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Portal Access</h3>
              {(() => {
                const vendor = vendors.find((v) => v.id === editingId);
                return (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        marginBottom: 12,
                      }}
                    >
                      <div>Vendor Code: {vendor?.vendor_code || "—"}</div>
                      <div>Portal Enabled: {vendor?.portal_enabled ? "Yes" : "No"}</div>
                      <div>Status: {vendor?.portal_status || "disabled"}</div>
                    </div>

                    <div style={{ display: "flex", gap: 12 }}>
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        onClick={handlePortalEnable}
                        disabled={!canWrite || portalLoading}
                      >
                        {portalLoading ? "Working..." : "Generate Access / Reset Portal Password"}
                      </button>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={handlePortalDisable}
                        disabled={!canWrite || portalLoading}
                      >
                        Disable Access
                      </button>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={handleSyncSkuAssignmentsFromPo}
                        disabled={!canWrite || syncingPoSkus}
                        title="Populate vendor SKU assignments from historical approved/received POs"
                      >
                        {syncingPoSkus ? "Syncing..." : "Sync SKUs from POs"}
                      </button>
                    </div>

                    <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>Vendor Logo</div>
                      <div
                        style={{
                          width: 240,
                          height: 80,
                          borderRadius: 8,
                          border: "1px dashed #d1d5db",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#f8fafc",
                          overflow: "hidden",
                        }}
                      >
                        {portalLogoPreview ? (
                          <img src={portalLogoPreview} alt="Vendor logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                        ) : (
                          <span style={{ color: "#6b7280", fontSize: 12 }}>No vendor logo uploaded</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            setPortalLogoFile(file);
                            if (file) setPortalLogoPreview(URL.createObjectURL(file));
                          }}
                        />
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={handlePortalLogoUpload}
                          disabled={!canWrite || portalLogoUploading}
                        >
                          {portalLogoUploading ? "Uploading..." : "Upload Vendor Logo"}
                        </button>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={handlePortalLogoRemove}
                          disabled={!canWrite || portalLogoUploading}
                        >
                          Remove Logo
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {portalVendorCode || portalTempPassword ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #bfdbfe",
                    background: "#eff6ff",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Portal credentials (shown once):</div>
                  <div style={{ marginTop: 4 }}>Vendor Code: {portalVendorCode || "—"}</div>
                  {portalTempPassword ? (
                    <>
                      <div style={{ marginTop: 4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        Temporary password: {portalTempPassword}
                      </div>
                      <div style={{ marginTop: 4 }}>Login URL: /mfg/login</div>
                      <button
                        type="button"
                        style={{ ...secondaryButtonStyle, marginTop: 10 }}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(portalTempPassword ?? "");
                            setToast({ type: "success", message: "Temporary password copied." });
                          } catch (err) {
                            const message = err instanceof Error ? err.message : "Failed to copy temporary password";
                            setToast({ type: "error", message });
                          }
                        }}
                      >
                        Copy password
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Vendor TDS Profile</h2>
          {editingId ? (
            <form onSubmit={handleTdsProfileSubmit} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  Section
                  <select style={inputStyle} value={tdsSection} onChange={(e) => setTdsSection(e.target.value)}>
                    {["194C", "194I", "194A", "194J", "194JB"].map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Rate (%)
                  <input style={inputStyle} value={tdsRate} onChange={(e) => setTdsRate(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Threshold
                  <input style={inputStyle} value={tdsThreshold} onChange={(e) => setTdsThreshold(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Effective From
                  <input style={inputStyle} type="date" value={tdsEffectiveFrom} onChange={(e) => setTdsEffectiveFrom(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  Effective To
                  <input style={inputStyle} type="date" value={tdsEffectiveTo} onChange={(e) => setTdsEffectiveTo(e.target.value)} />
                </label>
              </div>
              <div>
                <button type="submit" style={primaryButtonStyle}>
                  Save TDS Profile
                </button>
              </div>
            </form>
          ) : (
            <p style={{ marginTop: 0 }}>Select a vendor to manage TDS profiles.</p>
          )}

          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Section</th>
                  <th style={tableHeaderCellStyle}>Rate (%)</th>
                  <th style={tableHeaderCellStyle}>Threshold</th>
                  <th style={tableHeaderCellStyle}>Effective From</th>
                  <th style={tableHeaderCellStyle}>Effective To</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tdsProfiles.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No TDS profiles yet.
                    </td>
                  </tr>
                ) : (
                  tdsProfiles.map((profile) => (
                    <tr key={profile.profile_id}>
                      <td style={tableCellStyle}>{profile.tds_section}</td>
                      <td style={tableCellStyle}>{profile.tds_rate}</td>
                      <td style={tableCellStyle}>{profile.threshold_amount ?? "—"}</td>
                      <td style={tableCellStyle}>{profile.effective_from}</td>
                      <td style={tableCellStyle}>{profile.effective_to ?? "—"}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        <button type="button" style={secondaryButtonStyle} onClick={() => handleTdsVoid(profile.profile_id)}>
                          Void
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
