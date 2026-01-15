import type { CSSProperties } from "react";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";

export default function ReportBrandHeader() {
  const branding = useCompanyBranding();
const branding = useCompanyBranding();
const companyName = branding?.companyName || "Company";
const bigonbuyLogoUrl = branding?.bigonbuyLogoUrl ?? null;
const megaskaLogoUrl = branding?.megaskaLogoUrl ?? null;

  return (
    <div style={brandRowStyle}>
      <div style={brandLeftStyle}>
        {branding?.bigonbuyLogoUrl ? (
          <img src={branding.bigonbuyLogoUrl} alt="Bigonbuy logo" style={bigonbuyLogoStyle} />
        ) : (
          <div style={logoFallbackStyle}>BIGONBUY</div>
        )}
        <div>
          <p style={companyNameStyle}>{branding?.companyName || "Company"}</p>
          <p style={companySubtitleStyle}>HR Reports</p>
        </div>
      </div>
      {branding?.megaskaLogoUrl ? (
        <img src={branding.megaskaLogoUrl} alt="Megaska logo" style={megaskaLogoStyle} />
      ) : null}
    </div>
  );
}

const brandRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 16px",
  marginBottom: 20,
  backgroundColor: "#fff",
  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
};

const brandLeftStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const bigonbuyLogoStyle: CSSProperties = {
  height: 40,
  width: "auto",
  objectFit: "contain",
};

const megaskaLogoStyle: CSSProperties = {
  height: 32,
  width: "auto",
  objectFit: "contain",
};

const logoFallbackStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 11,
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const companyNameStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: "#111827",
};

const companySubtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 11,
  color: "#6b7280",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
