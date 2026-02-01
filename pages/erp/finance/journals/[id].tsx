import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
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
import { apiFetch } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB") : "—";

const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-GB") : "—";

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

type JournalHeader = {
  id: string;
  doc_no: string | null;
  journal_date: string;
  status: "posted" | "void";
  reference_type: string | null;
  reference_id: string | null;
  total_debit: number;
  total_credit: number;
  created_at: string | null;
  created_by: string | null;
};

type JournalLine = {
  id: string;
  line_no: number;
  account_code: string | null;
  account_name: string | null;
  description?: string | null;
  debit: number;
  credit: number;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function FinanceJournalDetailPage() {
  const router = useRouter();
  const journalId = useMemo(() => {
    if (Array.isArray(router.query.id)) return router.query.id[0];
    return router.query.id;
  }, [router.query.id]);

  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [journal, setJournal] = useState<JournalHeader | null>(null);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx?.roleKey]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
      }
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

  const loadJournal = async () => {
    if (!journalId || !ctx?.session?.access_token) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const response = await apiFetch(`/api/finance/journals/${journalId}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to load journal.");
      setIsLoadingData(false);
      return;
    }

    const header = payload?.journal?.header ?? null;
    const lineItems = payload?.journal?.lines ?? [];

    setJournal(header as JournalHeader | null);
    setLines(lineItems as JournalLine[]);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadJournal();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, journalId]);

  const totals = useMemo(() => {
    const debitTotal = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const creditTotal = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    return { debitTotal, creditTotal, balanced: debitTotal === creditTotal };
  }, [lines]);

  const handleVoid = async () => {
    if (!journal || journal.status !== "posted" || isVoiding) return;
    setIsVoiding(true);
    setError(null);
    setToast(null);

    const response = await apiFetch(`/api/finance/journals/${journal.id}/void`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: voidReason.trim() }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to void journal.");
      setIsVoiding(false);
      return;
    }

    setToast({ type: "success", message: "Journal voided" });
    setShowVoidModal(false);
    setVoidReason("");
    await loadJournal();
    setIsVoiding(false);
  };

  const handleOpenPayrollRun = () => {
    if (journal?.reference_type === "payroll_run" && journal.reference_id) {
      router.push(`/erp/hr/payroll/runs/${journal.reference_id}`);
    }
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title={journal?.doc_no ? `Journal ${journal.doc_no}` : "Journal Details"}
          description="Review journal header and lines."
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/erp/finance/journals" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to Journals
              </Link>
              {journal?.reference_type === "payroll_run" && journal.reference_id ? (
                <button type="button" style={secondaryButtonStyle} onClick={handleOpenPayrollRun}>
                  Open Payroll Run
                </button>
              ) : null}
              {journal?.status === "posted" && canWrite ? (
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => {
                    setVoidReason("");
                    setShowVoidModal(true);
                  }}
                  disabled={isVoiding}
                >
                  {isVoiding ? "Voiding…" : "Void Journal"}
                </button>
              ) : null}
            </div>
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

        <section style={cardStyle}>
          <div style={metaGridStyle}>
            <div>
              <p style={metaLabelStyle}>Doc No</p>
              <p style={metaValueStyle}>{journal?.doc_no || "—"}</p>
            </div>
            <div>
              <p style={metaLabelStyle}>Date</p>
              <p style={metaValueStyle}>{formatDate(journal?.journal_date || null)}</p>
            </div>
            <div>
              <p style={metaLabelStyle}>Status</p>
              <p style={metaValueStyle}>
                <span
                  style={{
                    ...badgeStyle,
                    backgroundColor: journal?.status === "void" ? "#fee2e2" : badgeStyle.backgroundColor,
                    color: journal?.status === "void" ? "#b91c1c" : badgeStyle.color,
                  }}
                >
                  {journal?.status || "—"}
                </span>
              </p>
            </div>
            <div>
              <p style={metaLabelStyle}>Reference</p>
              <p style={metaValueStyle}>
                {journal?.reference_type || "—"}
                {journal?.reference_id ? ` · ${journal.reference_id}` : ""}
              </p>
            </div>
            <div>
              <p style={metaLabelStyle}>Created</p>
              <p style={metaValueStyle}>{formatDateTime(journal?.created_at || null)}</p>
            </div>
            <div>
              <p style={metaLabelStyle}>Created By</p>
              <p style={metaValueStyle}>{journal?.created_by || "—"}</p>
            </div>
            <div>
              <p style={metaLabelStyle}>Totals</p>
              <p style={metaValueStyle}>
                Dr {formatAmount(journal?.total_debit ?? null)} · Cr {formatAmount(journal?.total_credit ?? null)}
              </p>
              <p style={{ ...metaSubValueStyle, color: totals.balanced ? "#047857" : "#b91c1c" }}>
                {totals.balanced ? "Balanced" : "Not balanced"}
              </p>
            </div>
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Account Code</th>
                <th style={tableHeaderCellStyle}>Account Name</th>
                <th style={tableHeaderCellStyle}>Description</th>
                <th style={tableHeaderCellStyle}>Debit</th>
                <th style={tableHeaderCellStyle}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    {isLoadingData ? "Loading lines…" : "No lines found for this journal."}
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tableCellStyle}>{line.account_code || "—"}</td>
                    <td style={tableCellStyle}>{line.account_name || "—"}</td>
                    <td style={tableCellStyle}>{line.description || "—"}</td>
                    <td style={tableCellStyle}>{formatAmount(line.debit)}</td>
                    <td style={tableCellStyle}>{formatAmount(line.credit)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tableCellStyle, fontWeight: 600 }} colSpan={3}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatAmount(totals.debitTotal)}</td>
                <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatAmount(totals.creditTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
        {showVoidModal ? (
          <div style={modalBackdropStyle}>
            <div style={modalCardStyle}>
              <h3 style={{ marginTop: 0 }}>Void journal</h3>
              <p style={{ marginTop: 0, color: "#4b5563" }}>
                Provide a reason for voiding this journal. This action cannot be undone.
              </p>
              <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                Reason
                <textarea
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  rows={3}
                  style={{ ...textAreaStyle }}
                />
              </label>
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => {
                    setShowVoidModal(false);
                    setVoidReason("");
                  }}
                  disabled={isVoiding}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handleVoid}
                  disabled={isVoiding || !voidReason.trim()}
                >
                  {isVoiding ? "Voiding…" : "Confirm Void"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ErpShell>
  );
}

const metaGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
};

const metaLabelStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "#6b7280",
};

const metaValueStyle = {
  margin: "6px 0 0",
  fontSize: 15,
  color: "#111827",
  fontWeight: 600,
};

const metaSubValueStyle = {
  margin: "6px 0 0",
  fontSize: 13,
};

const modalBackdropStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};

const modalCardStyle = {
  ...cardStyle,
  maxWidth: 420,
  width: "100%",
};

const textAreaStyle = {
  width: "100%",
  minHeight: 90,
  resize: "vertical" as const,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "8px 10px",
  fontSize: 14,
};
