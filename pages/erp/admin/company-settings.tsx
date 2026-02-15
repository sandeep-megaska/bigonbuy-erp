import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useRouter } from "next/router";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";
import {
  getCompanyLogosSignedUrlsIfNeeded,
  getCompanySettings,
  updateCompanySettings,
  uploadCompanyLogo,
  type CompanySettings,
} from "../../../lib/erp/companySettings";

type CompanyProfile = {
  id: string;
  name?: string | null;
  legal_name?: string | null;
  brand_name?: string | null;
  country_code?: string | null;
  currency_code?: string | null;
};

type GstStateOption = {
  code: string;
  name: string;
};

export default function CompanySettingsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [accessToken, setAccessToken] = useState("");
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [logos, setLogos] = useState({ bigonbuyUrl: null as string | null, megaskaUrl: null as string | null });
  const [designationCount, setDesignationCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"bigonbuy" | "megaska" | null>(null);
  const [bigonbuyFile, setBigonbuyFile] = useState<File | null>(null);
  const [megaskaFile, setMegaskaFile] = useState<File | null>(null);
  const [bigonbuyPreview, setBigonbuyPreview] = useState<string | null>(null);
  const [megaskaPreview, setMegaskaPreview] = useState<string | null>(null);
  const [poLegalName, setPoLegalName] = useState("");
  const [companyGstin, setCompanyGstin] = useState("");
  const [poAddressText, setPoAddressText] = useState("");
  const [poTermsText, setPoTermsText] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [gstStateOptions, setGstStateOptions] = useState<GstStateOption[]>([]);
  const [gstStateCode, setGstStateCode] = useState("");
  const [gstStateName, setGstStateName] = useState("");
  const [gstSaving, setGstSaving] = useState(false);
  const [gstToast, setGstToast] = useState<string | null>(null);

  const canEdit = useMemo(() => isAdmin(ctx?.roleKey || access.roleKey), [access.roleKey, ctx?.roleKey]);
  const gstinIsValid = useMemo(() => {
    if (!companyGstin.trim()) return true;
    const normalized = companyGstin.trim().toUpperCase();
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized);
  }, [companyGstin]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      setAccessToken(session.access_token || "");

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !canEdit) return;
    void loadCompanyData(ctx.companyId);
  }, [ctx?.companyId, canEdit]);

  useEffect(() => {
    if (!gstToast) return;
    const timer = window.setTimeout(() => setGstToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [gstToast]);

  async function loadCompanyData(companyId: string) {
    setError("");
    try {
      const [companyRes, settingsRes, logoRes, designationRes, statesRes, gstRes] = await Promise.all([
        supabase
          .from("erp_companies")
          .select("id, name, legal_name, brand_name, country_code, currency_code, secondary_logo_path")
          .eq("id", companyId)
          .maybeSingle(),
        getCompanySettings(),
        getCompanyLogosSignedUrlsIfNeeded(),
        supabase.from("erp_designations").select("id", { count: "exact", head: true }),
        supabase.rpc("erp_ref_india_states_list"),
        supabase.rpc("erp_company_gst_profile"),
      ]);

      if (companyRes.error) {
        throw new Error(companyRes.error.message);
      }
      if (statesRes.error) {
        throw new Error(statesRes.error.message);
      }
      if (gstRes.error) {
        throw new Error(gstRes.error.message);
      }

      setCompany(companyRes.data as CompanyProfile);
      setSettings(settingsRes);
      setLogos({
        bigonbuyUrl: logoRes.bigonbuyUrl,
        megaskaUrl: logoRes.megaskaUrl,
      });
      setDesignationCount(designationRes.count || 0);
      setBigonbuyPreview(logoRes.bigonbuyUrl);
      const companySecondary = (companyRes.data as any)?.secondary_logo_path || null;
      const companySecondaryUrl = companySecondary
        ? supabase.storage.from("erp-assets").getPublicUrl(companySecondary).data.publicUrl
        : null;
      setMegaskaPreview(companySecondaryUrl);
      setPoLegalName(settingsRes?.legal_name || "");
      const stateOptions = (statesRes.data ?? []) as GstStateOption[];
      const gstProfile = (gstRes.data ?? null) as {
        gst_state_code?: string | null;
        gst_state_name?: string | null;
        gstin?: string | null;
      } | null;
      const resolvedStateCode = gstProfile?.gst_state_code ?? "";
      const resolvedStateName =
        gstProfile?.gst_state_name ?? stateOptions.find((state) => state.code === resolvedStateCode)?.name ?? "";
      setGstStateOptions(stateOptions);
      setGstStateCode(resolvedStateCode);
      setGstStateName(resolvedStateName);
      setCompanyGstin(gstProfile?.gstin ?? settingsRes?.gstin ?? "");
      setPoAddressText(settingsRes?.address_text || settingsRes?.po_footer_address_text || "");
      setPoTermsText(settingsRes?.po_terms_text || "");
      setContactEmail(settingsRes?.contact_email || "");
      setContactPhone(settingsRes?.contact_phone || "");
      setCompanyWebsite(settingsRes?.website || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load company settings.");
    }
  }

  async function handleSaveCompany() {
    if (!company || !ctx?.companyId) return;
    setSaving(true);
    setError("");

    try {
      const payload = {
        legal_name: company.legal_name || null,
        brand_name: company.brand_name || null,
        country_code: company.country_code || null,
        currency_code: company.currency_code || null,
        name: company.legal_name || company.brand_name || company.name || null,
      };

      const { error: updateError } = await supabase.rpc("erp_company_update_profile", {
        p_company_id: ctx.companyId,
        p_name: payload.name,
        p_legal_name: payload.legal_name,
        p_brand_name: payload.brand_name,
        p_country_code: payload.country_code,
        p_currency_code: payload.currency_code,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update company details.");
    } finally {
      setSaving(false);
    }
  }

  async function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        resolve(value.includes(",") ? value.split(",")[1] : value);
      };
      reader.onerror = () => reject(new Error("Failed to read logo file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleUpload(kind: "bigonbuy" | "megaska") {
    const file = kind === "bigonbuy" ? bigonbuyFile : megaskaFile;
    if (!file) {
      setError("Select a logo file to upload.");
      return;
    }

    setUploading(kind);
    setError("");

    try {
      if (kind === "bigonbuy") {
        const path = await uploadCompanyLogo(kind, file);
        const updated = await updateCompanySettings({ bigonbuy_logo_path: path, updated_by: ctx?.userId ?? null });
        const logosRes = await getCompanyLogosSignedUrlsIfNeeded();
        setSettings(updated || settings);
        setLogos({
          bigonbuyUrl: logosRes.bigonbuyUrl,
          megaskaUrl: logosRes.megaskaUrl,
        });
        setBigonbuyPreview(logosRes.bigonbuyUrl);
        setBigonbuyFile(null);
      } else {
        if (!accessToken) throw new Error("Missing access token. Please reload.");
        const fileBase64 = await fileToBase64(file);
        const response = await fetch("/api/admin/company/upload-secondary-logo", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file_base64: fileBase64,
            filename: file.name,
            mime_type: file.type || "image/png",
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Failed to upload secondary logo.");
        }
        setMegaskaPreview(payload.public_url || null);
        setMegaskaFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo.");
    } finally {
      setUploading(null);
    }
  }

  async function handleMarkSetupComplete() {
    setSaving(true);
    setError("");

    try {
      const updated = await updateCompanySettings({
        setup_completed: true,
        setup_completed_at: new Date().toISOString(),
        updated_by: ctx?.userId ?? null,
      });
      setSettings(updated || settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update setup completion.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePoBranding() {
    setSaving(true);
    setError("");

    try {
      const updated = await updateCompanySettings({
        legal_name: poLegalName.trim() || null,
        gstin: companyGstin.trim() || null,
        address_text: poAddressText.trim() || null,
        po_terms_text: poTermsText.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        website: companyWebsite.trim() || null,
        updated_by: ctx?.userId ?? null,
      });
      setSettings(updated || settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update purchase order branding.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGstSettings() {
    setGstSaving(true);
    setError("");
    setGstToast(null);

    try {
      const selectedState = gstStateOptions.find((state) => state.code === gstStateCode);
      const resolvedStateName = gstStateName || selectedState?.name || "";
      const { error: updateError } = await supabase.rpc("erp_company_update_gst", {
        p_gst_state_code: gstStateCode || null,
        p_gst_state_name: resolvedStateName || null,
        p_gstin: companyGstin.trim() || null,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }

      setGstStateName(resolvedStateName);
      setGstToast("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update GST settings.");
    } finally {
      setGstSaving(false);
    }
  }

  const checklist = [
    {
      label: "Legal or brand name set",
      done: Boolean(company?.legal_name || company?.brand_name || company?.name),
    },
    {
      label: "Bigonbuy logo uploaded",
      done: Boolean(settings?.bigonbuy_logo_path),
    },
    {
      label: "At least one designation configured",
      done: designationCount > 0,
    },
  ];

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading company settings…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Company Settings</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  if (!canEdit) {
    return (
      <>
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Company Settings</h1>
          <p style={{ color: "#b91c1c" }}>Only owner/admin users can access this page.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>Admin</p>
            <h1 style={h1Style}>Company Settings</h1>
            <p style={subtitleStyle}>
              Configure organization details, brand logos, and go-live readiness.
            </p>
          </div>
        </header>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

      <section style={cardStyle}>
        <h2 style={h2Style}>Organization Details</h2>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Legal Name</label>
            <input
              style={inputStyle}
              value={company?.legal_name || ""}
              onChange={(event) =>
                setCompany((prev) => (prev ? { ...prev, legal_name: event.target.value } : prev))
              }
              placeholder="Bigonbuy Trading Private Limited"
            />
          </div>
          <div>
            <label style={labelStyle}>Brand Name</label>
            <input
              style={inputStyle}
              value={company?.brand_name || ""}
              onChange={(event) =>
                setCompany((prev) => (prev ? { ...prev, brand_name: event.target.value } : prev))
              }
              placeholder="Megaska"
            />
          </div>
          <div>
            <label style={labelStyle}>Country Code</label>
            <input
              style={inputStyle}
              value={company?.country_code || ""}
              onChange={(event) =>
                setCompany((prev) => (prev ? { ...prev, country_code: event.target.value } : prev))
              }
              placeholder="IN"
            />
          </div>
          <div>
            <label style={labelStyle}>Currency Code</label>
            <input
              style={inputStyle}
              value={company?.currency_code || ""}
              onChange={(event) =>
                setCompany((prev) => (prev ? { ...prev, currency_code: event.target.value } : prev))
              }
              placeholder="INR"
            />
          </div>
        </div>
        <button type="button" style={primaryButtonStyle} onClick={handleSaveCompany} disabled={saving}>
          {saving ? "Saving…" : "Save Organization Details"}
        </button>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Logos</h2>
        <div style={logoGridStyle}>
          <div style={logoCardStyle}>
            <div>
              <p style={logoLabelStyle}>BIGONBUY Logo</p>
              <p style={logoHintStyle}>Shown in the ERP navigation and report headers.</p>
            </div>
            <div style={logoPreviewStyle}>
              {bigonbuyPreview ? (
                <img src={bigonbuyPreview} alt="Bigonbuy logo preview" style={logoImageStyle} />
              ) : (
                <span style={logoFallbackTextStyle}>No logo uploaded</span>
              )}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setBigonbuyFile(file);
                setBigonbuyPreview(file ? URL.createObjectURL(file) : logos.bigonbuyUrl);
              }}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => handleUpload("bigonbuy")}
              disabled={uploading === "bigonbuy"}
            >
              {uploading === "bigonbuy" ? "Uploading…" : "Upload BIGONBUY Logo"}
            </button>
          </div>
          <div style={logoCardStyle}>
            <div>
              <p style={logoLabelStyle}>Secondary Logo</p>
              <p style={logoHintStyle}>Shown on vendor portal header.</p>
            </div>
            <div style={logoPreviewStyle}>
              {megaskaPreview ? (
                <img src={megaskaPreview} alt="Megaska logo preview" style={logoImageStyle} />
              ) : (
                <span style={logoFallbackTextStyle}>No logo uploaded</span>
              )}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setMegaskaFile(file);
                setMegaskaPreview(file ? URL.createObjectURL(file) : logos.megaskaUrl);
              }}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => handleUpload("megaska")}
              disabled={uploading === "megaska"}
            >
              {uploading === "megaska" ? "Uploading…" : "Upload Secondary Logo"}
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>GST Settings</h2>
        <p style={{ marginTop: 4, color: "#6b7280" }}>
          Used for invoice GST calculations and printed invoice details.
        </p>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>GST State</label>
            <select
              style={inputStyle}
              value={gstStateCode}
              onChange={(event) => {
                const nextCode = event.target.value;
                const selectedState = gstStateOptions.find((state) => state.code === nextCode);
                setGstStateCode(nextCode);
                setGstStateName(selectedState?.name ?? "");
                setGstToast(null);
              }}
            >
              <option value="">Select a state</option>
              {gstStateOptions.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.code} - {state.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>GSTIN (optional)</label>
            <input
              style={inputStyle}
              value={companyGstin}
              onChange={(event) => setCompanyGstin(event.target.value)}
              placeholder="22AAAAA0000A1Z5"
            />
          </div>
        </div>
        {gstToast ? <div style={successToastStyle}>{gstToast}</div> : null}
        <button type="button" style={primaryButtonStyle} onClick={handleSaveGstSettings} disabled={gstSaving}>
          {gstSaving ? "Saving…" : "Save GST Settings"}
        </button>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Purchase Order Branding</h2>
        <p style={{ marginTop: 4, color: "#6b7280" }}>
          These details appear on vendor-facing purchase orders and PDFs.
        </p>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Legal Name (for PO header)</label>
            <input
              style={inputStyle}
              value={poLegalName}
              onChange={(event) => setPoLegalName(event.target.value)}
              placeholder="Bigonbuy Trading Private Limited"
            />
          </div>
          <div>
            <label style={labelStyle}>GSTIN</label>
            <input
              style={inputStyle}
              value={companyGstin}
              onChange={(event) => setCompanyGstin(event.target.value)}
              placeholder="22AAAAA0000A1Z5"
            />
            {!gstinIsValid ? (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b91c1c" }}>
                GSTIN format looks unusual. Please double-check.
              </p>
            ) : null}
          </div>
        </div>
        <label style={labelStyle}>Address (multiline)</label>
        <textarea
          style={{ ...inputStyle, minHeight: 100 }}
          value={poAddressText}
          onChange={(event) => setPoAddressText(event.target.value)}
          placeholder="123 Warehouse Lane&#10;Mumbai, Maharashtra 400001&#10;India"
        />
        <label style={labelStyle}>Default PO Terms</label>
        <textarea
          style={{ ...inputStyle, minHeight: 100 }}
          value={poTermsText}
          onChange={(event) => setPoTermsText(event.target.value)}
          placeholder="• Deliver within 10 business days\n• Payment due in 30 days\n• Inspect goods upon receipt"
        />
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Contact Email</label>
            <input
              style={inputStyle}
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="accounts@company.com"
              type="email"
            />
          </div>
          <div>
            <label style={labelStyle}>Contact Phone</label>
            <input
              style={inputStyle}
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div>
            <label style={labelStyle}>Website</label>
            <input
              style={inputStyle}
              value={companyWebsite}
              onChange={(event) => setCompanyWebsite(event.target.value)}
              placeholder="https://www.company.com"
            />
          </div>
        </div>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: "#f8fafc" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "#111827" }}>Preview</p>
          <p style={{ margin: 0, color: "#111827", fontWeight: 600 }}>{poLegalName || "Legal name"}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
            GSTIN: {companyGstin || "—"}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280", whiteSpace: "pre-line" }}>
            {poAddressText || "Address line 1\nCity, State ZIP\nCountry"}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#6b7280" }}>
            {contactEmail || "email@example.com"} · {companyWebsite || "www.company.com"} ·{" "}
            {contactPhone || "+91 98765 43210"}
          </p>
        </div>
        <button type="button" style={primaryButtonStyle} onClick={handleSavePoBranding} disabled={saving}>
          {saving ? "Saving…" : "Save Purchase Order Branding"}
        </button>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Setup Checklist</h2>
        <div style={checklistStyle}>
          {checklist.map((item) => (
            <div key={item.label} style={checklistItemStyle}>
              <span style={item.done ? checklistDoneStyle : checklistPendingStyle}>
                {item.done ? "✓" : "•"}
              </span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div style={setupFooterStyle}>
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>
              Setup status: {settings?.setup_completed ? "Completed" : "In progress"}
            </p>
            {settings?.setup_completed_at ? (
              <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                Completed on {new Date(settings.setup_completed_at).toLocaleString()}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleMarkSetupComplete}
            disabled={saving || Boolean(settings?.setup_completed)}
          >
            {settings?.setup_completed ? "Setup Completed" : "Mark Setup Complete"}
          </button>
        </div>
      </section>
      </div>
    </>
  );
}

const headerStyle: CSSProperties = {
  ...pageHeaderStyle,
};

const cardStyle: CSSProperties = {
  ...sharedCardStyle,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  marginBottom: 16,
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 8,
  color: "#374151",
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #d1d5db",
};

const successToastStyle: CSSProperties = {
  margin: "0 0 12px",
  padding: "8px 12px",
  borderRadius: 8,
  backgroundColor: "#dcfce7",
  color: "#166534",
  fontSize: 13,
  fontWeight: 600,
};

const logoGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 20,
};

const logoCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
};

const logoPreviewStyle: CSSProperties = {
  border: "1px dashed #cbd5f5",
  borderRadius: 10,
  padding: 16,
  minHeight: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#f8fafc",
};

const logoImageStyle: CSSProperties = {
  maxHeight: 80,
  maxWidth: "100%",
  objectFit: "contain" as const,
};

const logoLabelStyle: CSSProperties = {
  margin: 0,
  fontWeight: 700,
  color: "#111827",
};

const logoHintStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "#6b7280",
};

const logoFallbackTextStyle: CSSProperties = {
  color: "#9ca3af",
  fontSize: 13,
};

const checklistStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
  marginBottom: 16,
};

const checklistItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 14,
  color: "#111827",
};

const checklistDoneStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: "50%",
  backgroundColor: "#dcfce7",
  color: "#166534",
  fontWeight: 700,
};

const checklistPendingStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: "50%",
  backgroundColor: "#e5e7eb",
  color: "#6b7280",
  fontWeight: 700,
};

const setupFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap" as const,
};
