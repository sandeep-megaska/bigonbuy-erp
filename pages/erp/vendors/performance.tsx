import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { requireAuthRedirectHome } from "../../../lib/erpContext";

type Row = {
  vendor_id: string;
  vendor_name: string;
  on_time_pct: number;
  avg_lead_time_days: number;
  overdue_lines_count: number;
  stale_lines_count: number;
  last_dispatch_date: string | null;
};

export default function ErpVendorPerformancePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<keyof Row>("on_time_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;
      setToken(session.access_token);

      const res = await fetch("/api/mfg-admin/perf/vendors?days=30", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) return setError(json?.error || "Failed to load vendor scorecard");
      setRows(json.data?.rows || []);
    })();
  }, [router]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av || "").localeCompare(String(bv || ""))
        : String(bv || "").localeCompare(String(av || ""));
    });
  }, [rows, sortKey, sortDir]);

  const setSort = (key: keyof Row) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <>
      <main style={{ padding: 24 }}>
        <h1>Vendor Performance Scorecard</h1>
        {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
          <thead>
            <tr>
              <Th onClick={() => setSort("vendor_name")}>Vendor</Th>
              <Th onClick={() => setSort("on_time_pct")}>On-time %</Th>
              <Th onClick={() => setSort("avg_lead_time_days")}>Avg Lead Time</Th>
              <Th onClick={() => setSort("overdue_lines_count")}>Overdue</Th>
              <Th onClick={() => setSort("stale_lines_count")}>Stale</Th>
              <Th onClick={() => setSort("last_dispatch_date")}>Last Dispatch</Th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.vendor_id}>
                <td style={tdStyle}>
                  <Link href={`/erp/vendors/performance/${row.vendor_id}`}>{row.vendor_name}</Link>
                </td>
                <td style={tdStyle}>{row.on_time_pct}</td>
                <td style={tdStyle}>{row.avg_lead_time_days}</td>
                <td style={tdStyle}>{row.overdue_lines_count}</td>
                <td style={tdStyle}>{row.stale_lines_count}</td>
                <td style={tdStyle}>{row.last_dispatch_date || "—"}</td>
              </tr>
            ))}
            {sortedRows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>No vendors found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div style={{ marginTop: 10, color: "#64748b", fontSize: 12 }}>
          Auth mode: Bearer token via ERP manager session {token ? "(active)" : ""}
        </div>
      </main>
    </>
  );
}

function Th({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <th onClick={onClick} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", cursor: "pointer" }}>{children}</th>;
}
const tdStyle: CSSProperties = { borderBottom: "1px solid #f1f5f9", padding: "8px 6px" };
