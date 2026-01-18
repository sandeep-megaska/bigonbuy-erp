import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import Papa from "papaparse";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  h2Style,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import {
  useMarketplaceMarginSummary,
  useMarketplaceOrderLines,
  useMarketplaceOrderSummary,
} from "../../../../lib/erp/marketplaceMargin";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type ChannelOption = {
  id: string;
  code: string;
  name: string;
};

type MappingField = {
  key: keyof MarketplaceColumnMapping;
  label: string;
  required?: boolean;
  helper?: string;
};

type MarketplaceColumnMapping = {
  order_id: string;
  sku: string;
  qty: string;
  txn_date: string;
  net_payout?: string;
  gross_sales?: string;
  total_fees?: string;
  shipping_fee?: string;
  commission_fee?: string;
  fixed_fee?: string;
  closing_fee?: string;
  refund_amount?: string;
  other_charges?: string;
  sub_order_id?: string;
  settlement_type?: string;
};

type CsvRow = Record<string, string>;

type BatchRow = {
  id: string;
  status: string;
  batch_ref: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string | null;
  uploaded_at: string | null;
  processed_at: string | null;
};

type CostOverrideRow = {
  id: string;
  sku: string;
  unit_cost: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
};

const mappingSchema = z.object({
  order_id: z.string().min(1),
  sku: z.string().min(1),
  qty: z.string().min(1),
  txn_date: z.string().min(1),
  net_payout: z.string().min(1).optional(),
  gross_sales: z.string().min(1).optional(),
  total_fees: z.string().min(1).optional(),
  shipping_fee: z.string().min(1).optional(),
  commission_fee: z.string().min(1).optional(),
  fixed_fee: z.string().min(1).optional(),
  closing_fee: z.string().min(1).optional(),
  refund_amount: z.string().min(1).optional(),
  other_charges: z.string().min(1).optional(),
  sub_order_id: z.string().min(1).optional(),
  settlement_type: z.string().min(1).optional(),
});

const processResponseSchema = z.object({
  ok: z.boolean(),
  batch_id: z.string().uuid().nullable(),
  inserted_rows: z.coerce.number(),
  errors: z.array(
    z.object({
      row_index: z.coerce.number(),
      message: z.string(),
    })
  ),
  totals: z.object({
    net_payout: z.coerce.number(),
    fees: z.coerce.number(),
    refunds: z.coerce.number(),
    gross_sales: z.coerce.number(),
  }),
});

const mappingFields: MappingField[] = [
  { key: "order_id", label: "Order ID", required: true },
  { key: "sub_order_id", label: "Sub-order ID" },
  { key: "sku", label: "SKU", required: true },
  { key: "qty", label: "Quantity", required: true },
  { key: "txn_date", label: "Transaction Date", required: true },
  { key: "net_payout", label: "Net Payout", helper: "Optional if Gross Sales mapped" },
  { key: "gross_sales", label: "Gross Sales", helper: "Optional if Net Payout mapped" },
  { key: "total_fees", label: "Total Fees" },
  { key: "shipping_fee", label: "Shipping Fee" },
  { key: "commission_fee", label: "Commission Fee" },
  { key: "fixed_fee", label: "Fixed Fee" },
  { key: "closing_fee", label: "Closing Fee" },
  { key: "refund_amount", label: "Refund Amount" },
  { key: "other_charges", label: "Other Charges" },
  { key: "settlement_type", label: "Settlement Type" },
];

const tabItems = [
  { key: "upload", label: "Upload & Process" },
  { key: "batches", label: "Batches List" },
  { key: "sku", label: "SKU Profitability" },
  { key: "orders", label: "Orders Drilldown" },
] as const;

type TabKey = (typeof tabItems)[number]["key"];

function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default function MarketplaceMarginPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("upload");

  const [channel, setChannel] = useState<ChannelOption | null>(null);
  const [mapping, setMapping] = useState<Partial<MarketplaceColumnMapping>>({});
  const [mappingStatus, setMappingStatus] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [batchRef, setBatchRef] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [validateOnly, setValidateOnly] = useState(true);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<z.infer<typeof processResponseSchema> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchReloadKey, setBatchReloadKey] = useState(0);

  const [skuQuery, setSkuQuery] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [fromDate, setFromDate] = useState(() => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    return formatDateInput(from);
  });
  const [toDate, setToDate] = useState(() => formatDateInput(new Date()));
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [overrideSku, setOverrideSku] = useState("");
  const [overrideCost, setOverrideCost] = useState("");
  const [overrideDate, setOverrideDate] = useState(() => formatDateInput(new Date()));
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSuccess, setOverrideSuccess] = useState<string | null>(null);
  const [overrideRows, setOverrideRows] = useState<CostOverrideRow[]>([]);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }),
    []
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
        email: context.email,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      const { data, error: loadError } = await supabase
        .from("erp_sales_channels")
        .select("id, code, name")
        .eq("company_id", ctx.companyId)
        .eq("code", "amazon")
        .single();

      if (!active) return;

      if (loadError) {
        setError(loadError.message);
        return;
      }

      setChannel(data as ChannelOption);
    })().catch((loadError: Error) => {
      if (active) setError(loadError.message || "Failed to load channel.");
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  useEffect(() => {
    if (!channel?.id) return;
    let active = true;
    setMappingStatus(null);

    (async () => {
      const { data, error: loadError } = await supabase.rpc("erp_marketplace_mapping_get", {
        p_channel_id: channel.id,
      });

      if (!active) return;

      if (loadError) {
        setMappingStatus(loadError.message);
        return;
      }

      if (data && typeof data === "object") {
        setMapping(data as MarketplaceColumnMapping);
      }
    })().catch((loadError: Error) => {
      if (active) setMappingStatus(loadError.message || "Failed to load saved mapping.");
    });

    return () => {
      active = false;
    };
  }, [channel?.id]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;
    setBatchLoading(true);
    setBatchError(null);

    (async () => {
      const { data, error: loadError } = await supabase
        .from("erp_marketplace_settlement_batches")
        .select("id, status, batch_ref, period_start, period_end, currency, uploaded_at, processed_at")
        .eq("company_id", ctx.companyId)
        .order("uploaded_at", { ascending: false });

      if (!active) return;

      if (loadError) {
        setBatchError(loadError.message);
        setBatchLoading(false);
        return;
      }

      setBatchRows((data || []) as BatchRow[]);
      setBatchLoading(false);
    })().catch((loadError: Error) => {
      if (active) {
        setBatchError(loadError.message || "Failed to load batches.");
        setBatchLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, batchReloadKey]);

  useEffect(() => {
    if (!overrideSku.trim()) {
      setOverrideRows([]);
      return;
    }

    let active = true;
    setOverrideLoading(true);
    setOverrideError(null);

    (async () => {
      const { data, error: loadError } = await supabase
        .from("erp_sku_cost_overrides")
        .select("id, sku, unit_cost, effective_from, effective_to, notes")
        .eq("sku", overrideSku.trim().toUpperCase())
        .order("effective_from", { ascending: false });

      if (!active) return;

      if (loadError) {
        setOverrideError(loadError.message);
        setOverrideLoading(false);
        return;
      }

      setOverrideRows((data || []) as CostOverrideRow[]);
      setOverrideLoading(false);
    })().catch((loadError: Error) => {
      if (active) {
        setOverrideError(loadError.message || "Failed to load overrides.");
        setOverrideLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [overrideSku]);

  const summaryParams = useMemo(
    () => ({
      channelCode: "amazon",
      from: fromDate || null,
      to: toDate || null,
      skuQuery: skuQuery || null,
      limit: 200,
      offset: 0,
    }),
    [fromDate, toDate, skuQuery]
  );

  const orderParams = useMemo(
    () => ({
      channelCode: "amazon",
      from: fromDate || null,
      to: toDate || null,
      orderQuery: orderQuery || null,
      limit: 200,
      offset: 0,
    }),
    [fromDate, toDate, orderQuery]
  );

  const {
    data: skuRows,
    loading: skuLoading,
    error: skuError,
  } = useMarketplaceMarginSummary(summaryParams);
  const {
    data: orderRows,
    loading: orderLoading,
    error: orderError,
  } = useMarketplaceOrderSummary(orderParams);
  const {
    data: orderLineRows,
    loading: orderLinesLoading,
    error: orderLinesError,
  } = useMarketplaceOrderLines({
    channelCode: "amazon",
    orderId: selectedOrderId,
  });

  const summaryTotals = useMemo(() => {
    return skuRows.reduce(
      (acc, row) => {
        acc.net_payout += row.net_payout ?? 0;
        acc.total_fees += row.total_fees ?? 0;
        acc.refunds += row.refunds ?? 0;
        acc.gross_sales += row.gross_sales ?? 0;
        return acc;
      },
      {
        net_payout: 0,
        total_fees: 0,
        refunds: 0,
        gross_sales: 0,
      }
    );
  }, [skuRows]);

  const handleFile = useCallback((file: File) => {
    setIsParsing(true);
    setParseError(null);
    setProcessResult(null);
    setHeaders([]);
    setParsedRows([]);

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        setIsParsing(false);
        if (results.errors?.length) {
          setParseError(results.errors[0]?.message || "Failed to parse CSV.");
          return;
        }
        const normalizedRows = (results.data || []).map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)])
          )
        );
        setFileName(file.name);
        setParsedRows(normalizedRows);
        setHeaders(results.meta.fields || Object.keys(normalizedRows[0] || {}));
        setStep(2);
      },
      error: (parseErrorResponse) => {
        setIsParsing(false);
        setParseError(parseErrorResponse.message || "Failed to parse CSV.");
      },
    });
  }, []);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleFile(file);
      event.target.value = "";
    },
    [handleFile]
  );

  const handleMappingChange = (field: keyof MarketplaceColumnMapping, value: string) => {
    setMapping((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  const mappingValidation = useMemo(() => {
    const missingRequired = mappingFields
      .filter((field) => field.required && !mapping[field.key])
      .map((field) => field.label);
    const needsPayout = !mapping.net_payout && !mapping.gross_sales;
    return { missingRequired, needsPayout };
  }, [mapping]);

  const mappingPayload = useMemo(() => {
    const payload: Record<string, string> = {};
    mappingFields.forEach((field) => {
      const value = mapping[field.key];
      if (value) payload[field.key] = value;
    });
    return payload;
  }, [mapping]);

  const previewRows = useMemo(() => {
    if (!parsedRows.length) return [];
    const getValue = (row: CsvRow, key: keyof MarketplaceColumnMapping) => {
      const header = mapping[key];
      if (!header) return "";
      return row[header] ?? "";
    };
    return parsedRows.slice(0, 25).map((row) => ({
      order_id: getValue(row, "order_id"),
      sku: getValue(row, "sku"),
      qty: getValue(row, "qty"),
      net_payout: getValue(row, "net_payout"),
      gross_sales: getValue(row, "gross_sales"),
      txn_date: getValue(row, "txn_date"),
    }));
  }, [parsedRows, mapping]);

  const handleSaveMapping = useCallback(async () => {
    setMappingStatus(null);
    if (!channel?.id) {
      setMappingStatus("Channel not loaded.");
      return;
    }

    const parseResult = mappingSchema.safeParse(mappingPayload);
    if (!parseResult.success) {
      setMappingStatus("Mapping is incomplete. Fill required fields before saving.");
      return;
    }

    const { error: saveError } = await supabase.rpc("erp_marketplace_mapping_save", {
      p_channel_id: channel.id,
      p_mapping: parseResult.data,
    });

    if (saveError) {
      setMappingStatus(saveError.message);
      return;
    }

    setMappingStatus("Mapping saved.");
  }, [channel?.id, mappingPayload]);

  const handleProcess = useCallback(async () => {
    setProcessError(null);
    setProcessResult(null);

    if (!parsedRows.length) {
      setProcessError("Upload a settlement CSV first.");
      return;
    }

    const parseResult = mappingSchema.safeParse(mappingPayload);
    if (!parseResult.success || mappingValidation.missingRequired.length > 0 || mappingValidation.needsPayout) {
      setProcessError("Complete the column mapping before processing.");
      return;
    }

    setIsProcessing(true);
    const { data, error: rpcError } = await supabase.rpc("erp_marketplace_settlement_process_csv", {
      p_channel_code: "amazon",
      p_batch_ref: batchRef || null,
      p_period_start: periodStart || null,
      p_period_end: periodEnd || null,
      p_currency: currency || null,
      p_mapping: parseResult.data,
      p_rows: parsedRows,
      p_validate_only: validateOnly,
    });

    if (rpcError) {
      setProcessError(rpcError.message || "Failed to process settlement.");
      setIsProcessing(false);
      return;
    }

    const parsed = processResponseSchema.safeParse(data);
    if (!parsed.success) {
      setProcessError("Failed to parse processing response.");
      setIsProcessing(false);
      return;
    }

    setProcessResult(parsed.data);
    setIsProcessing(false);
    if (!validateOnly) {
      setBatchReloadKey((value) => value + 1);
    }
  }, [
    parsedRows,
    mappingPayload,
    mappingValidation.missingRequired.length,
    mappingValidation.needsPayout,
    batchRef,
    periodStart,
    periodEnd,
    currency,
    validateOnly,
  ]);

  const handleOverrideSave = useCallback(async () => {
    setOverrideError(null);
    setOverrideSuccess(null);

    const skuValue = overrideSku.trim().toUpperCase();
    if (!skuValue) {
      setOverrideError("Enter a SKU.");
      return;
    }
    const costValue = Number.parseFloat(overrideCost);
    if (!Number.isFinite(costValue) || costValue <= 0) {
      setOverrideError("Enter a valid unit cost.");
      return;
    }
    if (!overrideDate) {
      setOverrideError("Select an effective date.");
      return;
    }

    const { error: saveError } = await supabase.from("erp_sku_cost_overrides").insert({
      sku: skuValue,
      unit_cost: costValue,
      effective_from: overrideDate,
    });

    if (saveError) {
      setOverrideError(saveError.message);
      return;
    }

    setOverrideSuccess("Cost override saved.");
    setOverrideCost("");
    setOverrideSku(skuValue);
    setBatchReloadKey((value) => value + 1);
  }, [overrideSku, overrideCost, overrideDate]);

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Marketplace Margin…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Marketplace Margin Analyzer"
            description="Upload settlement data and compute profitability."
            rightActions={
              <Link href="/erp" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to ERP Home
              </Link>
            }
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your account.
          </p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Marketplace Margin Analyzer"
          description="Upload Amazon settlements, map columns, and analyze SKU + order profitability."
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Finance Home
              </Link>
              <Link href="/erp" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                ERP Home
              </Link>
            </div>
          }
        />

        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

        <section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                ...secondaryButtonStyle,
                borderColor: activeTab === tab.key ? "#111827" : "#d1d5db",
                backgroundColor: activeTab === tab.key ? "#111827" : "#fff",
                color: activeTab === tab.key ? "#fff" : "#111827",
              }}
            >
              {tab.label}
            </button>
          ))}
        </section>

        {activeTab === "upload" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={cardStyle}>
              <h2 style={h2Style}>Step {step}: Upload Amazon settlement CSV</h2>
              <p style={subtitleStyle}>
                Upload a settlement file for Amazon India. We will map the columns in the next step.
              </p>
              <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept=".csv" onChange={handleFileChange} style={inputStyle} />
                {fileName ? <span>{fileName}</span> : null}
              </div>
              {isParsing ? <p style={{ marginTop: 10 }}>Parsing CSV…</p> : null}
              {parseError ? <p style={{ marginTop: 10, color: "#b91c1c" }}>{parseError}</p> : null}
              {parsedRows.length > 0 ? (
                <p style={{ marginTop: 10, color: "#4b5563" }}>
                  Parsed {parsedRows.length} rows and {headers.length} columns.
                </p>
              ) : null}
            </div>

            <div style={cardStyle}>
              <h2 style={h2Style}>Step 2: Map columns</h2>
              <p style={subtitleStyle}>
                Map CSV headers to the logical settlement fields. Required fields are marked.
              </p>
              {mappingStatus ? <p style={{ marginTop: 8 }}>{mappingStatus}</p> : null}
              <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                {mappingFields.map((field) => (
                  <label key={field.key} style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>
                      {field.label} {field.required ? " *" : ""}
                    </span>
                    {field.helper ? <span style={{ fontSize: 12, color: "#6b7280" }}>{field.helper}</span> : null}
                    <select
                      value={mapping[field.key] || ""}
                      onChange={(event) => handleMappingChange(field.key, event.target.value)}
                      style={inputStyle}
                      disabled={!headers.length}
                    >
                      <option value="">Select header</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {mappingValidation.missingRequired.length > 0 ? (
                <p style={{ marginTop: 12, color: "#b91c1c" }}>
                  Missing required mappings: {mappingValidation.missingRequired.join(", ")}.
                </p>
              ) : null}
              {mappingValidation.needsPayout ? (
                <p style={{ marginTop: 12, color: "#b91c1c" }}>
                  Map either Net Payout or Gross Sales to continue.
                </p>
              ) : null}
              <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={handleSaveMapping} style={secondaryButtonStyle}>
                  Save Mapping
                </button>
                <button type="button" onClick={() => setStep(3)} style={primaryButtonStyle}>
                  Preview Rows
                </button>
              </div>
            </div>

            <div style={cardStyle}>
              <h2 style={h2Style}>Step 3: Preview & process</h2>
              <p style={subtitleStyle}>Review the first 25 rows and process the batch.</p>
              <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Batch Reference</span>
                  <input value={batchRef} onChange={(event) => setBatchRef(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Period Start</span>
                  <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Period End</span>
                  <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Currency</span>
                  <input value={currency} onChange={(event) => setCurrency(event.target.value)} style={inputStyle} />
                </label>
              </div>
              <label style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={validateOnly}
                  onChange={(event) => setValidateOnly(event.target.checked)}
                />
                Validate only (no DB writes)
              </label>
              <div style={{ marginTop: 16 }}>
                <button type="button" onClick={handleProcess} style={primaryButtonStyle} disabled={isProcessing}>
                  {isProcessing ? "Processing…" : validateOnly ? "Validate Batch" : "Process Batch"}
                </button>
              </div>
              {processError ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{processError}</p> : null}
              {processResult ? (
                <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span style={badgeStyle}>
                      Rows inserted: {processResult.inserted_rows}
                    </span>
                    <span style={badgeStyle}>
                      Net payout: {currencyFormatter.format(processResult.totals.net_payout)}
                    </span>
                    <span style={badgeStyle}>
                      Fees: {currencyFormatter.format(processResult.totals.fees)}
                    </span>
                    <span style={badgeStyle}>
                      Refunds: {currencyFormatter.format(processResult.totals.refunds)}
                    </span>
                    <span style={badgeStyle}>
                      Gross sales: {currencyFormatter.format(processResult.totals.gross_sales)}
                    </span>
                  </div>
                  {processResult.errors.length > 0 ? (
                    <div>
                      <h3 style={{ margin: "12px 0 8px" }}>Row errors</h3>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {processResult.errors.slice(0, 10).map((err) => (
                          <li key={`${err.row_index}-${err.message}`}>
                            Row {err.row_index}: {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {previewRows.length > 0 ? (
                <div style={{ marginTop: 16, overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Order ID</th>
                        <th style={tableHeaderCellStyle}>SKU</th>
                        <th style={tableHeaderCellStyle}>Qty</th>
                        <th style={tableHeaderCellStyle}>Net Payout</th>
                        <th style={tableHeaderCellStyle}>Gross Sales</th>
                        <th style={tableHeaderCellStyle}>Txn Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={`${row.order_id}-${index}`}>
                          <td style={tableCellStyle}>{row.order_id || "—"}</td>
                          <td style={{ ...tableCellStyle, color: row.sku ? "#111827" : "#b91c1c" }}>
                            {row.sku || "Missing"}
                          </td>
                          <td style={{ ...tableCellStyle, color: row.qty ? "#111827" : "#b91c1c" }}>
                            {row.qty || "Missing"}
                          </td>
                          <td style={tableCellStyle}>{row.net_payout || "—"}</td>
                          <td style={tableCellStyle}>{row.gross_sales || "—"}</td>
                          <td style={tableCellStyle}>{row.txn_date || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "batches" ? (
          <section style={cardStyle}>
            <h2 style={h2Style}>Settlement Batches</h2>
            <p style={subtitleStyle}>Processed batches for Amazon settlements.</p>
            {batchLoading ? <p>Loading batches…</p> : null}
            {batchError ? <p style={{ color: "#b91c1c" }}>{batchError}</p> : null}
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Batch Ref</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Period</th>
                    <th style={tableHeaderCellStyle}>Currency</th>
                    <th style={tableHeaderCellStyle}>Uploaded</th>
                    <th style={tableHeaderCellStyle}>Processed</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row) => (
                    <tr key={row.id}>
                      <td style={tableCellStyle}>{row.batch_ref || "—"}</td>
                      <td style={tableCellStyle}>{row.status}</td>
                      <td style={tableCellStyle}>
                        {row.period_start || "—"} → {row.period_end || "—"}
                      </td>
                      <td style={tableCellStyle}>{row.currency || "INR"}</td>
                      <td style={tableCellStyle}>{row.uploaded_at ? row.uploaded_at.slice(0, 10) : "—"}</td>
                      <td style={tableCellStyle}>{row.processed_at ? row.processed_at.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                  {batchRows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={6}>
                        No batches processed yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "sku" ? (
          <section style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle}>
              <h2 style={h2Style}>SKU Profitability</h2>
              <p style={subtitleStyle}>Filter by date range and SKU to view contribution margin.</p>
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span>From</span>
                  <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>To</span>
                  <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>SKU search</span>
                  <input value={skuQuery} onChange={(event) => setSkuQuery(event.target.value)} style={inputStyle} />
                </label>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span style={badgeStyle}>Net payout: {currencyFormatter.format(summaryTotals.net_payout)}</span>
                <span style={badgeStyle}>Fees: {currencyFormatter.format(summaryTotals.total_fees)}</span>
                <span style={badgeStyle}>Refunds: {currencyFormatter.format(summaryTotals.refunds)}</span>
                <span style={badgeStyle}>Gross sales: {currencyFormatter.format(summaryTotals.gross_sales)}</span>
              </div>
              {skuLoading ? <p style={{ marginTop: 12 }}>Loading SKU margins…</p> : null}
              {skuError ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{skuError}</p> : null}
              <div style={{ marginTop: 16, overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>SKU</th>
                      <th style={tableHeaderCellStyle}>Qty</th>
                      <th style={tableHeaderCellStyle}>Net Payout</th>
                      <th style={tableHeaderCellStyle}>Fees</th>
                      <th style={tableHeaderCellStyle}>Refunds</th>
                      <th style={tableHeaderCellStyle}>Est Unit Cost</th>
                      <th style={tableHeaderCellStyle}>COGS</th>
                      <th style={tableHeaderCellStyle}>Contribution</th>
                      <th style={tableHeaderCellStyle}>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuRows.map((row) => (
                      <tr key={row.sku}>
                        <td style={tableCellStyle}>{row.sku}</td>
                        <td style={tableCellStyle}>{row.qty}</td>
                        <td style={tableCellStyle}>{row.net_payout ? currencyFormatter.format(row.net_payout) : "—"}</td>
                        <td style={tableCellStyle}>{row.total_fees ? currencyFormatter.format(row.total_fees) : "—"}</td>
                        <td style={tableCellStyle}>{row.refunds ? currencyFormatter.format(row.refunds) : "—"}</td>
                        <td style={tableCellStyle}>
                          {row.est_unit_cost ? currencyFormatter.format(row.est_unit_cost) : "Cost missing"}
                        </td>
                        <td style={tableCellStyle}>{row.est_cogs ? currencyFormatter.format(row.est_cogs) : "—"}</td>
                        <td style={tableCellStyle}>
                          {row.contribution ? currencyFormatter.format(row.contribution) : "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.margin_pct !== null ? `${(row.margin_pct * 100).toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                    {skuRows.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={9}>
                          No SKU data for the selected range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={cardStyle}>
              <h2 style={h2Style}>SKU Cost Overrides</h2>
              <p style={subtitleStyle}>
                Add manual unit costs when valuation data is missing. Costs are effective-dated.
              </p>
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span>SKU</span>
                  <input value={overrideSku} onChange={(event) => setOverrideSku(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Unit Cost</span>
                  <input value={overrideCost} onChange={(event) => setOverrideCost(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Effective From</span>
                  <input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} style={inputStyle} />
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={handleOverrideSave} style={primaryButtonStyle}>
                  Save Cost Override
                </button>
              </div>
              {overrideError ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{overrideError}</p> : null}
              {overrideSuccess ? <p style={{ marginTop: 12, color: "#0f766e" }}>{overrideSuccess}</p> : null}
              {overrideLoading ? <p style={{ marginTop: 12 }}>Loading overrides…</p> : null}
              {overrideRows.length > 0 ? (
                <div style={{ marginTop: 16, overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>SKU</th>
                        <th style={tableHeaderCellStyle}>Unit Cost</th>
                        <th style={tableHeaderCellStyle}>Effective From</th>
                        <th style={tableHeaderCellStyle}>Effective To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrideRows.map((row) => (
                        <tr key={row.id}>
                          <td style={tableCellStyle}>{row.sku}</td>
                          <td style={tableCellStyle}>{currencyFormatter.format(row.unit_cost)}</td>
                          <td style={tableCellStyle}>{row.effective_from}</td>
                          <td style={tableCellStyle}>{row.effective_to || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "orders" ? (
          <section style={{ display: "grid", gap: 20 }}>
            <div style={cardStyle}>
              <h2 style={h2Style}>Orders Drilldown</h2>
              <p style={subtitleStyle}>Search orders and drill into line-level profitability.</p>
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span>From</span>
                  <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>To</span>
                  <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Order search</span>
                  <input value={orderQuery} onChange={(event) => setOrderQuery(event.target.value)} style={inputStyle} />
                </label>
              </div>
              {orderLoading ? <p style={{ marginTop: 12 }}>Loading orders…</p> : null}
              {orderError ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{orderError}</p> : null}
              <div style={{ marginTop: 16, overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Order ID</th>
                      <th style={tableHeaderCellStyle}>Transactions</th>
                      <th style={tableHeaderCellStyle}>Qty</th>
                      <th style={tableHeaderCellStyle}>Net Payout</th>
                      <th style={tableHeaderCellStyle}>COGS</th>
                      <th style={tableHeaderCellStyle}>Contribution</th>
                      <th style={tableHeaderCellStyle}>Margin %</th>
                      <th style={tableHeaderCellStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderRows.map((row) => (
                      <tr key={row.order_id}>
                        <td style={tableCellStyle}>{row.order_id}</td>
                        <td style={tableCellStyle}>{row.txn_count}</td>
                        <td style={tableCellStyle}>{row.qty}</td>
                        <td style={tableCellStyle}>{row.net_payout ? currencyFormatter.format(row.net_payout) : "—"}</td>
                        <td style={tableCellStyle}>{row.est_cogs ? currencyFormatter.format(row.est_cogs) : "—"}</td>
                        <td style={tableCellStyle}>
                          {row.contribution ? currencyFormatter.format(row.contribution) : "—"}
                        </td>
                        <td style={tableCellStyle}>
                          {row.margin_pct !== null ? `${(row.margin_pct * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td style={tableCellStyle}>
                          <button
                            type="button"
                            onClick={() => setSelectedOrderId(row.order_id)}
                            style={secondaryButtonStyle}
                          >
                            View lines
                          </button>
                        </td>
                      </tr>
                    ))}
                    {orderRows.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={8}>
                          No orders for the selected range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={cardStyle}>
              <h2 style={h2Style}>Order Lines {selectedOrderId ? `· ${selectedOrderId}` : ""}</h2>
              <p style={subtitleStyle}>Line-level payouts, fees, and costs for the selected order.</p>
              {orderLinesLoading ? <p style={{ marginTop: 12 }}>Loading lines…</p> : null}
              {orderLinesError ? <p style={{ marginTop: 12, color: "#b91c1c" }}>{orderLinesError}</p> : null}
              {!selectedOrderId ? <p style={{ marginTop: 12 }}>Select an order to view line details.</p> : null}
              {selectedOrderId && orderLineRows.length > 0 ? (
                <div style={{ marginTop: 16, overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Date</th>
                        <th style={tableHeaderCellStyle}>SKU</th>
                        <th style={tableHeaderCellStyle}>Qty</th>
                        <th style={tableHeaderCellStyle}>Gross</th>
                        <th style={tableHeaderCellStyle}>Net Payout</th>
                        <th style={tableHeaderCellStyle}>Fees</th>
                        <th style={tableHeaderCellStyle}>Refunds</th>
                        <th style={tableHeaderCellStyle}>Unit Cost</th>
                        <th style={tableHeaderCellStyle}>COGS</th>
                        <th style={tableHeaderCellStyle}>Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderLineRows.map((row, index) => (
                        <tr key={`${row.sku}-${index}`}>
                          <td style={tableCellStyle}>{row.txn_date || "—"}</td>
                          <td style={tableCellStyle}>{row.sku || "—"}</td>
                          <td style={tableCellStyle}>{row.qty}</td>
                          <td style={tableCellStyle}>{row.gross_sales ? currencyFormatter.format(row.gross_sales) : "—"}</td>
                          <td style={tableCellStyle}>{row.net_payout ? currencyFormatter.format(row.net_payout) : "—"}</td>
                          <td style={tableCellStyle}>{row.fees ? currencyFormatter.format(row.fees) : "—"}</td>
                          <td style={tableCellStyle}>{row.refunds ? currencyFormatter.format(row.refunds) : "—"}</td>
                          <td style={tableCellStyle}>{row.est_unit_cost ? currencyFormatter.format(row.est_unit_cost) : "—"}</td>
                          <td style={tableCellStyle}>{row.est_cogs ? currencyFormatter.format(row.est_cogs) : "—"}</td>
                          <td style={tableCellStyle}>
                            {row.contribution ? currencyFormatter.format(row.contribution) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}
