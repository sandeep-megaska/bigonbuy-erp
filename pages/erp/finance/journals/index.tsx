import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
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
import { apiGet } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const currentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: formatDateInput(start), end: formatDateInput(end) };
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

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

type ManualLine = {
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  memo: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type StatusFilter = "all" | "posted" | "void";

const blankLine = (): ManualLine => ({ account_code: "", account_name: "", debit: "", credit: "", memo: "" });

export default function FinanceJournalsListPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => currentMonthRange(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [manualDate, setManualDate] = useState(formatDateInput(new Date()));
  const [manualMemo, setManualMemo] = useState("");
  const [manualLines, setManualLines] = useState<ManualLine[]>([blankLine()]);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidJournalId, setVoidJournalId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidDate, setVoidDate] = useState(formatDateInput(new Date()));
  const [voiding, setVoiding] = useState(false);

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

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadJournals = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);
    const params = new URLSearchParams();
    if (dateStart) params.set("from", dateStart);
    if (dateEnd) params.set("to", dateEnd);
    if (status !== "all") params.set("status", status);
    if (search.trim()) params.set("q", search.trim());

    try {
      const payload = await apiGet<{ journals?: JournalRow[] }>(`/api/finance/journals?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      setJournals((payload?.journals || []) as JournalRow[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load journals.";
      setError(message);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadJournals();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateStart, dateEnd, status]);

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadJournals();
  };

  const manualTotals = useMemo(() => {
    const debit = manualLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = manualLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    return { debit, credit, balanced: debit > 0 && debit === credit };
  }, [manualLines]);

  const updateLine = (index: number, patch: Partial<ManualLine>) => {
    setManualLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const handleCreateManual = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token || savingManual) return;
    const parsed = manualLines.map((line) => ({
      account_code: line.account_code.trim() || null,
      account_name: line.account_name.trim() || null,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      memo: line.memo.trim() || null,
    }));
    const hasInvalid = parsed.some(
      (line) => (!line.account_code && !line.account_name) || line.debit < 0 || line.credit < 0 || (line.debit > 0) === (line.credit > 0)
    );
    if (hasInvalid || !manualTotals.balanced) {
      setError("Manual journal lines are invalid or totals are not balanced.");
      return;
    }

    setSavingManual(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/journals/manual/create", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          companyId: ctx.companyId,
          journalDate: manualDate,
          memo: manualMemo,
          lines: parsed,
          clientKey: `manual-${Date.now()}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error || "Failed to create manual journal.");
        setSavingManual(false);
        return;
      }
      setToast({ type: "success", message: "Manual journal posted." });
      setShowManualModal(false);
      setManualMemo("");
      setManualLines([blankLine()]);
      await loadJournals();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create manual journal.");
    } finally {
      setSavingManual(false);
    }
  };

  const handleVoidManual = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token || !voidJournalId || voiding) return;
    if (!voidReason.trim()) {
      setError("Void reason is required.");
      return;
    }
    setVoiding(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/journals/manual/void", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ companyId: ctx.companyId, journalId: voidJournalId, reason: voidReason.trim(), voidDate }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error || "Failed to void manual journal.");
        setVoiding(false);
        return;
      }
      setToast({ type: "success", message: "Manual journal voided with reversal." });
      setShowVoidModal(false);
      setVoidJournalId(null);
      setVoidReason("");
      await loadJournals();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to void manual journal.");
    } finally {
      setVoiding(false);
    }
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading journals…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Journals"
          description="Review posted journal entries across payroll, settlements, AP, and manual entries."
          rightActions={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={primaryButtonStyle} onClick={() => setShowManualModal(true)}>
                New Manual Journal
              </button>
              <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to Finance
              </Link>
            </div>
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
              gap: 12,
              alignItems: "center",
            }}
          >
            <span>{error}</span>
            <button type="button" style={secondaryButtonStyle} onClick={loadJournals} disabled={isLoadingData}>
              Retry
            </button>
          </div>
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
            <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} style={inputStyle} />
          </label>
          <label style={filterLabelStyle}>
            Date to
            <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} style={inputStyle} />
          </label>
          <label style={filterLabelStyle}>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} style={inputStyle}>
              <option value="all">All</option>
              <option value="posted">Posted</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label style={{ ...filterLabelStyle, minWidth: 220 }}>
            Search
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Doc no or reference"
              style={inputStyle}
            />
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
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {journals.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={8}>
                    {isLoadingData ? "Loading journals…" : "No journals found for this range."}
                  </td>
                </tr>
              ) : (
                journals.map((row) => (
                  <tr key={row.id} onClick={() => router.push(`/erp/finance/journals/${row.id}`)} style={tableRowStyle}>
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
                    <td style={tableCellStyle}>
                      {row.reference_type === "manual_journal" && row.status === "posted" ? (
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={(event) => {
                            event.stopPropagation();
                            setVoidJournalId(row.id);
                            setVoidReason("");
                            setVoidDate(formatDateInput(new Date()));
                            setShowVoidModal(true);
                          }}
                        >
                          Void
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {showManualModal ? (
          <div style={modalBackdropStyle}>
            <div style={{ ...cardStyle, maxWidth: 980, width: "100%" }}>
              <h3 style={{ marginTop: 0 }}>New Manual Journal</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 1fr))", gap: 12 }}>
                <label style={filterLabelStyle}>
                  Date
                  <input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={filterLabelStyle}>
                  Memo
                  <input type="text" value={manualMemo} onChange={(event) => setManualMemo(event.target.value)} style={inputStyle} />
                </label>
              </div>
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Account Code</th>
                      <th style={tableHeaderCellStyle}>Account Name</th>
                      <th style={tableHeaderCellStyle}>Debit</th>
                      <th style={tableHeaderCellStyle}>Credit</th>
                      <th style={tableHeaderCellStyle}>Line Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualLines.map((line, index) => (
                      <tr key={`line-${index}`}>
                        <td style={tableCellStyle}>
                          <input style={inputStyle} value={line.account_code} onChange={(event) => updateLine(index, { account_code: event.target.value })} />
                        </td>
                        <td style={tableCellStyle}>
                          <input style={inputStyle} value={line.account_name} onChange={(event) => updateLine(index, { account_name: event.target.value })} />
                        </td>
                        <td style={tableCellStyle}>
                          <input
                            style={inputStyle}
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.debit}
                            onChange={(event) => updateLine(index, { debit: event.target.value })}
                          />
                        </td>
                        <td style={tableCellStyle}>
                          <input
                            style={inputStyle}
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.credit}
                            onChange={(event) => updateLine(index, { credit: event.target.value })}
                          />
                        </td>
                        <td style={tableCellStyle}>
                          <input style={inputStyle} value={line.memo} onChange={(event) => updateLine(index, { memo: event.target.value })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setManualLines((current) => [...current, blankLine()])}>
                  Add Line
                </button>
                <div style={{ fontSize: 13, color: manualTotals.balanced ? "#166534" : "#b91c1c" }}>
                  Debit {formatAmount(manualTotals.debit)} · Credit {formatAmount(manualTotals.credit)}
                </div>
              </div>
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setShowManualModal(false)}>
                  Cancel
                </button>
                <button type="button" style={primaryButtonStyle} onClick={handleCreateManual} disabled={savingManual || !manualTotals.balanced}>
                  {savingManual ? "Saving…" : "Save Journal"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showVoidModal ? (
          <div style={modalBackdropStyle}>
            <div style={{ ...cardStyle, width: "100%", maxWidth: 480 }}>
              <h3 style={{ marginTop: 0 }}>Void Manual Journal</h3>
              <label style={filterLabelStyle}>
                Void date
                <input type="date" value={voidDate} onChange={(event) => setVoidDate(event.target.value)} style={inputStyle} />
              </label>
              <label style={{ ...filterLabelStyle, marginTop: 8 }}>
                Reason
                <textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} style={textAreaStyle} rows={3} />
              </label>
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setShowVoidModal(false)} disabled={voiding}>
                  Cancel
                </button>
                <button type="button" style={primaryButtonStyle} onClick={handleVoidManual} disabled={voiding || !voidReason.trim()}>
                  {voiding ? "Voiding…" : "Confirm Void"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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
  minWidth: 180,
};

const tableRowStyle = {
  cursor: "pointer",
  backgroundColor: "#fff",
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

const textAreaStyle = {
  width: "100%",
  minHeight: 90,
  resize: "vertical" as const,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  padding: "8px 10px",
  fontSize: 14,
};
