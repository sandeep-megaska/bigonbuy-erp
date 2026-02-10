import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../ErpShell";
import ErpPageHeader from "../ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  session?: { access_token?: string | null } | null;
};

type Column = {
  key: string;
  label: string;
  format?: (value: unknown, row: Record<string, unknown>) => string;
};

type Props = {
  title: string;
  description: string;
  endpoint: string;
  defaultSort: string;
  columns: Column[];
};

const toDateString = (date: Date) => date.toLocaleDateString("en-CA");
const today = () => toDateString(new Date());
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateString(date);
};

const asNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export default function IntelligenceTablePage({ title, description, endpoint, defaultSort, columns }: Props) {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [fromDate, setFromDate] = useState(daysAgo(180));
  const [toDate, setToDate] = useState(today());

  const canRefresh = useMemo(() => Boolean(ctx?.roleKey && ["owner", "admin"].includes(ctx.roleKey)), [ctx?.roleKey]);

  const headers = useMemo<HeadersInit>(() => {
    const token = ctx?.session?.access_token;
    return {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    };
  }, [ctx?.session?.access_token]);

  const loadRows = async (tokenOverride?: string | null) => {
    setError(null);
    const query = new URLSearchParams({ from: fromDate, to: toDate, sort: defaultSort, limit: "100" });
    const response = await fetch(`${endpoint}?${query.toString()}`, {
      headers: {
        Authorization: tokenOverride ? `Bearer ${tokenOverride}` : (headers as Record<string, string>).Authorization || "",
        "Content-Type": "application/json",
      },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      setRows([]);
      setError(payload?.error || `Failed to load ${title.toLowerCase()}.`);
      return;
    }
    setRows(Array.isArray(payload.data) ? payload.data : []);
  };

  const refreshScores = async () => {
    if (!canRefresh) return;
    setIsRefreshing(true);
    setRefreshResult(null);
    setError(null);
    try {
      const response = await fetch("/api/marketing/intelligence/refresh", {
        method: "POST",
        headers,
        body: JSON.stringify({ from: fromDate, to: toDate }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to refresh intelligence scores.");
        return;
      }
      const summary = payload.data || {};
      setRefreshResult(
        `Refreshed: customers ${asNumber(summary.customers_upserted)}, skus ${asNumber(
          summary.skus_upserted
        )}, cities ${asNumber(summary.cities_upserted)}`
      );
      await loadRows(ctx?.session?.access_token ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh intelligence scores.");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const companyContext = await getCompanyContext(session);
      if (!active) return;

      setCtx(companyContext as CompanyContext);
      if (!companyContext.companyId) {
        setError(companyContext.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      await loadRows(session.access_token);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const renderCell = (column: Column, row: Record<string, unknown>) => {
    const value = row[column.key];
    if (column.format) return column.format(value, row);
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
  };

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader title={title} description={description} />
        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>From</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>To</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
            </label>
            <button type="button" style={secondaryButtonStyle} onClick={() => void loadRows()} disabled={loading}>
              Apply
            </button>
            {canRefresh && (
              <button type="button" style={primaryButtonStyle} onClick={refreshScores} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh Scores"}
              </button>
            )}
          </div>
          {refreshResult ? <p style={{ margin: 0, color: "#065f46" }}>{refreshResult}</p> : null}
          {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}
        </section>

        <section style={{ ...cardStyle, marginTop: 16 }}>
          {loading ? (
            <p style={{ margin: 0 }}>Loading…</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column.key} style={tableHeaderCellStyle}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(row.id ?? `${index}`)}>
                      {columns.map((column) => (
                        <td key={`${column.key}-${index}`} style={tableCellStyle}>
                          {renderCell(column, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={columns.length}>
                        No rows found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
