import { type CSSProperties, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
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

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const currentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: formatDateInput(start), end: formatDateInput(now) };
};

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

type TrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: string;
  debit_total: number;
  credit_total: number;
  net: number;
};

export default function TrialBalancePage() {
  const router = useRouter();
  const { start, end } = useMemo(() => currentMonthRange(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [includeVoid, setIncludeVoid] = useState(false);
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

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

  const loadTrialBalance = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setIsLoadingData(true);
    setError(null);

    const params = new URLSearchParams();
    if (dateStart) params.set("from", dateStart);
    if (dateEnd) params.set("to", dateEnd);
    if (includeVoid) params.set("include_void", "true");

    const response = await fetch(`/api/erp/finance/reports/trial-balance?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to load trial balance.");
      setIsLoadingData(false);
      return;
    }

    setRows((payload?.data || []) as TrialBalanceRow[]);
    setIsLoadingData(false);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadTrialBalance();
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.debit += Number(row.debit_total || 0);
        acc.credit += Number(row.credit_total || 0);
        return acc;
      },
      { debit: 0, credit: 0 }
    );
  }, [rows]);

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Trial Balance"
          description="Summarize debits and credits by account."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />

        {error ? <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div> : null}

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
          <label style={{ ...filterLabelStyle, flexDirection: "row", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeVoid}
              onChange={(event) => setIncludeVoid(event.target.checked)}
              style={{ transform: "scale(1.1)" }}
            />
            Include void journals
          </label>
          <button type="submit" style={{ ...primaryButtonStyle, minWidth: 160 }} disabled={isLoadingData || loading}>
            {isLoadingData ? "Loading…" : "Apply Filters"}
          </button>
        </form>

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Code</th>
                <th style={tableHeaderCellStyle}>Account</th>
                <th style={tableHeaderCellStyle}>Type</th>
                <th style={tableHeaderCellStyle}>Debit</th>
                <th style={tableHeaderCellStyle}>Credit</th>
                <th style={tableHeaderCellStyle}>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={{ ...tableCellStyle, textAlign: "center" }} colSpan={6}>
                    {isLoadingData ? "Loading trial balance…" : "No entries for this period."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.account_id}>
                    <td style={tableCellStyle}>{row.account_code}</td>
                    <td style={tableCellStyle}>{row.account_name}</td>
                    <td style={tableCellStyle}>{row.account_type}</td>
                    <td style={tableCellStyle}>{formatAmount(row.debit_total)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.credit_total)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.net)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr>
                  <td style={tableCellStyle} colSpan={3}>
                    <strong>Totals</strong>
                  </td>
                  <td style={tableCellStyle}>{formatAmount(totals.debit)}</td>
                  <td style={tableCellStyle}>{formatAmount(totals.credit)}</td>
                  <td style={tableCellStyle} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </ErpShell>
  );
}

const filterLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#4b5563",
};
