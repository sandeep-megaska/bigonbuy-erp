import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
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
import { supabase } from "../../../../lib/supabaseClient";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const last30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: formatDateInput(start), end: formatDateInput(end) };
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB") : "—";

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

type JournalRow = {
  id: string;
  doc_no: string | null;
  journal_date: string;
  status: "posted" | "void";
  total_debit: number;
  total_credit: number;
  reference_type: string | null;
  reference_id: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type StatusFilter = "all" | "posted" | "void";

export default function FinanceJournalsListPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last30Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

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
        setLoading(false);
        return;
      }

      setLoading(false);
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

  const loadJournals = async () => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    let query = supabase
      .from("erp_fin_journals")
      .select(
        "id, doc_no, journal_date, status, total_debit, total_credit, reference_type, reference_id"
      )
      .order("journal_date", { ascending: false })
      .order("doc_no", { ascending: false });

    if (dateStart) query = query.gte("journal_date", dateStart);
    if (dateEnd) query = query.lte("journal_date", dateEnd);
    if (status !== "all") query = query.eq("status", status);

    const { data, error: loadError } = await query;

    if (loadError) {
      setError(loadError.message || "Failed to load journals.");
      setIsLoadingData(false);
      return;
    }

    setJournals((data || []) as JournalRow[]);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId || !accessChecked) return;
      await loadJournals();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateStart, dateEnd, status, accessChecked]);

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadJournals();
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Journals"
          description="Review journal entries posted by payroll."
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
          onSubmit={handleSearch}
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
          <label style={filterLabelStyle}>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} style={inputStyle}>
              <option value="all">All</option>
              <option value="posted">Posted</option>
              <option value="void">Void</option>
            </select>
          </label>
          <button type="submit" style={{ ...primaryButtonStyle, minWidth: 140 }} disabled={isLoadingData || loading}>
            {isLoadingData ? "Loading…" : "Apply Filters"}
          </button>
        </form>

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Doc No</th>
                <th style={tableHeaderCellStyle}>Journal Date</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Total Debit</th>
                <th style={tableHeaderCellStyle}>Total Credit</th>
                <th style={tableHeaderCellStyle}>Reference Type</th>
                <th style={tableHeaderCellStyle}>Reference ID</th>
              </tr>
            </thead>
            <tbody>
              {journals.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
                    {isLoadingData ? "Loading journals…" : "No journals found for this range."}
                  </td>
                </tr>
              ) : (
                journals.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/erp/finance/journals/${row.id}`)}
                    style={tableRowStyle}
                  >
                    <td style={tableCellStyle}>{row.doc_no || "—"}</td>
                    <td style={tableCellStyle}>{formatDate(row.journal_date)}</td>
                    <td style={tableCellStyle}>
                      <span
                        style={{
                          ...badgeStyle,
                          backgroundColor: row.status === "void" ? "#fee2e2" : badgeStyle.backgroundColor,
                          color: row.status === "void" ? "#b91c1c" : badgeStyle.color,
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={tableCellStyle}>{formatAmount(row.total_debit)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.total_credit)}</td>
                    <td style={tableCellStyle}>{row.reference_type || "—"}</td>
                    <td style={tableCellStyle}>{row.reference_id || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ErpShell>
  );
}

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#374151",
  minWidth: 180,
};

const tableRowStyle = {
  cursor: "pointer",
  backgroundColor: "#fff",
};
