import { buildApiUrl, getBasePath } from "../../lib/erp/apiFetch";

export default function FinanceDiagnosticsBanner() {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const basePath = getBasePath();
  const sampleUrl = buildApiUrl("/api/erp/finance/reports/trial-balance");

  return (
    <div
      style={{
        marginBottom: 12,
        padding: "8px 12px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        color: "#1e40af",
        fontSize: 12,
      }}
    >
      <strong>Finance API diagnostics:</strong> basePath={basePath || "(none)"} · sample={sampleUrl}
    </div>
  );
}
