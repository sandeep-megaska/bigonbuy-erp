import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Papa from "papaparse";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: { access_token?: string } | null;
  email: string | null;
  userId: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
};

type SettlementRow = {
  id: string;
  razorpay_settlement_id: string;
  settlement_utr: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  settled_at: string | null;
  fetched_at: string | null;
  posted_journal_id: string | null;
  posted_doc_no: string | null;
  post_status: string | null;
};

type CsvPreviewRow = {
  settlement_id: string | null;
  settlement_utr: string | null;
  amount: number | null;
  status: string | null;
  currency: string | null;
  settled_at: string | null;
};

type CsvMapping = {
  settlementId: string | null;
  utr: string | null;
  amount: string | null;
  status: string | null;
  currency: string | null;
  settledAt: string | null;
};

type CsvParsedRow = Record<string, string>;
type RazorpayConfig = {
  razorpay_key_id?: string | null;
  razorpay_clearing_account_id?: string | null;
  bank_account_id?: string | null;
  gateway_fees_account_id?: string | null;
  gst_input_on_fees_account_id?: string | null;
  has_key_secret?: boolean | null;
};
type PreviewData = Record<string, unknown>;

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const labelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const hintStyle = {
  fontSize: 12,
  color: "#6b7280",
};

const formatAccountLabel = (account: AccountOption | null) => {
  if (!account) return "";
  return `${account.code} · ${account.name}`;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB") : "—";

const formatAmount = (value: number | null) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const csvHeaderAliases = {
  settlementId: ["settlement_id", "settlementid", "id", "settlement"],
  utr: ["utr", "bank_utr", "utr_number", "bankutr"],
  amount: ["amount", "settled_amount", "net_amount", "netamount"],
  status: ["status", "settlement_status"],
  currency: ["currency", "curr", "settlement_currency"],
  settledAt: ["settled_at", "settlement_date", "created_at", "createdat", "settleddate", "date"],
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const findHeader = (headers: string[], aliases: string[]) => {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const index = normalized.indexOf(aliasKey);
    if (index >= 0) return headers[index];
  }
  return null;
};

const parseCsvAmount = (value: unknown) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const parseCsvDate = (value: unknown) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    const millis = raw.length >= 13 ? numeric : numeric * 1000;
    const asDate = new Date(millis);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
  }
  const dayFirstMatch = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/
  );
  if (dayFirstMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw, secondRaw] = dayFirstMatch;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    const hour = Number(hourRaw ?? 0);
    const minute = Number(minuteRaw ?? 0);
    const second = Number(secondRaw ?? 0);
    const parsedDayFirst = new Date(year, month - 1, day, hour, minute, second);
    if (
      !Number.isNaN(parsedDayFirst.getTime()) &&
      parsedDayFirst.getFullYear() === year &&
      parsedDayFirst.getMonth() === month - 1 &&
      parsedDayFirst.getDate() === day
    ) {
      return parsedDayFirst.toISOString();
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

export default function RazorpaySettlementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");

  const [form, setForm] = useState({
    razorpayKeyId: "",
    razorpayKeySecret: "",
    razorpayClearingAccountId: "",
    bankAccountId: "",
    gatewayFeesAccountId: "",
    gstInputOnFeesAccountId: "",
    hasKeySecret: false,
  });

  const [clearingQuery, setClearingQuery] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [feesQuery, setFeesQuery] = useState("");
  const [gstQuery, setGstQuery] = useState("");

  const [clearingOptions, setClearingOptions] = useState<AccountOption[]>([]);
  const [bankOptions, setBankOptions] = useState<AccountOption[]>([]);
  const [feesOptions, setFeesOptions] = useState<AccountOption[]>([]);
  const [gstOptions, setGstOptions] = useState<AccountOption[]>([]);

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvPreviewRow[]>([]);
  const [csvParsedRows, setCsvParsedRows] = useState<CsvParsedRow[]>([]);
  const [csvRowCount, setCsvRowCount] = useState(0);
  const [csvMapping, setCsvMapping] = useState<CsvMapping | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportSummary, setCsvImportSummary] = useState<{
    parsed: number;
    attempted: number;
    inserted: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: unknown[];
  } | null>(null);
  const [csvError, setCsvError] = useState("");

  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [endDate, setEndDate] = useState(() => new Date());

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const getAuthHeaders = (tokenOverride?: string | null): HeadersInit => {
    const token = tokenOverride ?? ctx?.session?.access_token;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadSettlements = async (token?: string | null) => {
    try {
      const payload = await apiGet<{ data?: SettlementRow[] }>("/api/finance/razorpay/settlements", {
        headers: getAuthHeaders(token),
      });
      setSettlements((payload?.data || []) as SettlementRow[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load settlements.";
      setError(message);
    }
  };

  const loadConfigAndSettlements = async (token?: string | null) => {
    const payload = await apiGet<{ data?: RazorpayConfig }>("/api/finance/razorpay/settlements/config", {
      headers: getAuthHeaders(token),
    });

    const config = payload?.data;
    if (config) {
      setForm((prev) => ({
        ...prev,
        razorpayKeyId: config.razorpay_key_id ?? "",
        razorpayClearingAccountId: config.razorpay_clearing_account_id ?? "",
        bankAccountId: config.bank_account_id ?? "",
        gatewayFeesAccountId: config.gateway_fees_account_id ?? "",
        gstInputOnFeesAccountId: config.gst_input_on_fees_account_id ?? "",
        hasKeySecret: Boolean(config.has_key_secret),
      }));
    }

    await loadSettlements(token);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await requireAuthRedirectHome(router);
        if (!session || !active) return;

        const context = await getCompanyContext(session);
        if (!active) return;

        setCtx(context as CompanyContext);
        if (!context.companyId) {
          setError(context.membershipError || "No active company membership found for this user.");
          return;
        }

        const token = (context as CompanyContext)?.session?.access_token ?? null;
        await loadConfigAndSettlements(token);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unable to load Razorpay settlement config.";
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (clearingQuery.trim()) params.set("q", clearingQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setClearingOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load clearing accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [clearingQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (bankQuery.trim()) params.set("q", bankQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setBankOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load bank accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bankQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (feesQuery.trim()) params.set("q", feesQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setFeesOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load fee accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [feesQuery, ctx?.session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (gstQuery.trim()) params.set("q", gstQuery.trim());
        const payload = await apiGet<{ data?: AccountOption[] }>(
          `/api/finance/gl-accounts/picklist?${params.toString()}`,
          {
            headers: getAuthHeaders(),
          }
        );
        if (!active) return;
        setGstOptions((payload?.data || []) as AccountOption[]);
      } catch (e) {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Failed to load GST input accounts.";
        setError(message);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gstQuery, ctx?.session?.access_token]);

  const handleSave = async () => {
    if (!canWrite) {
      setError("Only finance admins can update Razorpay settlement config.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await apiPost(
        "/api/finance/razorpay/settlements/config",
        {
          razorpayKeyId: form.razorpayKeyId.trim(),
          razorpayKeySecret: form.razorpayKeySecret.trim() || null,
          razorpayClearingAccountId: form.razorpayClearingAccountId || null,
          bankAccountId: form.bankAccountId || null,
          gatewayFeesAccountId: form.gatewayFeesAccountId || null,
          gstInputOnFeesAccountId: form.gstInputOnFeesAccountId || null,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Razorpay settlement config updated.");
      setForm((prev) => ({ ...prev, razorpayKeySecret: "", hasKeySecret: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to save Razorpay settlement config.";
      setError(message || "Unable to save Razorpay settlement config.");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!ctx?.session?.access_token) return;
    setSyncing(true);
    setSyncNotice("");
    setError("");

    try {
      const payload = await apiPost<{ data?: { ingested?: number } }>(
        "/api/finance/razorpay/settlements/sync",
        {
          start_date: formatDateInput(startDate),
          end_date: formatDateInput(endDate),
        },
        { headers: getAuthHeaders() }
      );
      setSyncNotice(`Synced ${payload.data?.ingested ?? 0} settlements.`);
      await loadSettlements();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed.";
      setError(message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async () => {
    if (!ctx?.companyId) return;
    setLoading(true);
    setError("");
    try {
      await loadConfigAndSettlements(ctx?.session?.access_token ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load Razorpay settlements.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCsvFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvPreviewRows([]);
    setCsvParsedRows([]);
    setCsvRowCount(0);
    setCsvMapping(null);
    setCsvImportSummary(null);
    setCsvError("");

    if (!file) return;

    const csvText = await file.text();
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      setCsvError("Unable to parse CSV. Please check the file format.");
      return;
    }

    const rows = (parsed.data || []) as CsvParsedRow[];
    if (!rows.length) {
      setCsvError("CSV is empty.");
      return;
    }

    const headers = Object.keys(rows[0] || {});
    const settlementIdHeader = findHeader(headers, csvHeaderAliases.settlementId);
    if (!settlementIdHeader) {
      setCsvError("CSV is missing a settlement id column.");
      return;
    }

    const mapping: CsvMapping = {
      settlementId: settlementIdHeader,
      utr: findHeader(headers, csvHeaderAliases.utr),
      amount: findHeader(headers, csvHeaderAliases.amount),
      status: findHeader(headers, csvHeaderAliases.status),
      currency: findHeader(headers, csvHeaderAliases.currency),
      settledAt: findHeader(headers, csvHeaderAliases.settledAt),
    };

    const mappedRows: CsvPreviewRow[] = rows.map((row) => ({
      settlement_id: String(row[settlementIdHeader] ?? "").trim() || null,
      settlement_utr: mapping.utr ? String(row[mapping.utr] ?? "").trim() || null : null,
      amount: mapping.amount ? parseCsvAmount(row[mapping.amount]) : null,
      status: mapping.status ? String(row[mapping.status] ?? "").trim() || null : null,
      currency: mapping.currency ? String(row[mapping.currency] ?? "").trim() || null : null,
      settled_at: mapping.settledAt ? parseCsvDate(row[mapping.settledAt]) : null,
    }));

    setCsvParsedRows(rows);
    setCsvRowCount(mappedRows.length);
    setCsvPreviewRows(mappedRows.slice(0, 10));
    setCsvMapping(mapping);
  };

  const handleCsvImport = async () => {
    if (!csvFile) {
      setCsvError("Please select a CSV file to import.");
      return;
    }
    if (!canWrite) {
      setCsvError("Only finance admins can import settlements.");
      return;
    }
    if (!csvParsedRows.length) {
      setCsvError("Please select a CSV file to import.");
      return;
    }

    setCsvImporting(true);
    setCsvError("");
    setCsvImportSummary(null);

    try {
      const payload = await apiPost<{
        data?: {
          parsed_count?: number;
          attempted_count?: number;
          inserted_count?: number;
          updated_count?: number;
          skipped_count?: number;
          failed_count?: number;
          errors?: string[];
        };
      }>(
        "/api/finance/razorpay/settlements/import-csv",
        { rows: csvParsedRows },
        { headers: getAuthHeaders() }
      );

      setCsvImportSummary({
        parsed: payload.data?.parsed_count ?? csvParsedRows.length,
        attempted: payload.data?.attempted_count ?? csvParsedRows.length,
        inserted: payload.data?.inserted_count ?? 0,
        updated: payload.data?.updated_count ?? 0,
        skipped: payload.data?.skipped_count ?? 0,
        failed: payload.data?.failed_count ?? 0,
        errors: payload.data?.errors ?? [],
      });

      await loadSettlements();
    } catch (e) {
      const message = e instanceof Error ? e.message : "CSV import failed.";
      setCsvError(message || "CSV import failed.");
    } finally {
      setCsvImporting(false);
    }
  };

  const handlePreview = async (settlementId: string) => {
    setPreviewLoading(true);
    setSelectedSettlementId(settlementId);
    setPreviewData(null);
    setError("");

    try {
      const payload = await apiPost<{ data?: PreviewData | null }>(
        `/api/finance/razorpay/settlements/${settlementId}/preview`,
        {},
        { headers: getAuthHeaders() }
      );
      setPreviewData(payload.data || null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load preview.";
      setError(message || "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePost = async (settlementId: string) => {
    if (!canWrite) {
      setError("Only finance admins can post settlements.");
      return;
    }
    setError("");

    try {
      await apiPost(`/api/finance/razorpay/settlements/${settlementId}/post`, {}, { headers: getAuthHeaders() });
      await loadSettlements();
      if (selectedSettlementId === settlementId) {
        await handlePreview(settlementId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to post settlement.";
      setError(message || "Failed to post settlement.");
    }
  };

  const selectedClearing = clearingOptions.find((option) => option.id === form.razorpayClearingAccountId) || null;
  const selectedBank = bankOptions.find((option) => option.id === form.bankAccountId) || null;
  const selectedFees = feesOptions.find((option) => option.id === form.gatewayFeesAccountId) || null;
  const selectedGst = gstOptions.find((option) => option.id === form.gstInputOnFeesAccountId) || null;
  const csvRowsToImport = csvParsedRows.length;
  const csvRowsParsed = csvImportSummary?.parsed ?? csvRowCount;
  const csvRowsAttempted = csvImportSummary?.attempted ?? csvRowsToImport;
  const csvRowsImported = csvImportSummary ? csvImportSummary.inserted + csvImportSummary.updated : 0;
  const csvRowsFailed = csvImportSummary?.failed ?? 0;

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Razorpay settlements…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Razorpay Settlements"
            description="Sync Razorpay settlements and post finance journals."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Razorpay Settlements"
          description="Sync Razorpay settlements and post bank journals."
          rightActions={
            <button
              type="button"
              onClick={handleSave}
              style={{
                ...secondaryButtonStyle,
                backgroundColor: canWrite ? "#111827" : "#9ca3af",
                color: "#fff",
                borderColor: "transparent",
                opacity: saving ? 0.7 : 1,
              }}
              disabled={!canWrite || saving}
            >
              {saving ? "Saving…" : "Save Config"}
            </button>
          }
        />

        {error ? (
          <div
            style={{
              ...cardStyle,
              borderColor: "#fecaca",
              color: "#b91c1c",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>{error}</span>
            <button type="button" style={secondaryButtonStyle} onClick={handleRetry} disabled={loading}>
              Retry
            </button>
          </div>
        ) : null}

        <div style={{ ...cardStyle, marginTop: 0 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Link href="/erp/finance/masters/gl-accounts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Open Chart of Accounts
            </Link>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <label style={labelStyle}>
              Razorpay Key ID
              <input
                style={inputStyle}
                value={form.razorpayKeyId}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayKeyId: event.target.value }))}
                placeholder="rzp_test_..."
              />
            </label>
            <label style={labelStyle}>
              Razorpay Key Secret
              <input
                style={inputStyle}
                type="password"
                value={form.razorpayKeySecret}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayKeySecret: event.target.value }))}
                placeholder={form.hasKeySecret ? "Saved — enter to update" : "Enter Razorpay secret"}
              />
              {form.hasKeySecret && !form.razorpayKeySecret ? (
                <span style={hintStyle}>Secret stored. Leave blank to keep existing.</span>
              ) : null}
            </label>

            <label style={labelStyle}>
              Razorpay Clearing Account (1102)
              <input
                style={inputStyle}
                value={clearingQuery}
                onChange={(event) => setClearingQuery(event.target.value)}
                placeholder="Search clearing account by code or name"
              />
              <select
                style={inputStyle}
                value={form.razorpayClearingAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, razorpayClearingAccountId: event.target.value }))}
              >
                <option value="">Select clearing account</option>
                {clearingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedClearing
                  ? `Selected: ${formatAccountLabel(selectedClearing)}`
                  : `ID: ${form.razorpayClearingAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              Bank Account (ICICI)
              <input
                style={inputStyle}
                value={bankQuery}
                onChange={(event) => setBankQuery(event.target.value)}
                placeholder="Search bank account by code or name"
              />
              <select
                style={inputStyle}
                value={form.bankAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, bankAccountId: event.target.value }))}
              >
                <option value="">Select bank account</option>
                {bankOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedBank ? `Selected: ${formatAccountLabel(selectedBank)}` : `ID: ${form.bankAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              Gateway Fees Account (optional)
              <input
                style={inputStyle}
                value={feesQuery}
                onChange={(event) => setFeesQuery(event.target.value)}
                placeholder="Search gateway fees account by code or name"
              />
              <select
                style={inputStyle}
                value={form.gatewayFeesAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, gatewayFeesAccountId: event.target.value }))}
              >
                <option value="">Select fees account</option>
                {feesOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedFees ? `Selected: ${formatAccountLabel(selectedFees)}` : `ID: ${form.gatewayFeesAccountId}`}
              </span>
            </label>

            <label style={labelStyle}>
              GST Input on Fees Account (optional)
              <input
                style={inputStyle}
                value={gstQuery}
                onChange={(event) => setGstQuery(event.target.value)}
                placeholder="Search GST input account by code or name"
              />
              <select
                style={inputStyle}
                value={form.gstInputOnFeesAccountId}
                onChange={(event) => setForm((prev) => ({ ...prev, gstInputOnFeesAccountId: event.target.value }))}
              >
                <option value="">Select GST input account</option>
                {gstOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code} · {option.name}
                  </option>
                ))}
              </select>
              <span style={hintStyle}>
                {selectedGst
                  ? `Selected: ${formatAccountLabel(selectedGst)}`
                  : `ID: ${form.gstInputOnFeesAccountId}`}
              </span>
            </label>
          </div>

          {notice ? <div style={{ marginTop: 12, color: "#047857", fontSize: 13 }}>{notice}</div> : null}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Sync from Razorpay</h3>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label style={labelStyle}>
              Start Date
              <input
                style={inputStyle}
                type="date"
                value={formatDateInput(startDate)}
                onChange={(event) => setStartDate(new Date(event.target.value))}
              />
            </label>
            <label style={labelStyle}>
              End Date
              <input
                style={inputStyle}
                type="date"
                value={formatDateInput(endDate)}
                onChange={(event) => setEndDate(new Date(event.target.value))}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={handleSync}
              style={{
                ...primaryButtonStyle,
                backgroundColor: syncing ? "#6b7280" : "#111827",
              }}
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Sync from Razorpay"}
            </button>
            {syncNotice ? <span style={{ fontSize: 13, color: "#047857" }}>{syncNotice}</span> : null}
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Import CSV</h3>
          <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>
            Upload a Razorpay settlements CSV export to backfill payouts without API access.
          </p>
          <label style={labelStyle}>
            Settlement CSV
            <input type="file" accept=".csv" onChange={handleCsvFileChange} style={inputStyle} />
          </label>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleCsvImport}
              style={{
                ...primaryButtonStyle,
                backgroundColor: csvImporting || !canWrite ? "#9ca3af" : "#111827",
              }}
              disabled={csvImporting || !canWrite || !csvFile}
            >
              {csvImporting ? "Importing…" : "Import CSV"}
            </button>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {csvRowCount ? `${csvRowCount} rows detected` : "Select a CSV to preview rows"}
            </span>
            {!canWrite ? <span style={{ fontSize: 13, color: "#b45309" }}>Finance role required</span> : null}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: "#374151" }}>
            <div>Rows parsed: {csvRowsParsed}</div>
            <div>Rows attempted: {csvRowsAttempted}</div>
            <div>Inserted: {csvImportSummary?.inserted ?? 0}</div>
            <div>Updated: {csvImportSummary?.updated ?? 0}</div>
            <div>Failed: {csvRowsFailed}</div>
          </div>
          {csvMapping ? (
            <div style={{ marginTop: 12, fontSize: 13, color: "#374151" }}>
              <strong>Mapped columns:</strong>
              <ul style={{ margin: "6px 0 0 18px" }}>
                <li>Settlement ID → {csvMapping.settlementId || "Not found"}</li>
                <li>UTR → {csvMapping.utr || "Not found"}</li>
                <li>Amount → {csvMapping.amount || "Not found"}</li>
                <li>Status → {csvMapping.status || "Not found"}</li>
                <li>Currency → {csvMapping.currency || "Not found"}</li>
                <li>Settled At → {csvMapping.settledAt || "Not found"}</li>
              </ul>
            </div>
          ) : null}
          {csvImportSummary ? (
            <div style={{ marginTop: 12, fontSize: 13, color: "#047857" }}>
              Imported {csvImportSummary.inserted} new, updated {csvImportSummary.updated}, skipped {csvImportSummary.skipped}.
              {csvImportSummary.errors.length
                ? ` ${csvImportSummary.errors.length} rows had errors.`
                : null}
            </div>
          ) : null}
          {csvImportSummary?.errors.length ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "#b91c1c", marginBottom: 8 }}>Row errors (first 20)</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Row</th>
                    <th style={tableHeaderCellStyle}>Settlement ID</th>
                    <th style={tableHeaderCellStyle}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {csvImportSummary.errors.slice(0, 20).map((err: any, index: number) => (
                    <tr key={`csv-error-${index}`}>
                      <td style={tableCellStyle}>{err?.line ?? "—"}</td>
                      <td style={tableCellStyle}>{err?.settlement_id ?? "—"}</td>
                      <td style={tableCellStyle}>{err?.reason ?? "Unknown error"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {csvError ? <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 13 }}>{csvError}</div> : null}
          {csvPreviewRows.length ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Preview (first 10 rows)</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Settlement ID</th>
                    <th style={tableHeaderCellStyle}>UTR</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Currency</th>
                    <th style={tableHeaderCellStyle}>Settled At</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreviewRows.map((row, index) => (
                    <tr key={`${row.settlement_id ?? "row"}-${index}`}>
                      <td style={tableCellStyle}>{row.settlement_id || "—"}</td>
                      <td style={tableCellStyle}>{row.settlement_utr || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount)}</td>
                      <td style={tableCellStyle}>{row.status || "—"}</td>
                      <td style={tableCellStyle}>{row.currency || "—"}</td>
                      <td style={tableCellStyle}>{row.settled_at ? formatDate(row.settled_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Settlement</th>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Posted</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {settlements.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No settlements synced yet.
                  </td>
                </tr>
              ) : (
                settlements.map((settlement) => (
                  <tr key={settlement.id}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{settlement.razorpay_settlement_id}</div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{settlement.settlement_utr || "—"}</div>
                    </td>
                    <td style={tableCellStyle}>{formatDate(settlement.settled_at)}</td>
                    <td style={tableCellStyle}>{formatAmount(settlement.amount)}</td>
                    <td style={tableCellStyle}>{settlement.status || "—"}</td>
                    <td style={tableCellStyle}>
                      {settlement.posted_journal_id ? (
                        <Link href={`/erp/finance/journals/${settlement.posted_journal_id}`}>
                          {settlement.posted_doc_no || "View Journal"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handlePreview(settlement.razorpay_settlement_id)}
                          style={secondaryButtonStyle}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePost(settlement.razorpay_settlement_id)}
                          style={{
                            ...secondaryButtonStyle,
                            backgroundColor: canWrite ? "#111827" : "#9ca3af",
                            color: "#fff",
                            borderColor: "transparent",
                          }}
                          disabled={!canWrite}
                        >
                          Post
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Settlement Preview</h3>
          {previewLoading ? (
            <p>Loading preview…</p>
          ) : previewData ? (
            <pre
              style={{
                margin: 0,
                background: "#0f172a",
                color: "#e2e8f0",
                padding: 16,
                borderRadius: 8,
                fontSize: 12,
                overflowX: "auto",
              }}
            >
              {JSON.stringify(previewData, null, 2)}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>
              Select a settlement to preview the journal lines before posting.
            </p>
          )}
        </div>
      </div>
    </ErpShell>
  );
}
