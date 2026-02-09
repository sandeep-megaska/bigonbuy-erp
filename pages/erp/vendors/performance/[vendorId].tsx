import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import { requireAuthRedirectHome } from "../../../../lib/erpContext";

type DetailPayload = {
  metrics?: Record<string, any>;
  overdue_lines?: Array<Record<string, any>>;
  stale_lines?: Array<Record<string, any>>;
};

export default function VendorPerformanceDetailPage() {
  const router = useRouter();
  const vendorId = typeof router.query.vendorId === "string" ? router.query.vendorId : "";
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vendorId) return;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;

      const res = await fetch(`/api/mfg-admin/perf/vendors/${encodeURIComponent(vendorId)}?days=90`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) return setError(json?.error || "Failed to load vendor detail");
      setData(json.data || {});
    })();
  }, [router, vendorId]);

  return (
    <ErpShell>
      <main style={{ padding: 24 }}>
        <h1>Vendor Performance Detail</h1>
        <div style={{ color: "#64748b", marginBottom: 10 }}>{vendorId}</div>
        {error ? <div style={{ color: "#991b1b" }}>{error}</div> : null}

        {data?.metrics ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {Object.entries(data.metrics).map(([key, value]) => (
              <div key={key} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{key}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{String(value ?? "—")}</div>
              </div>
            ))}
          </div>
        ) : null}

        <ListCard title="Overdue Open Lines" rows={data?.overdue_lines || []} />
        <ListCard title="Stale Lines (7d+)" rows={data?.stale_lines || []} />
      </main>
    </ErpShell>
  );
}

function ListCard({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
  return (
    <section style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>SKU</th>
            <th style={thStyle}>Due Date</th>
            <th style={thStyle}>Remaining</th>
            <th style={thStyle}>Last Update</th>
            <th style={thStyle}>Days Since Update</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={String(row.po_line_id || idx)}>
              <td style={tdStyle}>{row.sku || "—"}</td>
              <td style={tdStyle}>{row.due_date || "—"}</td>
              <td style={tdStyle}>{row.remaining_qty ?? "—"}</td>
              <td style={tdStyle}>{row.last_stage_update_ts || "—"}</td>
              <td style={tdStyle}>{row.days_since_last_update ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td style={tdStyle} colSpan={5}>No rows.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

const thStyle: CSSProperties = { textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" };
const tdStyle: CSSProperties = { borderBottom: "1px solid #f1f5f9", padding: "8px 6px" };
