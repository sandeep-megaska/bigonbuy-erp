import type { CSSProperties } from "react";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";

type ErpDocumentHeaderProps = {
  title: string;
  tag?: string;
  subtitle?: string;
  gstin?: string | null;
  stateLabel?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWebsite?: string | null;
  qrCodeUrl?: string | null;
};

export default function ErpDocumentHeader({
  title,
  tag = "",
  subtitle,
  gstin,
  stateLabel,
  contactEmail,
  contactPhone,
  contactWebsite,
  qrCodeUrl,
}: ErpDocumentHeaderProps) {
  const branding = useCompanyBranding();
  const companyName = branding?.companyName || branding?.legalName || "Company";
  const legalName = branding?.legalName || companyName;
  const logoUrl = branding?.bigonbuyLogoUrl ?? null;
  const contactItems = [contactPhone, contactEmail, contactWebsite].filter((item) => item && item.trim().length > 0);

  return (
    <div style={headerWrapStyle} className="erp-document-header">
      <div style={headerTopStyle}>
        <div style={brandBlockStyle}>
          {logoUrl ? (
            <img src={logoUrl} alt={`${companyName} logo`} style={logoStyle} />
          ) : (
            <div style={logoFallbackStyle}>{companyName.slice(0, 10).toUpperCase()}</div>
          )}
          <div>
            <div style={companyNameStyle}>{legalName}</div>
            {subtitle ? <div style={subtitleStyle}>{subtitle}</div> : null}
            <div style={gstinStyle}>GSTIN: {gstin || "—"}</div>
            {stateLabel ? <div style={stateStyle}>State: {stateLabel}</div> : null}
          </div>
        </div>
        <div style={titleBlockStyle}>
          <div style={titleStyle}>{title}</div>
          {tag ? <div style={tagStyle}>{tag}</div> : null}
        </div>
        <div style={qrBlockStyle}>
          {qrCodeUrl ? <img src={qrCodeUrl} alt="Invoice QR" style={qrStyle} /> : null}
        </div>
      </div>
      {contactItems.length ? (
        <div style={contactRowStyle}>
          {contactItems.map((item, index) => (
            <span key={`${item}-${index}`}>
              {item}
              {index < contactItems.length - 1 ? " | " : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const headerWrapStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "16px 18px",
  background: "#f8fafc",
};

const headerTopStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 1.2fr) minmax(200px, 1fr) minmax(80px, 0.4fr)",
  gap: 12,
  alignItems: "center",
};

const brandBlockStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const logoStyle: CSSProperties = {
  width: 88,
  height: 88,
  objectFit: "contain",
  borderRadius: 10,
  background: "#fff",
  border: "1px solid #e2e8f0",
};

const logoFallbackStyle: CSSProperties = {
  width: 88,
  height: 88,
  borderRadius: 10,
  background: "#0f172a",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
};

const companyNameStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#0f172a",
};

const subtitleStyle: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 2,
};

const gstinStyle: CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  fontWeight: 600,
  color: "#0f172a",
};

const stateStyle: CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginTop: 2,
};

const titleBlockStyle: CSSProperties = {
  textAlign: "center",
};

const titleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
};

const tagStyle: CSSProperties = {
  display: "inline-block",
  marginTop: 6,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid #0f172a",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  textTransform: "uppercase",
};

const qrBlockStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const qrStyle: CSSProperties = {
  width: 74,
  height: 74,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
};

const contactRowStyle: CSSProperties = {
  marginTop: 10,
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 12,
  color: "#475569",
  borderTop: "1px dashed #cbd5f5",
  paddingTop: 8,
};
