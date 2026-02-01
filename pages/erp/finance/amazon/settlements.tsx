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
import { apiFetch } from "../../../../lib/erp/apiFetch";
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

type NormalizedBucketSource =
  | "price"
  | "promotion"
  | "order-fee"
  | "item-fee"
  | "shipment-fee"
  | "misc"
  | "other"
  | "direct-payment"
  | "other-amount";

type NormalizedSettlementLine = {
  bucketSource: NormalizedBucketSource;
  type: string;
  description?: string;
  amount: number;
  currency: string;
  orderId?: string;
  sku?: string;
  asin?: string;
  postedDate?: string;
  quantity?: string;
  transactionType?: string;
  rowIndex: number;
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

function normalizeValue(value: string): string {
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
  type?: string;
  description?: string;
  transactionType?: string;
  amount: number;
  bucketSource: NormalizedBucketSource;
}): SettlementBucket {
  const joined = `${values.type ?? ""} ${values.description ?? ""} ${values.transactionType ?? ""}`;
  const raw = joined.toLowerCase();
  const normalized = normalizeValue(raw);

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
  if (
    ["order-fee", "item-fee", "shipment-fee", "misc", "other"].includes(values.bucketSource) &&
    feeKeywords.some((keyword) => normalized.includes(keyword))
  ) {
    return "Fees";
  }

  const refundKeywords = ["refund", "reversal", "chargeback", "return"];
  const transactionNormalized = normalizeValue(values.transactionType ?? "");
  const typeNormalized = normalizeValue(values.type ?? "");
  if (
    values.amount < 0 &&
    (refundKeywords.some((keyword) => normalized.includes(keyword)) ||
      refundKeywords.some((keyword) => transactionNormalized.includes(keyword)) ||
      (values.bucketSource === "price" && typeNormalized.includes("principal")))
  ) {
    return "Refunds/Returns";
  }

  if (values.bucketSource === "price") {
    const salesTypes = ["principal", "itemprice", "productprice", "shippingcharge", "giftwrap", "tax"];
    if (values.amount > 0 && salesTypes.some((keyword) => typeNormalized.includes(keyword))) {
      return "Sales";
    }
  }

  if (["order-fee", "item-fee", "shipment-fee", "misc", "other"].includes(values.bucketSource)) {
    return "Fees";
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
      totalAmount: findColumnName(columns, ["total-amount", "amount-total", "total amount"]),
      currency: findColumnName(columns, ["currency", "amount-currency", "currency-code"]),
      amountType: findColumnName(columns, ["amount-type", "amount type"]),
      amountDescription: findColumnName(columns, ["amount-description", "amount description", "description"]),
      transactionType: findColumnName(columns, ["transaction-type", "transaction type"]),
      orderId: findColumnName(columns, ["amazon-order-id", "order-id", "amazon order id", "order id"]),
      sku: findColumnName(columns, ["sku", "seller-sku", "seller sku"]),
      asin: findColumnName(columns, ["asin"]),
      postedDate: findColumnName(columns, ["posted-date", "posted date"]),
      quantity: findColumnName(columns, ["quantity", "quantity-purchased", "quantity purchased"]),
      priceType: findColumnName(columns, ["price-type", "price type"]),
      priceAmount: findColumnName(columns, ["price-amount", "price amount"]),
      promotionType: findColumnName(columns, ["promotion-type", "promotion type"]),
      promotionAmount: findColumnName(columns, ["promotion-amount", "promotion amount"]),
      orderFeeType: findColumnName(columns, ["order-fee-type", "order fee type"]),
      orderFeeAmount: findColumnName(columns, ["order-fee-amount", "order fee amount"]),
      itemFeeType: findColumnName(columns, ["item-related-fee-type", "item related fee type"]),
      itemFeeAmount: findColumnName(columns, ["item-related-fee-amount", "item related fee amount"]),
      shipmentFeeType: findColumnName(columns, ["shipment-fee-type", "shipment fee type"]),
      shipmentFeeAmount: findColumnName(columns, ["shipment-fee-amount", "shipment fee amount"]),
      miscFeeAmount: findColumnName(columns, ["misc-fee-amount", "misc fee amount"]),
      otherFeeReason: findColumnName(columns, [
        "other-fee-reason-description",
        "other fee reason description",
      ]),
      otherFeeAmount: findColumnName(columns, ["other-fee-amount", "other fee amount"]),
      directPaymentType: findColumnName(columns, ["direct-payment-type", "direct payment type"]),
      directPaymentAmount: findColumnName(columns, ["direct-payment-amount", "direct payment amount"]),
      otherAmount: findColumnName(columns, ["other-amount", "other amount"]),
    };
  }, [preview]);

  const normalizedPreview = useMemo(() => {
    if (!preview || !columnMap) {
      return { lines: [] as NormalizedSettlementLine[], netPayoutByCurrency: {} as Record<string, number> };
    }

    const lines: NormalizedSettlementLine[] = [];
    const netPayoutByCurrency: Record<string, number> = {};

    const getValue = (row: Record<string, string>, column: string | null) =>
      column ? row[column] ?? "" : "";

    preview.rows.forEach((row, rowIndex) => {
      const transactionType = getValue(row, columnMap.transactionType).trim();
      const orderId = getValue(row, columnMap.orderId).trim();
      const sku = getValue(row, columnMap.sku).trim();
      const asin = getValue(row, columnMap.asin).trim();
      const postedDate = getValue(row, columnMap.postedDate).trim();
      const quantity = getValue(row, columnMap.quantity).trim();
      const currencyRaw = getValue(row, columnMap.currency).trim();
      const currency = currencyRaw ? currencyRaw.toUpperCase() : "INR";
      const totalAmountRaw = getValue(row, columnMap.totalAmount);
      const totalAmount = totalAmountRaw ? parseAmount(totalAmountRaw) : null;

      const isSummaryRow = totalAmount !== null && !transactionType && !orderId;
      if (isSummaryRow) {
        netPayoutByCurrency[currency] = (netPayoutByCurrency[currency] ?? 0) + totalAmount;
        return;
      }

      const pushLine = (
        bucketSource: NormalizedBucketSource,
        type: string,
        amountRawValue: string,
        description?: string
      ) => {
        const amount = amountRawValue ? parseAmount(amountRawValue) : null;
        if (amount === null || amount === 0) return;
        lines.push({
          bucketSource,
          type,
          description,
          amount,
          currency,
          orderId: orderId || undefined,
          sku: sku || undefined,
          asin: asin || undefined,
          postedDate: postedDate || undefined,
          quantity: quantity || undefined,
          transactionType: transactionType || undefined,
          rowIndex,
        });
      };

      pushLine(
        "price",
        getValue(row, columnMap.priceType).trim() || "price",
        getValue(row, columnMap.priceAmount)
      );
      pushLine(
        "promotion",
        getValue(row, columnMap.promotionType).trim() || "promotion",
        getValue(row, columnMap.promotionAmount)
      );
      pushLine(
        "order-fee",
        getValue(row, columnMap.orderFeeType).trim() || "order-fee",
        getValue(row, columnMap.orderFeeAmount)
      );
      pushLine(
        "item-fee",
        getValue(row, columnMap.itemFeeType).trim() || "item-fee",
        getValue(row, columnMap.itemFeeAmount)
      );
      pushLine(
        "shipment-fee",
        getValue(row, columnMap.shipmentFeeType).trim() || "shipment-fee",
        getValue(row, columnMap.shipmentFeeAmount)
      );
      pushLine("misc", "misc-fee-amount", getValue(row, columnMap.miscFeeAmount));

      const otherFeeReason = getValue(row, columnMap.otherFeeReason).trim();
      pushLine(
        "other",
        otherFeeReason || "other-fee-amount",
        getValue(row, columnMap.otherFeeAmount),
        otherFeeReason || undefined
      );
      pushLine(
        "direct-payment",
        getValue(row, columnMap.directPaymentType).trim() || "direct-payment",
        getValue(row, columnMap.directPaymentAmount)
      );
      pushLine("other-amount", "other-amount", getValue(row, columnMap.otherAmount));
    });

    return { lines, netPayoutByCurrency };
  }, [preview, columnMap]);

  const normalizedLinesWithMeta = useMemo(() => {
    return normalizedPreview.lines.map((line) => {
      const bucket = classifySettlementBucket({
        type: line.type,
        description: line.description,
        transactionType: line.transactionType,
        amount: line.amount,
        bucketSource: line.bucketSource,
      });
      const searchable = [
        line.type,
        line.description,
        line.transactionType,
        line.orderId,
        line.sku,
        line.asin,
        line.bucketSource,
      ]
        .filter((value) => value && value.trim().length > 0)
        .join(" ")
        .toLowerCase();

      return {
        ...line,
        bucket,
        searchable,
      };
    });
  }, [normalizedPreview.lines]);

  const amountTypeOptions = useMemo(() => {
    const values = new Set<string>();
    normalizedLinesWithMeta.forEach((line) => {
      if (line.type) values.add(line.type);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [normalizedLinesWithMeta]);

  const transactionTypeOptions = useMemo(() => {
    const values = new Set<string>();
    normalizedLinesWithMeta.forEach((line) => {
      if (line.transactionType) values.add(line.transactionType);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [normalizedLinesWithMeta]);

  const filteredLinesWithMeta = useMemo(() => {
    if (normalizedLinesWithMeta.length === 0) return [];

    const minParsed = minAmount ? Number.parseFloat(minAmount) : null;
    const maxParsed = maxAmount ? Number.parseFloat(maxAmount) : null;
    const minValue = minParsed !== null && !Number.isNaN(minParsed) ? minParsed : null;
    const maxValue = maxParsed !== null && !Number.isNaN(maxParsed) ? maxParsed : null;
    const searchValue = debouncedSearch.toLowerCase();

    return normalizedLinesWithMeta.filter((line) => {
      if (searchValue && !line.searchable.includes(searchValue)) return false;
      if (amountTypeFilter && line.type !== amountTypeFilter) return false;
      if (transactionTypeFilter && line.transactionType !== transactionTypeFilter) return false;
      if (bucketFilter && line.bucket !== bucketFilter) return false;
      if (nonZeroOnly && (!line.amount || line.amount === 0)) return false;
      if (minValue !== null) {
        if (line.amount < minValue) return false;
      }
      if (maxValue !== null) {
        if (line.amount > maxValue) return false;
      }
      return true;
    });
  }, [
    normalizedLinesWithMeta,
    debouncedSearch,
    amountTypeFilter,
    transactionTypeFilter,
    bucketFilter,
    nonZeroOnly,
    minAmount,
    maxAmount,
  ]);

  const settlementTotals = useMemo(() => buildTotals(normalizedLinesWithMeta), [normalizedLinesWithMeta]);
  const filteredTotals = useMemo(() => buildTotals(filteredLinesWithMeta), [filteredLinesWithMeta]);

  const normalizedSumsByCurrency = useMemo(() => {
    return normalizedLinesWithMeta.reduce<Record<string, number>>((acc, line) => {
      const currency = line.currency || "UNKNOWN";
      acc[currency] = (acc[currency] ?? 0) + line.amount;
      return acc;
    }, {});
  }, [normalizedLinesWithMeta]);

  const payoutWarnings = useMemo(() => {
    return Object.entries(normalizedPreview.netPayoutByCurrency).filter(([currency, netPayout]) => {
      const sum = normalizedSumsByCurrency[currency] ?? 0;
      return Math.abs(sum - netPayout) > 1;
    });
  }, [normalizedPreview.netPayoutByCurrency, normalizedSumsByCurrency]);

  const currencies = useMemo(() => {
    const set = new Set<string>([
      ...Object.keys(settlementTotals),
      ...Object.keys(normalizedPreview.netPayoutByCurrency),
    ]);
    return Array.from(set);
  }, [settlementTotals, normalizedPreview.netPayoutByCurrency]);
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
      const response = await apiFetch(`/api/finance/amazon/settlements?${params.toString()}`);
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
      const response = await apiFetch(`/api/finance/amazon/settlements/${reportId}`);
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

  const handleExportNormalizedCsv = () => {
    if (!preview) return;
    const reportId = preview.report.reportId;
    const columns = [
      { header: "settlementReportId", accessor: () => reportId },
      { header: "posted-date", accessor: (row: typeof filteredLinesWithMeta[number]) => row.postedDate ?? "" },
      {
        header: "transaction-type",
        accessor: (row: typeof filteredLinesWithMeta[number]) => row.transactionType ?? "",
      },
      { header: "order-id", accessor: (row: typeof filteredLinesWithMeta[number]) => row.orderId ?? "" },
      { header: "sku", accessor: (row: typeof filteredLinesWithMeta[number]) => row.sku ?? "" },
      { header: "asin", accessor: (row: typeof filteredLinesWithMeta[number]) => row.asin ?? "" },
      { header: "quantity", accessor: (row: typeof filteredLinesWithMeta[number]) => row.quantity ?? "" },
      {
        header: "normalized_bucketSource",
        accessor: (row: typeof filteredLinesWithMeta[number]) => row.bucketSource,
      },
      { header: "normalized_type", accessor: (row: typeof filteredLinesWithMeta[number]) => row.type },
      {
        header: "normalized_amount",
        accessor: (row: typeof filteredLinesWithMeta[number]) => row.amount.toFixed(2),
      },
      { header: "currency", accessor: (row: typeof filteredLinesWithMeta[number]) => row.currency },
    ];
    const timestamp = formatTimestampForFilename(new Date());
    const filename = `amazon-settlement-normalized-${preview.report.reportId}-${timestamp}.csv`;
    downloadCsv(filename, columns, filteredLinesWithMeta);
  };

  const handleExportRawCsv = () => {
    if (!preview) return;
    const columns = preview.columns.map((column) => ({
      header: column,
      accessor: (row: (typeof preview.rows)[number]) => row[column] ?? "",
    }));
    const timestamp = formatTimestampForFilename(new Date());
    const filename = `amazon-settlement-raw-${preview.report.reportId}-${timestamp}.csv`;
    downloadCsv(filename, columns, preview.rows);
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
                      <p style={{ ...summaryMetaStyle, marginTop: 4 }}>
                        Normalized lines: {normalizedLinesWithMeta.length} · Raw rows: {preview.rowCount}
                      </p>
                      {Object.keys(normalizedPreview.netPayoutByCurrency).length > 0 ? (
                        <p style={{ ...summaryMetaStyle, marginTop: 4 }}>
                          Summary row net payout:{" "}
                          {Object.entries(normalizedPreview.netPayoutByCurrency)
                            .map(([currency, amount]) => formatCurrency(amount, currency))
                            .join(", ")}
                        </p>
                      ) : null}
                      {payoutWarnings.length > 0 ? (
                        <p style={{ ...summaryMetaStyle, marginTop: 4, color: "#b45309" }}>
                          Settlement lines sum differs from net payout (timing/format/partial preview).
                        </p>
                      ) : null}
                      {hasNonInrCurrency ? (
                        <p style={{ ...summaryMetaStyle, marginTop: 4 }}>
                          Multiple currencies detected. Totals shown per currency.
                        </p>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button style={secondaryButtonStyle} onClick={handleExportRawCsv}>
                        Export Raw CSV
                      </button>
                      <button style={secondaryButtonStyle} onClick={handleExportNormalizedCsv}>
                        Export Normalized CSV
                      </button>
                    </div>
                  </div>

                  {currencies.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {currencies.map((currency) => {
                        const totals = settlementTotals[currency];
                        if (!totals) {
                          const netPayout = normalizedPreview.netPayoutByCurrency[currency];
                          if (netPayout === undefined) return null;
                        }
                        const filtered = filteredTotals[currency];
                        const netPayout = normalizedPreview.netPayoutByCurrency[currency];
                        return (
                          <div key={currency} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ ...labelStyle, marginBottom: 0 }}>{currency}</div>
                            <div style={summaryGridStyle}>
                              <div style={summaryCardStyle}>
                                <div style={labelStyle}>Net Payout</div>
                                <p style={valueStyle}>
                                  {formatCurrency(netPayout ?? totals?.net ?? 0, currency)}
                                </p>
                                <div style={summaryMetaStyle}>
                                  {totals?.lineCount ?? 0} lines
                                </div>
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
                                    {formatCurrency(totals?.bucketTotals[bucket.key] ?? 0, currency)}
                                  </p>
                                  <div style={summaryMetaStyle}>
                                    {totals?.bucketCounts[bucket.key] ?? 0} lines
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
                    <div style={labelStyle}>Normalized lines</div>
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
                      Showing {filteredLinesWithMeta.length} of {normalizedLinesWithMeta.length} normalized
                      lines
                    </div>
                  </div>

                  <div style={previewTableWrapperStyle}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={tableHeaderCellStyle}>Bucket</th>
                          <th style={tableHeaderCellStyle}>Source</th>
                          <th style={tableHeaderCellStyle}>Type</th>
                          <th style={tableHeaderCellStyle}>Description</th>
                          <th style={tableHeaderCellStyle}>Transaction Type</th>
                          <th style={tableHeaderCellStyle}>Order ID</th>
                          <th style={tableHeaderCellStyle}>Amount</th>
                          <th style={tableHeaderCellStyle}>Currency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLinesWithMeta.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}
                            >
                              No rows match the current filters.
                            </td>
                          </tr>
                        ) : (
                          filteredLinesWithMeta.map((line, lineIndex) => (
                            <tr key={`${line.rowIndex}-${lineIndex}`}>
                              <td style={tableCellStyle}>{line.bucket}</td>
                              <td style={tableCellStyle}>{line.bucketSource}</td>
                              <td style={tableCellStyle}>{line.type}</td>
                              <td style={tableCellStyle}>{line.description ?? "—"}</td>
                              <td style={tableCellStyle}>{line.transactionType ?? "—"}</td>
                              <td style={tableCellStyle}>{line.orderId ?? "—"}</td>
                              <td style={tableCellStyle}>{line.amount.toFixed(2)}</td>
                              <td style={tableCellStyle}>{line.currency}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={labelStyle}>Raw preview rows</div>
                    <div style={{ color: "#6b7280", fontSize: 12 }}>
                      Showing {preview.sampleCount} of {preview.rowCount} raw rows
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
                        {preview.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={preview.columns.length}
                              style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}
                            >
                              No preview rows available.
                            </td>
                          </tr>
                        ) : (
                          preview.rows.map((row, rowIndex) => (
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
