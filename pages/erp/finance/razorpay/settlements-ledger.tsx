import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
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

type SettlementLedgerRow = {
  settlement_id: string;
  settled_at: string | null;
  amount: number | string | null;
  currency: string | null;
  utr: string | null;
  status: "posted" | "imported" | string;
  journal_id: string | null;
  doc_no: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>;

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const lastThirtyDaysRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  return { start: formatDateInput(start), end: formatDateInput(now) };
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

export default function RazorpaySettlementsLedgerPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => lastThirtyDaysRange(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [searchQuery, setSearchQuery] = useState("");
  const [postedOnly, setPostedOnly] = useState(false);
  const [rows, setRows] = useState<SettlementLedgerRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<unknown | null>(null);
  const [previewSettlementId, setPreviewSettlementId] = useState<string | null>(null);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context as CompanyContext);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadSettlements = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const params = new URLSearchParams();
    if (dateStart) params.set("from", dateStart);
    if (dateEnd) params.set("to", dateEnd);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (postedOnly) params.set("posted_only", "true");

    const response = await apiFetch(`/api/finance/razorpay/settlements/list?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to load settlements.");
      setIsLoadingData(false);
      return;
    }

    setRows((payload?.rows || []) as SettlementLedgerRow[]);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadSettlements();
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.companyId]);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadSettlements();
  };

  const handlePreview = async (settlementId: string) => {
    setPreviewLoading(true);
    setPreviewSettlementId(settlementId);
    setPreviewData(null);
    setToast(null);

    try {
      const response = await apiFetch(`/api/finance/razorpay/settlements/${settlementId}/preview`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();

      if (!response.ok) {
        setToast({
          type: "error",
          message: payload?.error || "Unable to load preview.",
        });
      } else {
        setPreviewData(payload?.data || payload);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load preview.";
      setToast({ type: "error", message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePost = async (settlementId: string) => {
    if (!canWrite) return;
    setToast(null);

    try {
      const response = await apiFetch(`/api/finance/razorpay/settlements/${settlementId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const payload = await response.json();

      if (!response.ok) {
        setToast({ type: "error", message: payload?.error || "Failed to post settlement." });
        return;
      }

      setToast({ type: "success", message: "Settlement posted to finance journal." });
      await loadSettlements();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post settlement.";
      setToast({ type: "error", message });
    }
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Razorpay Settlements Ledger"
          description="Review imported Razorpay settlements and posting status."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div>
        ) : null}
        {toast ? (
          <div
            style={{
              ...cardStyle,
              borderColor: toast.type === "success" ? "#bbf7d0" : "#fecaca",
              color: toast.type === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {toast.message}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          style={{
            ...cardStyle,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <label style={filterLabelStyle}>
            Date from
            <input
              type="date"
              value={dateStart}
              onChange={(event) => setDateStart(event.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={filterLabelStyle}>
            Date to
            <input
              type="date"
              value={dateEnd}
              onChange={(event) => setDateEnd(event.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ ...filterLabelStyle, minWidth: 220 }}>
            Search
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Settlement ID or UTR"
              style={inputStyle}
            />
          </label>
          <label style={{ ...filterLabelStyle, flexDirection: "row", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={postedOnly}
              onChange={(event) => setPostedOnly(event.target.checked)}
              style={{ transform: "scale(1.1)" }}
            />
            Posted only
          </label>
          <button type="submit" style={primaryButtonStyle}>
            Apply
          </button>
        </form>

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Settlement ID</th>
                <th style={tableHeaderCellStyle}>Settled At</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Currency</th>
                <th style={tableHeaderCellStyle}>UTR/Reference</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Journal</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={8}>
                    {isLoadingData ? "Loading settlements…" : "No settlements found for this range."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.settlement_id}>
                    <td style={tableCellStyle}>{row.settlement_id}</td>
                    <td style={tableCellStyle}>{formatDate(row.settled_at)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.amount)}</td>
                    <td style={tableCellStyle}>{row.currency || "—"}</td>
                    <td style={tableCellStyle}>{row.utr || "—"}</td>
                    <td style={tableCellStyle}>
                      <span
                        style={{
                          ...badgeStyle,
                          backgroundColor: row.status === "posted" ? "#dcfce7" : "#e0f2fe",
                          color: row.status === "posted" ? "#166534" : "#1d4ed8",
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      {row.journal_id ? (
                        <Link href={`/erp/finance/journals/${row.journal_id}`}>
                          {row.doc_no || "View Journal"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handlePreview(row.settlement_id)}
                          style={secondaryButtonStyle}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePost(row.settlement_id)}
                          style={{
                            ...secondaryButtonStyle,
                            backgroundColor: canWrite && row.status !== "posted" ? "#111827" : "#9ca3af",
                            color: "#fff",
                            borderColor: "transparent",
                          }}
                          disabled={!canWrite || row.status === "posted"}
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
            <div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                Settlement: {previewSettlementId}
              </div>
              <pre
                style={{
                  background: "#f9fafb",
                  borderRadius: 8,
                  padding: 16,
                  maxHeight: 360,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(previewData, null, 2)}
              </pre>
            </div>
          ) : (
            <p style={{ color: "#6b7280" }}>Select a settlement to preview posting details.</p>
          )}
        </div>
      </div>
    </>
  );
}

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
  minWidth: 160,
};
