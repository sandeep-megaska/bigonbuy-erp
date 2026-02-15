import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
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
import {
  amazonSettlementPostingListSchema,
  amazonSettlementPostingPreviewSchema,
  amazonSettlementPostingSummarySchema,
  type AmazonSettlementPostingPreview,
  type AmazonSettlementPostingRow,
  type AmazonSettlementPostingSummary,
} from "../../../../lib/erp/amazonSettlementPosting";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

const formatLocalDate = (date: Date) => date.toLocaleDateString("en-CA");
const today = () => formatLocalDate(new Date());

const startOfPreviousMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return formatLocalDate(first);
};

const parseDateQuery = (value: string | string[] | undefined) => {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

const loadStoredRange = (companyId: string) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`erp_amazon_settlement_posting_range_${companyId}`);
    if (!raw) return null;
    const parsed = z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const persistStoredRange = (companyId: string, from: string, to: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`erp_amazon_settlement_posting_range_${companyId}`, JSON.stringify({ from, to }));
  } catch {
    return;
  }
};

const roleLabelByKey: Record<string, string> = {
  amazon_settlement_sales_account: "Amazon Sales (Net of tax if that’s your policy)",
  amazon_settlement_fees_account: "Amazon Marketplace Fees",
  amazon_settlement_refunds_account: "Amazon Sales Returns",
  amazon_settlement_adjustments_account: "Amazon Adjustments",
  amazon_settlement_clearing_account: "Amazon Settlement Clearing",
};

const formatAmount = (value: number | null | undefined) => `₹${Number(value || 0).toFixed(2)}`;

const previewPanelStyle = {
  margin: "8px 0 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#f8fafc",
  padding: 12,
};

type InlinePreviewPanelProps = {
  row: AmazonSettlementPostingRow;
  preview?: AmazonSettlementPostingPreview;
  loading: boolean;
  canWrite: boolean;
  postingBatchId: string | null;
  panelError?: string;
  onClose: () => void;
  onPost: () => void;
};

function InlinePreviewPanel({ row, preview, loading, canWrite, postingBatchId, panelError, onClose, onPost }: InlinePreviewPanelProps) {
  const period = [preview?.period_start, preview?.period_end].filter(Boolean).join(" → ") || "—";

  return (
    <div style={previewPanelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Journal preview</div>
          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2 }}>
            Batch {row.batch_ref || row.batch_id} · Period {period} · Currency {preview?.currency || row.currency || "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            title={!preview?.can_post ? "Resolve warnings or account mappings before posting." : undefined}
            style={primaryButtonStyle}
            disabled={!canWrite || row.posting_state !== "missing" || Number(row.txn_count ?? 0) === 0 || postingBatchId === row.batch_id || !preview || preview.can_post === false}
            onClick={onPost}
          >
            {postingBatchId === row.batch_id ? "Posting…" : "Post to Finance"}
          </button>
        </div>
      </div>

      {loading ? <div style={{ marginTop: 12, fontSize: 13 }}>Loading preview…</div> : null}
      {panelError ? (
        <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, background: "#fee2e2", color: "#991b1b" }}>{panelError}</div>
      ) : null}

      {!loading && preview ? (
        <>
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#eef2ff", color: "#3730a3", fontSize: 12 }}>
            Posting settings: use Sales, Fees, Returns, Adjustments, and Settlement Clearing control-role mappings to align Amazon posting practice.
          </div>

          {!preview.can_post ? (
            <div style={{ marginTop: 10, color: "#92400e", fontSize: 12 }}>Posting is disabled for this batch until warnings/mappings are resolved.</div>
          ) : null}

          {preview.warnings?.length ? (
            <div style={{ marginTop: 10, color: "#b45309" }}>
              <div style={{ fontWeight: 600 }}>Warnings</div>
              <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Role</th>
                  <th style={tableHeaderCellStyle}>Account</th>
                  <th style={tableHeaderCellStyle}>Debit</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={4}>
                      No journal lines available.
                    </td>
                  </tr>
                ) : (
                  preview.lines.map((line, idx) => {
                    const isSalesShippingMap =
                      line.role_key === "amazon_settlement_sales_account" &&
                      typeof line.account_name === "string" &&
                      line.account_name.toLowerCase().includes("shipping");

                    return (
                      <tr key={`${line.role_key}-${idx}`}>
                        <td style={tableCellStyle}>
                          <div style={{ fontWeight: 600 }}>{roleLabelByKey[line.role_key] || line.label || line.role_key}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>{line.role_key}</div>
                        </td>
                        <td style={tableCellStyle}>
                          <div style={{ fontWeight: 600 }}>{line.account_name || "—"}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{line.account_code || ""}</div>
                          {isSalesShippingMap ? (
                            <div style={{ marginTop: 4, color: "#b45309", fontSize: 12 }}>
                              Sales role mapped to account '{line.account_name} ({line.account_code || "—"})'. Verify mapping.
                            </div>
                          ) : null}
                        </td>
                        <td style={tableCellStyle}>{formatAmount(line.dr)}</td>
                        <td style={tableCellStyle}>{formatAmount(line.cr)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, fontSize: 12, color: "#374151" }}>
            <div>Total debit: {formatAmount(preview.totals?.total_debit)}</div>
            <div>Total credit: {formatAmount(preview.totals?.total_credit)}</div>
            <div>Net payout: {formatAmount(preview.totals?.net_payout)}</div>
            <div>Sales: {formatAmount(preview.totals?.sales)}</div>
            <div>Fees: {formatAmount(preview.totals?.fees)}</div>
            <div>Refunds: {formatAmount(preview.totals?.refunds)}</div>
            <div>Adjustments: {formatAmount(preview.totals?.adjustments)}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function AmazonSettlementPostingPage() {
  const router = useRouter();

  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [fromDate, setFromDate] = useState(startOfPreviousMonth());
  const [toDate, setToDate] = useState(today());
  const [postingFilter, setPostingFilter] = useState<"all" | "posted" | "missing" | "excluded">("all");

  const [batches, setBatches] = useState<AmazonSettlementPostingRow[]>([]);
  const [postingSummary, setPostingSummary] = useState<AmazonSettlementPostingSummary | null>(null);

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [previewByBatchId, setPreviewByBatchId] = useState<Record<string, AmazonSettlementPostingPreview | undefined>>({});
  const [loadingPreviewBatchId, setLoadingPreviewBatchId] = useState<string | null>(null);
  const [errorByBatchId, setErrorByBatchId] = useState<Record<string, string | undefined>>({});

  const [postingBatchId, setPostingBatchId] = useState<string | null>(null);

  const canWrite = useMemo(() => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)), [ctx]);

  const readErrorResponse = async (response: Response, fallback: string) => {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error) return parsed.error;
      return text;
    } catch {
      return text;
    }
  };

  const getJsonRequestOptions = (method: "GET" | "POST" = "GET", body?: unknown): RequestInit => {
    const token = accessTokenRef.current;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    return {
      method,
      credentials: "include",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;

      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      // IMPORTANT: store token in ref immediately (avoids setState race)
      accessTokenRef.current = session.access_token ?? null;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      const storedRange = loadStoredRange(context.companyId);
      const initialFrom = parseDateQuery(router.query.from) ?? storedRange?.from ?? startOfPreviousMonth();
      const initialTo = parseDateQuery(router.query.to) ?? storedRange?.to ?? today();

      setFromDate(initialFrom);
      setToDate(initialTo);

      // Load AFTER token ref is set
      await Promise.all([loadBatches({ fromDate: initialFrom, toDate: initialTo }), loadSummary({ fromDate: initialFrom, toDate: initialTo })]);

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const loadSummary = async (params: { fromDate: string; toDate: string }) => {
    setIsLoadingSummary(true);
    setSummaryError(null);
    setAuthError(null);

    try {
      const response = await fetch(
        `/api/finance/amazon/settlement-posting/summary?from=${params.fromDate}&to=${params.toDate}`,
        getJsonRequestOptions()
      );

      if (response.status === 401) {
        const msg = await readErrorResponse(response, "Not authenticated");
        setAuthError(msg);
        setSummaryError(msg);
        setPostingSummary(null);
        return;
      }

      if (!response.ok) {
        setSummaryError(await readErrorResponse(response, "Failed to load posting summary."));
        setPostingSummary(null);
        return;
      }

      const payload = await response.json();
      if (!payload?.ok) {
        setSummaryError(typeof payload?.error === "string" ? payload.error : "Failed to load posting summary.");
        setPostingSummary(null);
        return;
      }

      const summaryPayload = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      const parsed = amazonSettlementPostingSummarySchema.safeParse(summaryPayload);
      if (!parsed.success) {
        setSummaryError("Failed to parse posting summary.");
        setPostingSummary(null);
        return;
      }

      setPostingSummary(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load posting summary.";
      setSummaryError(message);
      setPostingSummary(null);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const loadBatches = async (overrides?: {
    fromDate?: string;
    toDate?: string;
    postingFilter?: "all" | "posted" | "missing" | "excluded";
  }) => {
    setIsLoadingList(true);
    setError(null);
    setAuthError(null);

    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectivePostingFilter = overrides?.postingFilter ?? postingFilter;

    try {
      const response = await fetch(
        `/api/finance/amazon/settlement-posting/list?from=${effectiveFrom}&to=${effectiveTo}&status=${effectivePostingFilter}`,
        getJsonRequestOptions()
      );

      if (response.status === 401) {
        const msg = await readErrorResponse(response, "Not authenticated");
        setAuthError(msg);
        setError(msg);
        setBatches([]);
        return;
      }

      if (!response.ok) {
        setError(await readErrorResponse(response, "Failed to load Amazon settlement batches."));
        setBatches([]);
        return;
      }

      const payload = await response.json();
      if (!payload?.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Failed to load Amazon settlement batches.");
        setBatches([]);
        return;
      }

      const parsed = amazonSettlementPostingListSchema.safeParse(payload.data);
      if (!parsed.success) {
        console.error("Failed to parse Amazon settlement posting list.", { payload, error: parsed.error });
        setError("Failed to parse Amazon settlement posting list (see console).");
        setBatches([]);
        return;
      }

      setBatches(parsed.data);
      setToast(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load Amazon settlement batches.";
      setError(message);
      setBatches([]);
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadPreview = async (batchId: string) => {
    setAuthError(null);
    setErrorByBatchId((prev) => ({ ...prev, [batchId]: undefined }));
    setLoadingPreviewBatchId(batchId);

    try {
      const response = await fetch(
        `/api/finance/amazon/settlement-posting/${batchId}/preview`,
        getJsonRequestOptions()
      );

      if (response.status === 401) {
        const msg = await readErrorResponse(response, "Not authenticated");
        setAuthError(msg);
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: msg }));
        setToast({ type: "error", message: msg });
        return;
      }

      if (!response.ok) {
        const message = await readErrorResponse(response, "Failed to load preview.");
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
        setToast({ type: "error", message });
        return;
      }

      const payload = await response.json();
      if (!payload?.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Failed to load preview.";
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
        setToast({ type: "error", message });
        return;
      }

      const parsed = amazonSettlementPostingPreviewSchema.safeParse(payload.data);
      if (!parsed.success) {
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: "Failed to parse preview response." }));
        setToast({ type: "error", message: "Failed to parse preview response." });
        return;
      }

      setPreviewByBatchId((prev) => ({ ...prev, [batchId]: parsed.data }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load preview.";
      setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
      setToast({ type: "error", message });
    } finally {
      setLoadingPreviewBatchId(null);
    }
  };

  const handleTogglePreview = async (batchId: string) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      return;
    }

    setExpandedBatchId(batchId);
    if (previewByBatchId[batchId]) return;
    await loadPreview(batchId);
  };

  const handleApplyFilters = async () => {
    if (ctx?.companyId) persistStoredRange(ctx.companyId, fromDate, toDate);
    await Promise.all([loadBatches(), loadSummary({ fromDate, toDate })]);
  };

  const handlePost = async (batchId: string) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can post Amazon settlements.");
      return;
    }

    const preview = previewByBatchId[batchId];
    if (!preview || preview.can_post === false) {
      setError("Preview the journal and resolve any warnings before posting.");
      return;
    }

    if (!window.confirm(`This will create a finance journal for batch ${preview.batch_ref || batchId}. Continue?`)) return;

    setPostingBatchId(batchId);
    setError(null);

    try {
      const response = await fetch(
        `/api/finance/amazon/settlement-posting/${batchId}/post`,
        getJsonRequestOptions("POST", { batchId })
      );

      if (response.status === 401) {
        const msg = await readErrorResponse(response, "Not authenticated");
        setAuthError(msg);
        setError(msg);
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: msg }));
        setToast({ type: "error", message: msg });
        return;
      }

      if (!response.ok) {
        const message = await readErrorResponse(response, "Failed to post Amazon settlement batch.");
        setError(message);
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
        setToast({ type: "error", message });
        return;
      }

      const payload = await response.json();
      if (!payload?.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Failed to post Amazon settlement batch.";
        setError(message);
        setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
        setToast({ type: "error", message });
        return;
      }

      setErrorByBatchId((prev) => ({ ...prev, [batchId]: undefined }));
      setToast({ type: "success", message: "Amazon settlement posted to Finance." });
      setPreviewByBatchId((prev) => {
        const current = prev[batchId];
        if (!current) return prev;
        return {
          ...prev,
          [batchId]: {
            ...current,
            posted: {
              journal_id: payload.journal_id || current.posted?.journal_id || null,
              journal_no: payload.journal_no || current.posted?.journal_no || null,
            },
          },
        };
      });

      await Promise.all([loadBatches(), loadSummary({ fromDate, toDate }), loadPreview(batchId)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post Amazon settlement batch.";
      setError(message);
      setErrorByBatchId((prev) => ({ ...prev, [batchId]: message }));
      setToast({ type: "error", message });
    } finally {
      setPostingBatchId(null);
    }
  };

  const totalNetPayout = useMemo(() => batches.reduce((sum, row) => sum + Number(row.net_payout || 0), 0), [batches]);

  if (loading) return <div style={pageContainerStyle}>Loading Amazon settlement posting…</div>;

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Amazon Settlement Posting"
          description="Monitor Amazon settlement batches and post missing journals."
        />

        {toast ? (
          <section
            style={{
              ...cardStyle,
              marginBottom: 12,
              border: toast.type === "success" ? "1px solid #86efac" : "1px solid #fca5a5",
              background: toast.type === "success" ? "#f0fdf4" : "#fef2f2",
            }}
          >
            <div style={{ color: toast.type === "success" ? "#166534" : "#b91c1c", fontWeight: 600 }}>{toast.message}</div>
          </section>
        ) : null}

        {authError ? (
          <section style={{ ...cardStyle, marginBottom: 16, border: "1px solid #fca5a5", background: "#fef2f2" }}>
            <div style={{ color: "#b91c1c", fontWeight: 600 }}>Not authenticated</div>
            <div style={{ color: "#991b1b", marginTop: 4 }}>{authError}</div>
          </section>
        ) : null}

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
            </div>
            <button type="button" style={primaryButtonStyle} onClick={handleApplyFilters}>
              Apply filters
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => {
                setPostingFilter("all");
                void loadBatches({ postingFilter: "all" });
              }}
            >
              Reset
            </button>
          </div>
        </section>

        <section style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {(["all", "posted", "missing", "excluded"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setPostingFilter(option);
                void loadBatches({ postingFilter: option });
              }}
              style={{
                ...secondaryButtonStyle,
                ...(postingFilter === option ? { borderColor: "#111827", color: "#111827" } : null),
              }}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>Posting coverage</div>
            {isLoadingSummary ? <div style={{ fontSize: 12 }}>Loading…</div> : null}
          </div>
          {summaryError ? (
            <div style={{ marginTop: 8, color: "#b91c1c" }}>{summaryError}</div>
          ) : postingSummary ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Total batches</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.total_count}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.total_amount.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Posted</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.posted_count}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Missing</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.missing_count}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Excluded</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.excluded_count}</div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>No summary available.</div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>
              {isLoadingList ? "Loading batches…" : "Amazon settlement batches"} · {batches.length} records · Total ₹
              {totalNetPayout.toFixed(2)}
            </div>
            <Link href="/erp/finance/settings/coa-roles" style={secondaryButtonStyle}>
              Posting settings
            </Link>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Recommended control roles: amazon_settlement_sales_account, amazon_settlement_fees_account,
            amazon_settlement_refunds_account, amazon_settlement_adjustments_account, and amazon_settlement_clearing_account.
          </div>

          {error ? <div style={{ marginTop: 8, color: "#b91c1c" }}>{error}</div> : null}

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Settlement</th>
                  <th style={tableHeaderCellStyle}>Deposit date</th>
                  <th style={tableHeaderCellStyle}>Period</th>
                  <th style={tableHeaderCellStyle}>Net payout</th>
                  <th style={tableHeaderCellStyle}>Posting</th>
                  <th style={tableHeaderCellStyle}>Journal</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      No Amazon settlement batches found for this filter.
                    </td>
                  </tr>
                ) : (
                  batches.map((row) => (
                    <Fragment key={row.batch_id}>
                    <tr>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600 }}>{row.batch_ref || "—"}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{row.batch_id}</div>
                      </td>
                      <td style={tableCellStyle}>{row.deposit_date || "—"}</td>
                      <td style={tableCellStyle}>
                        {[row.settlement_start_date, row.settlement_end_date].filter(Boolean).join(" → ") || "—"}
                      </td>
                      <td style={tableCellStyle}>₹{Number(row.net_payout || 0).toFixed(2)}</td>
                      <td style={tableCellStyle}>
                        <span
                          style={{
                            ...badgeStyle,
                            ...(row.posting_state === "posted"
                              ? { background: "#dcfce7", color: "#166534" }
                              : row.posting_state === "missing"
                              ? { background: "#fee2e2", color: "#991b1b" }
                              : { background: "#fef3c7", color: "#92400e" }),
                          }}
                        >
                          {row.posting_state}
                        </span>
                      </td>
                      <td style={tableCellStyle}>
                        {row.journal_id ? (
                          <Link href={`/erp/finance/journals/${row.journal_id}`} style={secondaryButtonStyle}>
                            {row.journal_no || "View journal"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            disabled={loadingPreviewBatchId === row.batch_id}
                            onClick={() => void handleTogglePreview(row.batch_id)}
                          >
                            {loadingPreviewBatchId === row.batch_id ? "Loading…" : expandedBatchId === row.batch_id ? "Close Preview" : "Preview"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedBatchId === row.batch_id ? (
                      <tr key={`${row.batch_id}-preview`}>
                        <td style={{ ...tableCellStyle, background: "#fff" }} colSpan={7}>
                          <InlinePreviewPanel
                            row={row}
                            preview={previewByBatchId[row.batch_id]}
                            loading={loadingPreviewBatchId === row.batch_id}
                            panelError={errorByBatchId[row.batch_id]}
                            canWrite={canWrite}
                            postingBatchId={postingBatchId}
                            onClose={() => setExpandedBatchId(null)}
                            onPost={() => void handlePost(row.batch_id)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
