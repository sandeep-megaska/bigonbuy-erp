import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
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

export default function CompanySettingsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
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

  const canEdit = useMemo(() => isAdmin(ctx?.roleKey || access.roleKey), [access.roleKey, ctx?.roleKey]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

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

  async function loadCompanyData(companyId: string) {
    setError("");
    try {
      const [companyRes, settingsRes, logoRes, designationRes] = await Promise.all([
        supabase
          .from("erp_companies")
          .select("id, name, legal_name, brand_name, country_code, currency_code")
          .eq("id", companyId)
          .maybeSingle(),
        getCompanySettings(),
        getCompanyLogosSignedUrlsIfNeeded(),
        supabase.from("erp_designations").select("id", { count: "exact", head: true }),
      ]);

      if (companyRes.error) {
        throw new Error(companyRes.error.message);
      }

      setCompany(companyRes.data as CompanyProfile);
      setSettings(settingsRes);
      setLogos({
        bigonbuyUrl: logoRes.bigonbuyUrl,
        megaskaUrl: logoRes.megaskaUrl,
      });
      setDesignationCount(designationRes.count || 0);
      setBigonbuyPreview(logoRes.bigonbuyUrl);
      setMegaskaPreview(logoRes.megaskaUrl);
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

      const { error: updateError } = await supabase
        .from("erp_companies")
        .update(payload)
        .eq("id", ctx.companyId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update company details.");
    } finally {
      setSaving(false);
    }
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
      const path = await uploadCompanyLogo(kind, file);
      const payload =
        kind === "bigonbuy"
          ? { bigonbuy_logo_path: path, updated_by: ctx?.userId ?? null }
          : { megaska_logo_path: path, updated_by: ctx?.userId ?? null };
      const updated = await updateCompanySettings(payload);
      const logosRes = await getCompanyLogosSignedUrlsIfNeeded();
      setSettings(updated || settings);
      setLogos({
        bigonbuyUrl: logosRes.bigonbuyUrl,
        megaskaUrl: logosRes.megaskaUrl,
      });
      if (kind === "bigonbuy") {
        setBigonbuyPreview(logosRes.bigonbuyUrl);
        setBigonbuyFile(null);
      } else {
        setMegaskaPreview(logosRes.megaskaUrl);
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
    return <div style={pageStyle}>Loading company settings…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={pageStyle}>
        <h1 style={{ marginTop: 0 }}>Company Settings</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div style={pageStyle}>
        <ErpNavBar access={access} roleKey={ctx?.roleKey} />
        <h1 style={{ marginTop: 0 }}>Company Settings</h1>
        <p style={{ color: "#b91c1c" }}>Only owner/admin users can access this page.</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={{ margin: "6px 0 8px" }}>Company Settings</h1>
          <p style={{ margin: 0, color: "#4b5563" }}>
            Configure organization details, brand logos, and go-live readiness.
          </p>
        </div>
      </header>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Organization Details</h2>
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
        <h2 style={sectionTitleStyle}>Logos</h2>
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
              <p style={logoLabelStyle}>Megaska Logo</p>
              <p style={logoHintStyle}>Optional secondary brand mark.</p>
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
              {uploading === "megaska" ? "Uploading…" : "Upload Megaska Logo"}
            </button>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Setup Checklist</h2>
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
            disabled={saving || settings?.setup_completed}
          >
            {settings?.setup_completed ? "Setup Completed" : "Mark Setup Complete"}
          </button>
        </div>
      </section>
    </div>
  );
}

const pageStyle = {
  maxWidth: 1040,
  margin: "80px auto",
  padding: "48px 56px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};


const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  borderBottom: "1px solid #eee",
  paddingBottom: 12,
  marginBottom: 16,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
  backgroundColor: "#f8fafc",
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
};

const sectionTitleStyle = {
  margin: "0 0 16px",
  fontSize: 20,
  color: "#111827",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  marginBottom: 16,
};

const labelStyle = {
  display: "block",
  marginBottom: 8,
  color: "#374151",
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #d1d5db",
};

const primaryButtonStyle = {
  padding: "10px 16px",
  backgroundColor: "#111827",
  color: "#fff",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryButtonStyle = {
  padding: "8px 14px",
  backgroundColor: "#fff",
  color: "#111827",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  cursor: "pointer",
  fontWeight: 600,
};

const logoGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 20,
};

const logoCardStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
};

const logoPreviewStyle = {
  border: "1px dashed #cbd5f5",
  borderRadius: 10,
  padding: 16,
  minHeight: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#f8fafc",
};

const logoImageStyle = {
  maxHeight: 80,
  maxWidth: "100%",
  objectFit: "contain" as const,
};

const logoLabelStyle = {
  margin: 0,
  fontWeight: 700,
  color: "#111827",
};

const logoHintStyle = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "#6b7280",
};

const logoFallbackTextStyle = {
  color: "#9ca3af",
  fontSize: 13,
};

const checklistStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
  marginBottom: 16,
};

const checklistItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 14,
  color: "#111827",
};

const checklistDoneStyle = {
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

const checklistPendingStyle = {
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

const setupFooterStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap" as const,
};
