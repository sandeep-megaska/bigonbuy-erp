import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type SettlementReportSummary = {
  reportId: string;
  createdTime?: string;
  processingStatus?: string;
  marketplaceIds?: string[];
};

type SettlementPreview = {
  report: {
    reportId: string;
    createdTime?: string;
    processingStatus?: string;
  };
  rawHeader: string[];
  columns: string[];
  rows: Record<string, string>[];
  totalsByCurrency: Record<string, number>;
  rowCount: number;
  sampleCount: number;
};

const statusTone: Record<string, { backgroundColor: string; color: string }> = {
  DONE: { backgroundColor: "#dcfce7", color: "#166534" },
  IN_PROGRESS: { backgroundColor: "#fef3c7", color: "#92400e" },
  IN_QUEUE: { backgroundColor: "#e0e7ff", color: "#3730a3" },
  CANCELLED: { backgroundColor: "#fee2e2", color: "#991b1b" },
  FATAL: { backgroundColor: "#fee2e2", color: "#991b1b" },
  DONE_NO_DATA: { backgroundColor: "#e5e7eb", color: "#4b5563" },
};

const previewTableWrapperStyle: React.CSSProperties = {
  overflowX: "auto",
};

const metadataGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#111827",
  margin: 0,
};

const errorTextStyle: React.CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: 14,
};

const emptyStateStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 14,
  margin: 0,
};

const rawHeaderStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  maxHeight: 200,
  overflow: "auto",
};

const totalsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AmazonSettlementReportsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<SettlementReportSummary[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const totalsEntries = useMemo(() => {
    if (!preview) return [];
    return Object.entries(preview.totalsByCurrency);
  }, [preview]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;
      const companyContext = await getCompanyContext(session);
      if (!active) return;
      setCtx({
        companyId: companyContext.companyId,
        roleKey: companyContext.roleKey,
        membershipError: companyContext.membershipError,
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadReports = async (token?: string) => {
    setIsLoadingReports(true);
    setReportError(null);

    try {
      const params = new URLSearchParams();
      if (token) params.set("nextToken", token);
      const response = await fetch(`/api/finance/amazon/settlements?${params.toString()}`);
      const json = (await response.json()) as {
        ok: boolean;
        reports?: SettlementReportSummary[];
        nextToken?: string;
        error?: string;
      };

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load settlement reports.");
      }

      setReports((current) => (token ? [...current, ...(json.reports ?? [])] : json.reports ?? []));
      setNextToken(json.nextToken ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load reports.";
      setReportError(message);
    } finally {
      setIsLoadingReports(false);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadReports();
  }, [ctx?.companyId]);

  const handlePreview = async (reportId: string) => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    try {
      const response = await fetch(`/api/finance/amazon/settlements/${reportId}`);
      const json = (await response.json()) as { ok: boolean; error?: string } & SettlementPreview;
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Unable to preview report.");
      }
      setPreview(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to preview report.";
      setPreviewError(message);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading settlement reports…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Amazon Settlements (India)"
            description="Preview Amazon settlement flat-file reports without importing data."
          />
          <p style={errorTextStyle}>{ctx?.membershipError || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Amazon Settlements (India)"
          description="Review settlement reports, download previews, and inspect totals."
          rightActions={
            <button style={secondaryButtonStyle} onClick={() => loadReports()}>
              Refresh list
            </button>
          }
        />

        {reportError ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2" }}>
            <p style={errorTextStyle}>{reportError}</p>
          </div>
        ) : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Available settlement reports</h2>
          {reports.length === 0 && !isLoadingReports ? (
            <p style={emptyStateStyle}>No settlement reports available yet.</p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Report ID</th>
                  <th style={tableHeaderCellStyle}>Created</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Marketplace</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => {
                  const tone = statusTone[report.processingStatus ?? ""] ?? badgeStyle;
                  return (
                    <tr key={report.reportId}>
                      <td style={tableCellStyle}>{report.reportId}</td>
                      <td style={tableCellStyle}>{formatDateTime(report.createdTime)}</td>
                      <td style={tableCellStyle}>
                        <span style={{ ...badgeStyle, ...tone }}>
                          {report.processingStatus ?? "UNKNOWN"}
                        </span>
                      </td>
                      <td style={tableCellStyle}>
                        {(report.marketplaceIds ?? []).length > 0
                          ? report.marketplaceIds?.join(", ")
                          : "—"}
                      </td>
                      <td style={tableCellStyle}>
                        <button
                          style={primaryButtonStyle}
                          onClick={() => handlePreview(report.reportId)}
                          disabled={isLoadingPreview}
                        >
                          Preview
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {isLoadingReports ? (
            <p style={{ marginTop: 12, color: "#6b7280" }}>Loading reports…</p>
          ) : null}

          {nextToken ? (
            <button
              style={{ ...secondaryButtonStyle, marginTop: 12 }}
              onClick={() => loadReports(nextToken)}
              disabled={isLoadingReports}
            >
              Load more
            </button>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Preview</h2>
          {previewError ? <p style={errorTextStyle}>{previewError}</p> : null}
          {isLoadingPreview ? <p style={{ color: "#6b7280" }}>Loading preview…</p> : null}

          {!preview && !previewError && !isLoadingPreview ? (
            <p style={emptyStateStyle}>Select a settlement report to preview details.</p>
          ) : null}

          {preview ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={metadataGridStyle}>
                <div>
                  <div style={labelStyle}>Report ID</div>
                  <p style={valueStyle}>{preview.report.reportId}</p>
                </div>
                <div>
                  <div style={labelStyle}>Created</div>
                  <p style={valueStyle}>{formatDateTime(preview.report.createdTime)}</p>
                </div>
                <div>
                  <div style={labelStyle}>Status</div>
                  <p style={valueStyle}>{preview.report.processingStatus ?? "UNKNOWN"}</p>
                </div>
                <div>
                  <div style={labelStyle}>Rows</div>
                  <p style={valueStyle}>
                    {preview.sampleCount} / {preview.rowCount}
                  </p>
                </div>
              </div>

              <div>
                <div style={labelStyle}>Raw header</div>
                <pre style={rawHeaderStyle}>{preview.rawHeader.join("\n")}</pre>
              </div>

              {totalsEntries.length > 0 ? (
                <div>
                  <div style={labelStyle}>Totals by currency</div>
                  <div style={totalsGridStyle}>
                    {totalsEntries.map(([currency, total]) => (
                      <div key={currency} style={{ ...cardStyle, padding: 12 }}>
                        <div style={labelStyle}>{currency}</div>
                        <p style={valueStyle}>{total.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {preview.columns.length > 0 ? (
                <div style={previewTableWrapperStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        {preview.columns.map((column) => (
                          <th key={column} style={tableHeaderCellStyle}>
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {preview.columns.map((column) => (
                            <td key={`${rowIndex}-${column}`} style={tableCellStyle}>
                              {row[column] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={emptyStateStyle}>No rows detected in preview.</p>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}
