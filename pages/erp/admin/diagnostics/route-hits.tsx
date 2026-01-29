import { useEffect, useMemo, useState } from "react";
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
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type RouteHitSummaryRow = {
  route: string;
  kind: string;
  hits: number;
  last_hit_at: string | null;
};

type RouteDiagnosticsRow = {
  route: string;
  kind: string;
  hitsLast7Days: number;
  hitsLast30Days: number;
  lastHitAt: string | null;
};

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const dateDaysAgo = (days: number, anchor: Date = new Date()) => {
  const copy = new Date(anchor);
  copy.setDate(copy.getDate() - days);
  return copy;
};

export default function RouteDiagnosticsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });

  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<RouteDiagnosticsRow[]>([]);

  const today = useMemo(() => new Date(), []);
  const defaultTo = useMemo(() => formatDate(today), [today]);
  const defaultFrom = useMemo(() => formatDate(dateDaysAgo(29, today)), [today]);

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: defaultFrom,
    toDate: defaultTo,
    kindFilter: "all",
    query: "",
  });

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess(accessState);
      setCtx(context);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const canView = useMemo(() => isAdmin(ctx?.roleKey), [ctx?.roleKey]);

  useEffect(() => {
    let active = true;
    if (!canView || !access.isAuthenticated) {
      setRows([]);
      setFetching(false);
      return () => {
        active = false;
      };
    }

    const fetchSummary = async () => {
      setFetching(true);
      setError("");

      const anchorDate = appliedFilters.toDate ? new Date(appliedFilters.toDate) : new Date();
      const last7From = formatDate(dateDaysAgo(6, anchorDate));
      const last30From = formatDate(dateDaysAgo(29, anchorDate));
      const kindValue = appliedFilters.kindFilter === "all" ? null : appliedFilters.kindFilter;
      const queryValue = appliedFilters.query.trim() ? appliedFilters.query.trim() : null;

      const [{ data: last7Data, error: last7Error }, { data: last30Data, error: last30Error }] =
        await Promise.all([
          supabase.rpc("erp_ui_route_hits_summary", {
            p_from: last7From,
            p_to: appliedFilters.toDate,
            p_kind: kindValue,
            p_query: queryValue,
          }),
          supabase.rpc("erp_ui_route_hits_summary", {
            p_from: last30From,
            p_to: appliedFilters.toDate,
            p_kind: kindValue,
            p_query: queryValue,
          }),
        ]);

      if (!active) return;

      if (last7Error || last30Error) {
        setError(last7Error?.message || last30Error?.message || "Failed to load route hits.");
        setRows([]);
        setFetching(false);
        return;
      }

      const summaryMap = new Map<string, RouteDiagnosticsRow>();
      const attachRows = (data: RouteHitSummaryRow[], key: "hitsLast7Days" | "hitsLast30Days") => {
        data.forEach((row) => {
          const mapKey = `${row.route}::${row.kind}`;
          const existing = summaryMap.get(mapKey) ?? {
            route: row.route,
            kind: row.kind,
            hitsLast7Days: 0,
            hitsLast30Days: 0,
            lastHitAt: row.last_hit_at,
          };
          existing[key] = row.hits ?? 0;
          if (!existing.lastHitAt || (row.last_hit_at && row.last_hit_at > existing.lastHitAt)) {
            existing.lastHitAt = row.last_hit_at;
          }
          summaryMap.set(mapKey, existing);
        });
      };

      attachRows((last7Data as RouteHitSummaryRow[]) || [], "hitsLast7Days");
      attachRows((last30Data as RouteHitSummaryRow[]) || [], "hitsLast30Days");

      const fromBound = appliedFilters.fromDate ? new Date(appliedFilters.fromDate) : null;
      const toBound = appliedFilters.toDate ? new Date(appliedFilters.toDate) : null;
      if (toBound) {
        toBound.setHours(23, 59, 59, 999);
      }

      const filteredRows = Array.from(summaryMap.values()).filter((row) => {
        if (!row.lastHitAt) return false;
        const lastHitDate = new Date(row.lastHitAt);
        if (fromBound && lastHitDate < fromBound) return false;
        if (toBound && lastHitDate > toBound) return false;
        return true;
      });

      filteredRows.sort((a, b) => {
        const lastA = a.lastHitAt || "";
        const lastB = b.lastHitAt || "";
        if (lastA === lastB) {
          return b.hitsLast30Days - a.hitsLast30Days;
        }
        return lastA > lastB ? -1 : 1;
      });

      setRows(filteredRows);
      setFetching(false);
    };

    void fetchSummary();

    return () => {
      active = false;
    };
  }, [access.isAuthenticated, appliedFilters, canView]);

  const handleApply = () => {
    setAppliedFilters({
      fromDate,
      toDate,
      kindFilter,
      query,
    });
  };

  const handleReset = () => {
    setFromDate(defaultFrom);
    setToDate(defaultTo);
    setKindFilter("all");
    setQuery("");
    setAppliedFilters({
      fromDate: defaultFrom,
      toDate: defaultTo,
      kindFilter: "all",
      query: "",
    });
  };

  if (loading) {
    return (
      <ErpShell activeModule="admin">
        <div style={pageContainerStyle}>Loading diagnostics...</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="admin">
        <div style={pageContainerStyle}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </div>
      </ErpShell>
    );
  }

  if (!canView || !access.isAuthenticated) {
    return (
      <ErpShell activeModule="admin">
        <div style={pageContainerStyle}>You do not have access to view diagnostics.</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="admin">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Admin"
          title="Deprecated Route Diagnostics"
          description="Track deprecated or hidden ERP routes that are still being accessed."
        />

        <section style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>Kind</span>
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                style={inputStyle}
              >
                <option value="all">All</option>
                <option value="deprecated">Deprecated</option>
                <option value="hidden">Hidden</option>
                <option value="direct_access">Direct access</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
              <span>Route contains</span>
              <input
                type="text"
                placeholder="/erp/..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={inputStyle}
              />
            </label>
            <button type="button" onClick={handleApply} style={primaryButtonStyle}>
              Apply
            </button>
            <button type="button" onClick={handleReset} style={secondaryButtonStyle}>
              Reset
            </button>
          </div>
        </section>

        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

        <div style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Route</th>
                <th style={tableHeaderCellStyle}>Kind</th>
                <th style={tableHeaderCellStyle}>Hits (Last 7 Days)</th>
                <th style={tableHeaderCellStyle}>Hits (Last 30 Days)</th>
                <th style={tableHeaderCellStyle}>Last Hit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    {fetching ? "Loading route hits..." : "No deprecated route hits found."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.route}-${row.kind}`}>
                    <td style={tableCellStyle}>{row.route}</td>
                    <td style={tableCellStyle}>{row.kind}</td>
                    <td style={tableCellStyle}>{row.hitsLast7Days}</td>
                    <td style={tableCellStyle}>{row.hitsLast30Days}</td>
                    <td style={tableCellStyle}>
                      {row.lastHitAt ? new Date(row.lastHitAt).toLocaleString() : "—"}
                    </td>
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
