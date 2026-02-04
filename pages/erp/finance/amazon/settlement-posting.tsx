import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
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
  session?: { access_token?: string | null } | null;
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

export default function AmazonSettlementPostingPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(startOfPreviousMonth());
  const [toDate, setToDate] = useState(today());
  const [postingFilter, setPostingFilter] = useState<"all" | "posted" | "missing" | "excluded">("all");

  const [batches, setBatches] = useState<AmazonSettlementPostingRow[]>([]);
  const [postingSummary, setPostingSummary] = useState<AmazonSettlementPostingSummary | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AmazonSettlementPostingPreview | null>(null);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [postingBatchId, setPostingBatchId] = useState<string | null>(null);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  const getAuthHeaders = (tokenOverride?: string | null): HeadersInit => {
    const token = tokenOverride ?? ctx?.session?.access_token;
    return {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    };
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

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
      await loadBatches({ fromDate: initialFrom, toDate: initialTo, token: session.access_token });
      await loadSummary({ fromDate: initialFrom, toDate: initialTo, token: session.access_token });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const loadSummary = async (params: { fromDate: string; toDate: string; token?: string | null }) => {
    setIsLoadingSummary(true);
    setSummaryError(null);

    try {
      const response = await fetch(
        `/api/erp/finance/amazon/settlement-posting/summary?from=${params.fromDate}&to=${params.toDate}`,
        { headers: getAuthHeaders(params.token) }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setSummaryError(payload?.error || "Failed to load posting summary.");
        setPostingSummary(null);
        setIsLoadingSummary(false);
        return;
      }

      const summaryPayload = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      const parsed = amazonSettlementPostingSummarySchema.safeParse(summaryPayload);
      if (!parsed.success) {
        setSummaryError("Failed to parse posting summary.");
        setPostingSummary(null);
        setIsLoadingSummary(false);
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
    token?: string | null;
  }) => {
    setIsLoadingList(true);
    setError(null);

    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectivePostingFilter = overrides?.postingFilter ?? postingFilter;

    try {
      const response = await fetch(
        `/api/erp/finance/amazon/settlement-posting/list?from=${effectiveFrom}&to=${effectiveTo}&status=${effectivePostingFilter}`,
        { headers: getAuthHeaders(overrides?.token) }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to load Amazon settlement batches.");
        setBatches([]);
        setIsLoadingList(false);
        return;
      }

      const parsed = amazonSettlementPostingListSchema.safeParse(payload.data);
      if (!parsed.success) {
        console.error("Failed to parse Amazon settlement posting list.", { payload, error: parsed.error });
        setError("Failed to parse Amazon settlement posting list (see console).");
        setBatches([]);
        setIsLoadingList(false);
        return;
      }

      setBatches(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load Amazon settlement batches.";
      setError(message);
      setBatches([]);
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadPreview = async (batchId: string, tokenOverride?: string | null) => {
    setPreviewError(null);
    setIsPreviewLoading(true);
    setPreviewBatchId(batchId);
    setPreview(null);

    try {
      const response = await fetch(`/api/erp/finance/amazon/settlement-posting/${batchId}/preview`, {
        headers: getAuthHeaders(tokenOverride),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setPreviewError(payload?.error || "Failed to load preview.");
        setPreview(null);
        setPreviewBatchId(null);
        return;
      }

      const parsed = amazonSettlementPostingPreviewSchema.safeParse(payload.data);
      if (!parsed.success) {
        setPreviewError("Failed to parse preview response.");
        setPreview(null);
        setPreviewBatchId(null);
        return;
      }

      setPreview(parsed.data);
      setPreviewBatchId(batchId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load preview.";
      setPreviewError(message);
      setPreview(null);
      setPreviewBatchId(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleApplyFilters = async () => {
    if (ctx?.companyId) {
      persistStoredRange(ctx.companyId, fromDate, toDate);
    }
    await loadBatches();
    await loadSummary({ fromDate, toDate });
  };

  const handlePost = async (batchId: string) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can post Amazon settlements.");
      return;
    }

    if (!preview || previewBatchId !== batchId || preview.can_post === false) {
      setError("Preview the journal and resolve any warnings before posting.");
      return;
    }

    const confirmMessage = "Post this Amazon settlement batch to finance?";
    if (!window.confirm(confirmMessage)) return;

    setPostingBatchId(batchId);
    setError(null);

    try {
      const response = await fetch(`/api/erp/finance/amazon/settlement-posting/${batchId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ batchId }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to post Amazon settlement batch.");
        return;
      }

      await loadBatches();
      await loadSummary({ fromDate, toDate });
      await loadPreview(batchId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post Amazon settlement batch.";
      setError(message);
    } finally {
      setPostingBatchId(null);
    }
  };

  const totalNetPayout = useMemo(
    () => batches.reduce((sum, row) => sum + Number(row.net_payout || 0), 0),
    [batches]
  );

  if (loading) {
    return <div style={pageContainerStyle}>Loading Amazon settlement posting…</div>;
  }

  if (error && batches.length === 0) {
    return <div style={pageContainerStyle}>{error}</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Amazon Settlement Posting"
          description="Monitor Amazon settlement batches and post missing journals."
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>To</label>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
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
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.total_batches}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.total_net_payout.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Posted</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.posted}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Missing</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.missing}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Excluded</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.excluded}</div>
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
                    <tr key={row.batch_id}>
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
                            disabled={isPreviewLoading && previewBatchId === row.batch_id}
                            onClick={() => void loadPreview(row.batch_id)}
                          >
                            {isPreviewLoading && previewBatchId === row.batch_id ? "Loading…" : "Preview"}
                          </button>
                          <button
                            type="button"
                            style={primaryButtonStyle}
                            disabled={
                              !canWrite ||
                              row.posting_state !== "missing" ||
                              postingBatchId === row.batch_id ||
                              previewBatchId !== row.batch_id ||
                              preview?.can_post === false
                            }
                            onClick={() => handlePost(row.batch_id)}
                          >
                            {postingBatchId === row.batch_id ? "Posting…" : "Post to Finance"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {previewBatchId && preview ? (
            <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>Journal preview</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Batch {preview.batch_ref || preview.batch_id}</div>
              </div>
              {previewError ? <div style={{ marginTop: 8, color: "#b91c1c" }}>{previewError}</div> : null}
              {preview.warnings && preview.warnings.length > 0 ? (
                <div style={{ marginTop: 8, color: "#b45309" }}>
                  <div style={{ fontWeight: 600 }}>Warnings</div>
                  <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
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
                      preview.lines.map((line, index) => (
                        <tr key={`${line.role_key}-${index}`}>
                          <td style={tableCellStyle}>{line.role_key}</td>
                          <td style={tableCellStyle}>
                            <div style={{ fontWeight: 600 }}>{line.account_name || "—"}</div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>{line.account_code || ""}</div>
                          </td>
                          <td style={tableCellStyle}>₹{Number(line.dr || 0).toFixed(2)}</td>
                          <td style={tableCellStyle}>₹{Number(line.cr || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={!canWrite || preview.can_post === false || postingBatchId === previewBatchId}
                  onClick={() => handlePost(previewBatchId)}
                >
                  {postingBatchId === previewBatchId ? "Posting…" : "Post to Finance"}
                </button>
                {preview.posted?.journal_id ? (
                  <Link href={`/erp/finance/journals/${preview.posted.journal_id}`} style={secondaryButtonStyle}>
                    {preview.posted.journal_no || "View journal"}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}
