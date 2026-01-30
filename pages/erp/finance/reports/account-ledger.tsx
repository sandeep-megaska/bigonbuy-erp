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

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const shortenId = (value: string | null) => {
  if (!value) return "";
  return value.slice(0, 8);
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
};

type LedgerRow = {
  journal_id: string;
  doc_no: string | null;
  journal_date: string;
  status: string;
  reference_type: string | null;
  reference_id: string | null;
  line_id: string;
  memo: string | null;
  debit: number;
  credit: number;
  net: number;
  created_at: string;
};

export default function AccountLedgerPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => currentMonthRange(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<AccountOption | null>(null);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [includeVoid, setIncludeVoid] = useState(false);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
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

  useEffect(() => {
    let active = true;
    if (!ctx?.session?.access_token) return;

    const timer = setTimeout(async () => {
      if (!active) return;
      const params = new URLSearchParams();
      if (accountQuery.trim()) params.set("q", accountQuery.trim());

      const response = await fetch(`/api/erp/finance/gl-accounts/picklist?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const payload = await response.json();

      if (!active) return;
      if (!response.ok) {
        setError(payload?.error || "Failed to load accounts.");
        return;
      }

      setAccountOptions((payload?.data || []) as AccountOption[]);
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accountQuery, ctx?.session?.access_token]);

  const loadLedger = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    if (!selectedAccountId) {
      setError("Select an account to view the ledger.");
      return;
    }

    setIsLoadingData(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("account_id", selectedAccountId);
    if (dateStart) params.set("from", dateStart);
    if (dateEnd) params.set("to", dateEnd);
    if (includeVoid) params.set("include_void", "true");

    const response = await fetch(`/api/erp/finance/reports/account-ledger?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to load account ledger.");
      setIsLoadingData(false);
      return;
    }

    setLedgerRows((payload?.data || []) as LedgerRow[]);
    setIsLoadingData(false);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadLedger();
  };

  const totals = useMemo(() => {
    return ledgerRows.reduce(
      (acc, row) => {
        acc.debit += Number(row.debit || 0);
        acc.credit += Number(row.credit || 0);
        acc.net += Number(row.net || 0);
        return acc;
      },
      { debit: 0, credit: 0, net: 0 }
    );
  }, [ledgerRows]);

  const handleAccountSelect = (value: string) => {
    setSelectedAccountId(value);
    const match = accountOptions.find((option) => option.id === value) || null;
    setSelectedAccount(match);
  };

  const referenceLabel = (row: LedgerRow) => {
    if (row.reference_type === "payroll_run" && row.reference_id) {
      return (
        <Link href={`/erp/hr/payroll/runs/${row.reference_id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          Payroll run · {shortenId(row.reference_id)}
        </Link>
      );
    }

    if (!row.reference_type) return "—";
    const shortId = row.reference_id ? ` · ${shortenId(row.reference_id)}` : "";
    return `${row.reference_type}${shortId}`;
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Account Ledger"
          description="Review ledger movements for a single account."
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
            Account search
            <input
              type="text"
              value={accountQuery}
              onChange={(event) => setAccountQuery(event.target.value)}
              placeholder="Search by code or name"
              style={inputStyle}
            />
          </label>
          <label style={{ ...filterLabelStyle, minWidth: 260 }}>
            Account
            <select
              value={selectedAccountId}
              onChange={(event) => handleAccountSelect(event.target.value)}
              style={inputStyle}
            >
              <option value="">Select account</option>
              {accountOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </label>
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

        {selectedAccount ? (
          <div style={{ ...cardStyle, padding: 16 }}>
            <strong>{selectedAccount.code}</strong> · {selectedAccount.name}
          </div>
        ) : null}

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Doc No</th>
                <th style={tableHeaderCellStyle}>Memo</th>
                <th style={tableHeaderCellStyle}>Debit</th>
                <th style={tableHeaderCellStyle}>Credit</th>
                <th style={tableHeaderCellStyle}>Net</th>
                <th style={tableHeaderCellStyle}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.length === 0 ? (
                <tr>
                  <td style={{ ...tableCellStyle, textAlign: "center" }} colSpan={7}>
                    {isLoadingData ? "Loading ledger…" : "No entries for this period."}
                  </td>
                </tr>
              ) : (
                ledgerRows.map((row) => (
                  <tr key={row.line_id}>
                    <td style={tableCellStyle}>{formatDate(row.journal_date)}</td>
                    <td style={tableCellStyle}>
                      {row.journal_id ? (
                        <Link
                          href={`/erp/finance/journals/${row.journal_id}`}
                          style={{ color: "#2563eb", textDecoration: "none" }}
                        >
                          {row.doc_no || "Journal"}
                        </Link>
                      ) : (
                        row.doc_no || "—"
                      )}
                    </td>
                    <td style={tableCellStyle}>{row.memo || "—"}</td>
                    <td style={tableCellStyle}>{formatAmount(row.debit)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.credit)}</td>
                    <td style={tableCellStyle}>{formatAmount(row.net)}</td>
                    <td style={tableCellStyle}>{referenceLabel(row)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {ledgerRows.length > 0 ? (
              <tfoot>
                <tr>
                  <td style={tableCellStyle} colSpan={3}>
                    <strong>Totals</strong>
                  </td>
                  <td style={tableCellStyle}>{formatAmount(totals.debit)}</td>
                  <td style={tableCellStyle}>{formatAmount(totals.credit)}</td>
                  <td style={tableCellStyle}>{formatAmount(totals.net)}</td>
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
