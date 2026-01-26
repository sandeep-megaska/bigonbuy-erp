import type { CSSProperties } from "react";
import { useCompanyBranding } from "../../lib/erp/useCompanyBranding";

type ErpDocumentFooterProps = {
  addressLines?: string[];
  gstin?: string | null;
  note?: string;
};

export default function ErpDocumentFooter({ addressLines, gstin, note }: ErpDocumentFooterProps) {
  const branding = useCompanyBranding();
  const fallbackAddress = (branding?.addressText || branding?.poFooterAddressText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = addressLines && addressLines.length > 0 ? addressLines : fallbackAddress;

  return (
    <footer style={footerStyle} className="erp-document-footer">
      <div style={footerBlockStyle}>
        <div style={footerTextStyle}>{lines.length ? lines.join("\n") : "—"}</div>
        <div style={footerTextStyle}>GSTIN: {gstin || branding?.gstin || "—"}</div>
      </div>
      <div style={noteStyle}>{note}</div>
      <div style={pageStyle}>
        Page <span className="pageNumber"></span> / <span className="totalPages"></span>
      </div>
    </footer>
  );
}

const footerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  borderTop: "1px solid #e2e8f0",
  paddingTop: 12,
  marginTop: 18,
  fontSize: 11,
  color: "#475569",
};

const footerBlockStyle: CSSProperties = {
  whiteSpace: "pre-line",
};

const footerTextStyle: CSSProperties = {
  marginBottom: 4,
};

const noteStyle: CSSProperties = {
  alignSelf: "end",
  fontStyle: "italic",
  color: "#64748b",
  textAlign: "right",
};

const pageStyle: CSSProperties = {
  gridColumn: "1 / -1",
  textAlign: "right",
  color: "#94a3b8",
  marginTop: 4,
};
