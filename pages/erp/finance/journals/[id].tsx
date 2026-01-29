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
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

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
  const [accessChecked, setAccessChecked] = useState(false);

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

  useEffect(() => {
    let active = true;

    (async () => {
      if (!ctx?.companyId) return;

      const { error: accessError } = await supabase.rpc("erp_require_finance_reader");
      if (!active) return;

      if (accessError) {
        setError(accessError.message || "You do not have finance access.");
        setAccessChecked(true);
        return;
      }

      setAccessChecked(true);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const loadJournal = async () => {
    if (!journalId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const [headerResponse, linesResponse] = await Promise.all([
      supabase
        .from("erp_fin_journals")
        .select(
          "id, doc_no, journal_date, status, reference_type, reference_id, total_debit, total_credit, created_at, created_by"
        )
        .eq("id", journalId)
        .single(),
      supabase
        .from("erp_fin_journal_lines")
        .select("id, line_no, account_code, account_name, debit, credit")
        .eq("journal_id", journalId)
        .order("line_no", { ascending: true }),
    ]);

    if (headerResponse.error) {
      setError(headerResponse.error.message || "Failed to load journal header.");
      setIsLoadingData(false);
      return;
    }

    if (linesResponse.error) {
      setError(linesResponse.error.message || "Failed to load journal lines.");
      setIsLoadingData(false);
      return;
    }

    setJournal((headerResponse.data || null) as JournalHeader | null);
    setLines((linesResponse.data || []) as JournalLine[]);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId || !accessChecked) return;
      await loadJournal();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, journalId, accessChecked]);

  const totals = useMemo(() => {
    const debitTotal = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const creditTotal = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    return { debitTotal, creditTotal, balanced: debitTotal === creditTotal };
  }, [lines]);

  const handleVoid = async () => {
    if (!journal || journal.status !== "posted" || isVoiding) return;

    const reason = window.prompt("Please enter a reason for voiding this journal.");
    if (!reason || !reason.trim()) {
      setError("Void reason is required.");
      return;
    }

    setIsVoiding(true);
    setError(null);
    setToast(null);

    const { error: accessError } = await supabase.rpc("erp_require_finance_writer");
    if (accessError) {
      setError(accessError.message || "You do not have finance write access.");
      setIsVoiding(false);
      return;
    }

    const { error: voidError } = await supabase.rpc("erp_fin_journal_void", {
      p_journal_id: journal.id,
      p_reason: reason.trim(),
    });

    if (voidError) {
      setError(voidError.message || "Failed to void journal.");
      setIsVoiding(false);
      return;
    }

    setToast({ type: "success", message: "Journal voided." });
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
                <button type="button" style={primaryButtonStyle} onClick={handleVoid} disabled={isVoiding}>
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
                <th style={tableHeaderCellStyle}>Debit</th>
                <th style={tableHeaderCellStyle}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={4}>
                    {isLoadingData ? "Loading lines…" : "No lines found for this journal."}
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tableCellStyle}>{line.account_code || "—"}</td>
                    <td style={tableCellStyle}>{line.account_name || "—"}</td>
                    <td style={tableCellStyle}>{formatAmount(line.debit)}</td>
                    <td style={tableCellStyle}>{formatAmount(line.credit)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tableCellStyle, fontWeight: 600 }} colSpan={2}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatAmount(totals.debitTotal)}</td>
                <td style={{ ...tableCellStyle, fontWeight: 600 }}>{formatAmount(totals.creditTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
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
