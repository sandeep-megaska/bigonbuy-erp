import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { downloadCsv } from "../../../../lib/erp/exportCsv";

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

const summaryGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const summaryCardStyle: React.CSSProperties = {
  ...cardStyle,
  padding: 16,
  boxShadow: "none",
};

const summaryMetaStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 6,
};

const filterBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "flex-end",
};

const filterLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  color: "#374151",
};

const filterInlineLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "#374151",
  marginTop: 6,
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function formatTimestampForFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumnName(columns: string[], candidates: string[]) {
  const normalized = columns.map(normalizeHeader);
  for (const candidate of candidates) {
    const matchIndex = normalized.indexOf(normalizeHeader(candidate));
    if (matchIndex >= 0) return columns[matchIndex];
  }
  return null;
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatCurrency(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return "—";
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);
  }
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);
  } catch (error) {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

type SettlementBucket = "Sales" | "Refunds/Returns" | "Fees" | "Withholdings" | "Other";

const bucketLabels: { key: SettlementBucket; label: string }[] = [
  { key: "Sales", label: "Gross Sales" },
  { key: "Refunds/Returns", label: "Refunds / Returns" },
  { key: "Fees", label: "Amazon Fees" },
  { key: "Withholdings", label: "Withholdings" },
  { key: "Other", label: "Other Adjustments" },
];

function classifySettlementBucket(values: {
  amountType?: string;
  amountDescription?: string;
  transactionType?: string;
}): SettlementBucket {
  const joined = `${values.amountType ?? ""} ${values.amountDescription ?? ""} ${
    values.transactionType ?? ""
  }`;
  const raw = joined.toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]/g, "");

  if (normalized.includes("tcs") || normalized.includes("tds") || normalized.includes("itemtds")) {
    return "Withholdings";
  }

  const feeKeywords = [
    "commission",
    "fixedclosingfee",
    "variableclosingfee",
    "fba",
    "shippingchargeback",
    "technologyfee",
    "storagefee",
    "weightbasedfee",
    "removalfee",
    "pickpackfee",
    "fulfillmentfee",
  ];
  if (feeKeywords.some((keyword) => normalized.includes(keyword))) {
    return "Fees";
  }

  if (
    raw.includes("refund") ||
    raw.includes("reversal") ||
    raw.includes("chargeback") ||
    raw.includes("return")
  ) {
    return "Refunds/Returns";
  }

  if (
    normalized.includes("principal") ||
    normalized.includes("shippingcharge") ||
    normalized.includes("giftwrap") ||
    normalized.includes("tax")
  ) {
    return "Sales";
  }

  return "Other";
}

type TotalsByCurrency = Record<
  string,
  {
    net: number;
    lineCount: number;
    bucketTotals: Record<SettlementBucket, number>;
    bucketCounts: Record<SettlementBucket, number>;
  }
>;

function buildTotals(rows: Array<{ amount: number | null; currency: string; bucket: SettlementBucket }>) {
  return rows.reduce<TotalsByCurrency>((acc, row) => {
    if (row.amount === null) return acc;
    const currency = row.currency || "UNKNOWN";
    if (!acc[currency]) {
      acc[currency] = {
        net: 0,
        lineCount: 0,
        bucketTotals: {
          Sales: 0,
          "Refunds/Returns": 0,
          Fees: 0,
          Withholdings: 0,
          Other: 0,
        },
        bucketCounts: {
          Sales: 0,
          "Refunds/Returns": 0,
          Fees: 0,
          Withholdings: 0,
          Other: 0,
        },
      };
    }
    acc[currency].net += row.amount;
    acc[currency].lineCount += 1;
    acc[currency].bucketTotals[row.bucket] += row.amount;
    acc[currency].bucketCounts[row.bucket] += 1;
    return acc;
  }, {});
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
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [amountTypeFilter, setAmountTypeFilter] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [nonZeroOnly, setNonZeroOnly] = useState(false);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const totalsEntries = useMemo(() => {
    if (!preview) return [];
    return Object.entries(preview.totalsByCurrency);
  }, [preview]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setAmountTypeFilter("");
    setTransactionTypeFilter("");
    setBucketFilter("");
    setNonZeroOnly(false);
    setMinAmount("");
    setMaxAmount("");
  }, [preview?.report.reportId]);

  const columnMap = useMemo(() => {
    if (!preview) return null;
    const columns = preview.columns;
    return {
      amount: findColumnName(columns, ["amount", "total-amount", "amount-total", "total amount"]),
      currency: findColumnName(columns, ["currency", "amount-currency", "currency-code"]),
      amountType: findColumnName(columns, ["amount-type", "amount type"]),
      amountDescription: findColumnName(columns, ["amount-description", "amount description", "description"]),
      transactionType: findColumnName(columns, ["transaction-type", "transaction type"]),
      orderId: findColumnName(columns, ["amazon-order-id", "order-id", "amazon order id", "order id"]),
      sku: findColumnName(columns, ["sku", "seller-sku", "seller sku"]),
      asin: findColumnName(columns, ["asin"]),
    };
  }, [preview]);

  const previewRowsWithMeta = useMemo(() => {
    if (!preview || !columnMap) return [];
    return preview.rows.map((row) => {
      const amountRaw = columnMap.amount ? row[columnMap.amount] ?? "" : "";
      const amount = amountRaw ? parseAmount(amountRaw) : null;
      const currencyRaw = columnMap.currency ? row[columnMap.currency] ?? "" : "";
      const currency = currencyRaw ? currencyRaw.trim().toUpperCase() : "INR";
      const amountType = columnMap.amountType ? row[columnMap.amountType] ?? "" : "";
      const amountDescription = columnMap.amountDescription ? row[columnMap.amountDescription] ?? "" : "";
      const transactionType = columnMap.transactionType ? row[columnMap.transactionType] ?? "" : "";
      const orderId = columnMap.orderId ? row[columnMap.orderId] ?? "" : "";
      const sku = columnMap.sku ? row[columnMap.sku] ?? "" : "";
      const asin = columnMap.asin ? row[columnMap.asin] ?? "" : "";
      const bucket = classifySettlementBucket({ amountType, amountDescription, transactionType });
      const searchable = [amountDescription, amountType, transactionType, orderId, sku, asin]
        .filter((value) => value && value.trim().length > 0)
        .join(" ")
        .toLowerCase();

      return {
        row,
        amount,
        currency,
        amountType,
        amountDescription,
        transactionType,
        orderId,
        sku,
        asin,
        bucket,
        searchable,
      };
    });
  }, [preview, columnMap]);

  const amountTypeOptions = useMemo(() => {
    const values = new Set<string>();
    previewRowsWithMeta.forEach((row) => {
      if (row.amountType) values.add(row.amountType);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [previewRowsWithMeta]);

  const transactionTypeOptions = useMemo(() => {
    const values = new Set<string>();
    previewRowsWithMeta.forEach((row) => {
      if (row.transactionType) values.add(row.transactionType);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [previewRowsWithMeta]);

  const filteredRowsWithMeta = useMemo(() => {
    if (previewRowsWithMeta.length === 0) return [];

    const minParsed = minAmount ? Number.parseFloat(minAmount) : null;
    const maxParsed = maxAmount ? Number.parseFloat(maxAmount) : null;
    const minValue = minParsed !== null && !Number.isNaN(minParsed) ? minParsed : null;
    const maxValue = maxParsed !== null && !Number.isNaN(maxParsed) ? maxParsed : null;
    const searchValue = debouncedSearch.toLowerCase();

    return previewRowsWithMeta.filter((row) => {
      if (searchValue && !row.searchable.includes(searchValue)) return false;
      if (amountTypeFilter && row.amountType !== amountTypeFilter) return false;
      if (transactionTypeFilter && row.transactionType !== transactionTypeFilter) return false;
      if (bucketFilter && row.bucket !== bucketFilter) return false;
      if (nonZeroOnly && (!row.amount || row.amount === 0)) return false;
      if (minValue !== null) {
        if (row.amount === null || row.amount < minValue) return false;
      }
      if (maxValue !== null) {
        if (row.amount === null || row.amount > maxValue) return false;
      }
      return true;
    });
  }, [
    previewRowsWithMeta,
    debouncedSearch,
    amountTypeFilter,
    transactionTypeFilter,
    bucketFilter,
    nonZeroOnly,
    minAmount,
    maxAmount,
  ]);

  const filteredRows = useMemo(() => filteredRowsWithMeta.map((row) => row.row), [filteredRowsWithMeta]);

  const settlementTotals = useMemo(() => buildTotals(previewRowsWithMeta), [previewRowsWithMeta]);
  const filteredTotals = useMemo(() => buildTotals(filteredRowsWithMeta), [filteredRowsWithMeta]);

  const currencies = useMemo(() => Object.keys(settlementTotals), [settlementTotals]);
  const hasNonInrCurrency = useMemo(
    () => currencies.some((currency) => currency !== "INR"),
    [currencies]
  );

  const filtersActive = useMemo(() => {
    return Boolean(
      debouncedSearch ||
        amountTypeFilter ||
        transactionTypeFilter ||
        bucketFilter ||
        nonZeroOnly ||
        minAmount ||
        maxAmount
    );
  }, [
    debouncedSearch,
    amountTypeFilter,
    transactionTypeFilter,
    bucketFilter,
    nonZeroOnly,
    minAmount,
    maxAmount,
  ]);

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

  const handleExportCsv = () => {
    if (!preview) return;
    const columns = preview.columns.map((column) => ({
      header: column,
      accessor: (row: Record<string, string>) => row[column] ?? "",
    }));
    const timestamp = formatTimestampForFilename(new Date());
    const filename = `amazon-settlement-${preview.report.reportId}-${timestamp}.csv`;
    downloadCsv(filename, columns, filteredRows);
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
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={labelStyle}>Settlement summary</div>
                      {hasNonInrCurrency ? (
                        <p style={{ ...summaryMetaStyle, marginTop: 4 }}>
                          Multiple currencies detected. Totals shown per currency.
                        </p>
                      ) : null}
                    </div>
                    <button style={secondaryButtonStyle} onClick={handleExportCsv}>
                      Export CSV
                    </button>
                  </div>

                  {currencies.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {currencies.map((currency) => {
                        const totals = settlementTotals[currency];
                        if (!totals) return null;
                        const filtered = filteredTotals[currency];
                        return (
                          <div key={currency} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ ...labelStyle, marginBottom: 0 }}>{currency}</div>
                            <div style={summaryGridStyle}>
                              <div style={summaryCardStyle}>
                                <div style={labelStyle}>Net Payout</div>
                                <p style={valueStyle}>{formatCurrency(totals.net, currency)}</p>
                                <div style={summaryMetaStyle}>{totals.lineCount} lines</div>
                                {filtersActive && filtered ? (
                                  <div style={summaryMetaStyle}>
                                    Filtered: {formatCurrency(filtered.net, currency)}
                                  </div>
                                ) : null}
                              </div>
                              {bucketLabels.map((bucket) => (
                                <div key={bucket.key} style={summaryCardStyle}>
                                  <div style={labelStyle}>{bucket.label}</div>
                                  <p style={valueStyle}>
                                    {formatCurrency(totals.bucketTotals[bucket.key], currency)}
                                  </p>
                                  <div style={summaryMetaStyle}>
                                    {totals.bucketCounts[bucket.key]} lines
                                  </div>
                                  {filtersActive && filtered ? (
                                    <div style={summaryMetaStyle}>
                                      Filtered:{" "}
                                      {formatCurrency(filtered.bucketTotals[bucket.key] ?? 0, currency)}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p style={emptyStateStyle}>No amount columns detected for summary totals.</p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={labelStyle}>Preview rows</div>
                    <div style={filterBarStyle}>
                      <label style={filterLabelStyle}>
                        <span>Search</span>
                        <input
                          value={searchInput}
                          onChange={(event) => setSearchInput(event.target.value)}
                          style={{ ...inputStyle, minWidth: 220 }}
                          placeholder="Description, type, order, SKU, ASIN"
                        />
                      </label>
                      <label style={filterLabelStyle}>
                        <span>Amount type</span>
                        <select
                          value={amountTypeFilter}
                          onChange={(event) => setAmountTypeFilter(event.target.value)}
                          style={{ ...inputStyle, minWidth: 160 }}
                        >
                          <option value="">All</option>
                          {amountTypeOptions.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={filterLabelStyle}>
                        <span>Transaction type</span>
                        <select
                          value={transactionTypeFilter}
                          onChange={(event) => setTransactionTypeFilter(event.target.value)}
                          style={{ ...inputStyle, minWidth: 180 }}
                        >
                          <option value="">All</option>
                          {transactionTypeOptions.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={filterLabelStyle}>
                        <span>Bucket</span>
                        <select
                          value={bucketFilter}
                          onChange={(event) => setBucketFilter(event.target.value)}
                          style={{ ...inputStyle, minWidth: 160 }}
                        >
                          <option value="">All</option>
                          {bucketLabels.map((bucket) => (
                            <option key={bucket.key} value={bucket.key}>
                              {bucket.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={filterLabelStyle}>
                        <span>Min amount</span>
                        <input
                          type="number"
                          value={minAmount}
                          onChange={(event) => setMinAmount(event.target.value)}
                          style={{ ...inputStyle, width: 140 }}
                          placeholder="0"
                        />
                      </label>
                      <label style={filterLabelStyle}>
                        <span>Max amount</span>
                        <input
                          type="number"
                          value={maxAmount}
                          onChange={(event) => setMaxAmount(event.target.value)}
                          style={{ ...inputStyle, width: 140 }}
                          placeholder="0"
                        />
                      </label>
                      <label style={filterInlineLabelStyle}>
                        <input
                          type="checkbox"
                          checked={nonZeroOnly}
                          onChange={(event) => setNonZeroOnly(event.target.checked)}
                        />
                        Non-zero only
                      </label>
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 12 }}>
                      Showing {filteredRows.length} of {preview.rows.length} preview rows
                    </div>
                  </div>

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
                        {filteredRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={preview.columns.length}
                              style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}
                            >
                              No rows match the current filters.
                            </td>
                          </tr>
                        ) : (
                          filteredRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {preview.columns.map((column) => (
                                <td key={`${rowIndex}-${column}`} style={tableCellStyle}>
                                  {row[column] || "—"}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
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
