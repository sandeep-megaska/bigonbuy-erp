import { useEffect, useState, type CSSProperties } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";

type Summary = {
  on_time_pct: number;
  avg_lead_time_days: number;
  stale_lines_count: number;
  overdue_lines_count: number;
  asn_dispatch_speed_avg_days: number;
  missing_bom_skus_count: number;
  material_shortage_count: number;
  top_5_due_next: Array<{ po_line_id: string; sku: string; due_date: string | null; remaining_qty: number }>;
};

type Trends = {
  rows: Array<{ bucket_start: string; on_time_pct: number; avg_lead_time_days: number; overdue_lines_count: number }>;
};

export default function MfgPerformancePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<Trends>({ rows: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [summaryRes, trendsRes] = await Promise.all([
          fetch("/api/mfg/perf/summary?days=30"),
          fetch("/api/mfg/perf/trends?days=90&bucket=WEEK"),
        ]);

        const summaryJson = await summaryRes.json();
        const trendsJson = await trendsRes.json();
        if (!active) return;

        if (!summaryRes.ok || !summaryJson?.ok) {
          setError(summaryJson?.error || "Failed to load performance summary");
          setLoading(false);
          return;
        }

        if (!trendsRes.ok || !trendsJson?.ok) {
          setError(trendsJson?.error || "Failed to load performance trends");
          setLoading(false);
          return;
        }

        setSummary(summaryJson.data || null);
        setTrends(trendsJson.data || { rows: [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load performance data");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <MfgLayout title="Performance">
      {loading ? <div>Loading…</div> : null}
      {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}

      {summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Tile title="On-time SLA %" value={`${summary.on_time_pct || 0}%`} />
            <Tile title="Avg Lead Time (days)" value={summary.avg_lead_time_days || 0} />
            <Tile title="Stale Lines (7d)" value={summary.stale_lines_count || 0} />
            <Tile title="Overdue Open Lines" value={summary.overdue_lines_count || 0} />
            <Tile title="Dispatch Speed (days)" value={summary.asn_dispatch_speed_avg_days || 0} />
            <Tile title="Missing BOM / Material Risk" value={`${summary.missing_bom_skus_count || 0} / ${summary.material_shortage_count || 0}`} />
          </div>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Weekly Trend</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Week</th>
                  <th style={thStyle}>On-time %</th>
                  <th style={thStyle}>Avg Lead Time</th>
                  <th style={thStyle}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {trends.rows.map((row) => (
                  <tr key={row.bucket_start}>
                    <td style={tdStyle}>{row.bucket_start}</td>
                    <td style={tdStyle}>{row.on_time_pct}</td>
                    <td style={tdStyle}>{row.avg_lead_time_days}</td>
                    <td style={tdStyle}>{row.overdue_lines_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Top 5 Due Next</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>PO Line</th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Due Date</th>
                  <th style={thStyle}>Remaining Qty</th>
                </tr>
              </thead>
              <tbody>
                {(summary.top_5_due_next || []).map((row) => (
                  <tr key={row.po_line_id}>
                    <td style={tdStyle}>{row.po_line_id}</td>
                    <td style={tdStyle}>{row.sku}</td>
                    <td style={tdStyle}>{row.due_date || "—"}</td>
                    <td style={tdStyle}>{row.remaining_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </MfgLayout>
  );
}

function Tile({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
      <div style={{ color: "#6b7280", fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  marginTop: 16,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
};

const thStyle: CSSProperties = { textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" };
const tdStyle: CSSProperties = { borderBottom: "1px solid #f1f5f9", padding: "8px 6px" };
