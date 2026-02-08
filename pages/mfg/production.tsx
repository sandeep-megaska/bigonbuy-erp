import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/router";

type PoLine = {
  po_id: string;
  po_line_id: string;
  po_number: string;
  po_date: string;
  due_date: string | null;
  po_status: string;
  sku: string;
  qty_ordered: number;
};

type Checkpoint = {
  id: string;
  name: string;
  sort_order: number;
  is_consumption_point: boolean;
};

export default function VendorProductionPage() {
  const router = useRouter();
  const [vendorCode, setVendorCode] = useState("");
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [progressData, setProgressData] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const meRes = await fetch("/api/mfg/auth/me");
      if (!meRes.ok) return router.replace("/mfg/login");
      const me = await meRes.json();
      if (!active) return;
      if (!me?.ok) return router.replace("/mfg/login");
      if (me?.must_reset_password) return router.replace("/mfg/reset-password");
      setVendorCode(String(me.vendor_code || ""));

      await fetch("/api/mfg/production/checkpoints/seed-defaults", { method: "POST" });

      const [cpRes, poRes] = await Promise.all([
        fetch("/api/mfg/production/checkpoints/list"),
        fetch("/api/mfg/production/po-lines/list"),
      ]);
      const cpJson = await cpRes.json();
      const poJson = await poRes.json();
      if (!active) return;
      if (!cpRes.ok || !cpJson?.ok) throw new Error(cpJson?.error || "Failed to load checkpoints");
      if (!poRes.ok || !poJson?.ok) throw new Error(poJson?.error || "Failed to load PO lines");
      const rows = Array.isArray(poJson?.data?.items) ? poJson.data.items : [];
      setCheckpoints(Array.isArray(cpJson?.data?.items) ? cpJson.data.items : []);
      setPoLines(rows);
      if (rows[0]?.po_id) {
        setSelectedPoId(rows[0].po_id);
        await loadProgress(rows[0].po_id, active);
      }
      setLoading(false);
    })().catch((e) => {
      if (!active) return;
      setError(e instanceof Error ? e.message : "Failed to load production data");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function loadProgress(poId: string, active = true) {
    const res = await fetch(`/api/mfg/production/progress/get?po_id=${encodeURIComponent(poId)}`);
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load progress");
    if (!active) return;
    setProgressData(json.data);
  }

  async function save(lineId: string, checkpointId: string) {
    setError("");
    setMessage("");
    const key = `${lineId}:${checkpointId}`;
    const qty = Number(draft[key] ?? 0);
    const res = await fetch("/api/mfg/production/progress/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        po_id: selectedPoId,
        po_line_id: lineId,
        checkpoint_id: checkpointId,
        qty_done: qty,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      setError(json?.error || "Failed to save progress");
      return;
    }
    setMessage("Progress updated");
    await loadProgress(selectedPoId);
  }

  const poOptions = Array.from(new Map(poLines.map((line) => [line.po_id, line])).values());

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>Manufacturer Portal</div>
            <h1 style={{ margin: "4px 0" }}>Production Tracking</h1>
            <div style={{ color: "#6b7280" }}>{vendorCode ? `Vendor ${vendorCode}` : ""}</div>
          </div>
          <button onClick={() => router.push(vendorCode ? `/mfg/v/${vendorCode}` : "/mfg/login")}>Back to Dashboard</button>
        </header>

        {error ? <div style={{ marginTop: 12, color: "#991b1b" }}>{error}</div> : null}
        {message ? <div style={{ marginTop: 12, color: "#0f766e" }}>{message}</div> : null}

        {loading ? <div style={{ marginTop: 20 }}>Loading…</div> : null}

        {!loading ? (
          <>
            <div style={{ marginTop: 14 }}>
              <label>Purchase Order</label>
              <select
                value={selectedPoId}
                onChange={async (e) => {
                  const poId = e.target.value;
                  setSelectedPoId(poId);
                  if (poId) await loadProgress(poId);
                }}
                style={{ marginLeft: 8 }}
              >
                {poOptions.map((po) => (
                  <option key={po.po_id} value={po.po_id}>{`${po.po_number} (${po.po_status})`}</option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Qty Ordered</th>
                    {checkpoints.map((cp) => (
                      <th key={cp.id} style={thStyle}>{cp.name}{cp.is_consumption_point ? " *" : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(progressData?.lines ?? []).map((line: any) => (
                    <tr key={line.po_line_id}>
                      <td style={tdStyle}>{line.sku}</td>
                      <td style={tdStyle}>{line.qty_ordered}</td>
                      {checkpoints.map((cp) => {
                        const key = `${line.po_line_id}:${cp.id}`;
                        const currentValue = line?.progress?.[cp.id] ?? 0;
                        return (
                          <td key={cp.id} style={tdStyle}>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={draft[key] ?? currentValue}
                              onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                              style={{ width: 90 }}
                            />
                            <button onClick={() => save(line.po_line_id, cp.id)} style={{ marginLeft: 6 }}>Save</button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  padding: "8px 6px",
  color: "#475569",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "10px 6px",
  borderBottom: "1px solid #f1f5f9",
};
