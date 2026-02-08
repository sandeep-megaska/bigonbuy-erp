import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import MfgLayout, { useMfgContext } from "../../components/mfg/MfgLayout";

type MaterialRow = {
  material_id: string;
  name: string;
  category: string | null;
  default_uom: string;
  reorder_point: number;
  lead_time_days: number;
  on_hand_qty: number;
  status: "OK" | "LOW" | "OUT" | "NEGATIVE";
};

type AlertRow = {
  material_id: string;
  name: string;
  on_hand_qty: number;
  default_uom: string;
  status: "LOW" | "OUT" | "NEGATIVE";
};

type CoverageRow = {
  material_id: string;
  material_name: string;
  uom: string;
  on_hand_qty: number;
  demand_qty_next: number;
  projected_balance: number;
  shortage_flag: boolean;
};

const baseInputStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: 10,
  marginTop: 6,
  border: "1px solid #d1d5db",
  borderRadius: 8,
};

export default function VendorMaterialsPage() {
  return (
    <MfgLayout title="Raw Materials">
      <MaterialsContent />
    </MfgLayout>
  );
}

function MaterialsContent() {
  const { vendorCode } = useMfgContext();
  const [items, setItems] = useState<MaterialRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [coverageRows, setCoverageRows] = useState<CoverageRow[]>([]);
  const [coverageSummary, setCoverageSummary] = useState({ total_materials: 0, shortage_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  const [newMaterial, setNewMaterial] = useState({
    name: "",
    category: "",
    default_uom: "",
    reorder_point: "0",
    lead_time_days: "0",
  });

  const [ledgerForm, setLedgerForm] = useState({
    material_id: "",
    entry_type: "PURCHASE_IN",
    qty: "",
    entry_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  useEffect(() => {
    let active = true;
    (async () => {
      await loadData(active);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function loadData(active = true) {
    setLoading(true);
    setError("");
    try {
      const [listRes, alertsRes, coverageRes] = await Promise.all([
        fetch("/api/mfg/materials/list"),
        fetch("/api/mfg/materials/alerts"),
        fetch("/api/mfg/vendor/material-coverage"),
      ]);
      const listJson = await listRes.json();
      const alertsJson = await alertsRes.json();
      const coverageJson = await coverageRes.json();

      if (!listRes.ok || !listJson?.ok) throw new Error(listJson?.error || "Failed to load materials");
      if (!alertsRes.ok || !alertsJson?.ok) throw new Error(alertsJson?.error || "Failed to load alerts");
      if (!coverageRes.ok || !coverageJson?.ok) throw new Error(coverageJson?.error || "Failed to load projected coverage");
      if (!active) return;

      const rows = Array.isArray(listJson?.data?.items) ? listJson.data.items : [];
      const alertRows = Array.isArray(alertsJson?.data?.items) ? alertsJson.data.items : [];
      const projectedRows = Array.isArray(coverageJson?.data?.items) ? coverageJson.data.items : [];
      setItems(rows);
      setAlerts(alertRows);
      setCoverageRows(projectedRows);
      setCoverageSummary({
        total_materials: Number(coverageJson?.data?.summary?.total_materials || 0),
        shortage_count: Number(coverageJson?.data?.summary?.shortage_count || 0),
      });
      if (!ledgerForm.material_id && rows.length > 0) {
        setLedgerForm((prev) => ({ ...prev, material_id: rows[0].material_id }));
      }
    } catch (e) {
      if (!active) return;
      setError(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      if (active) setLoading(false);
    }
  }

  const selectedMaterial = useMemo(
    () => items.find((m) => m.material_id === ledgerForm.material_id) || null,
    [items, ledgerForm.material_id]
  );

  async function submitNewMaterial() {
    setError("");
    setMessage("");
    const res = await fetch("/api/mfg/materials/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newMaterial.name,
        category: newMaterial.category,
        default_uom: newMaterial.default_uom,
        reorder_point: Number(newMaterial.reorder_point || 0),
        lead_time_days: Number(newMaterial.lead_time_days || 0),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      setError(json?.error || "Failed to add material");
      return;
    }
    setShowAdd(false);
    setNewMaterial({ name: "", category: "", default_uom: "", reorder_point: "0", lead_time_days: "0" });
    setMessage("Material created");
    await loadData();
  }

  async function submitLedgerEntry() {
    setError("");
    setMessage("");
    const qty = Number(ledgerForm.qty || 0);
    if (qty <= 0) {
      setError("Quantity must be greater than zero");
      return;
    }
    if (!selectedMaterial) {
      setError("Select a material");
      return;
    }

    const res = await fetch("/api/mfg/materials/ledger-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        material_id: ledgerForm.material_id,
        entry_type: ledgerForm.entry_type,
        qty,
        uom: selectedMaterial.default_uom,
        entry_date: ledgerForm.entry_date,
        notes: ledgerForm.notes,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      setError(json?.error || "Failed to record stock movement");
      return;
    }

    setShowLedger(false);
    setLedgerForm((prev) => ({ ...prev, qty: "", notes: "" }));
    setMessage("Stock movement recorded");
    await loadData();
  }

  return (
    <>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setShowAdd(true)} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "0 12px", height: 36 }}>Add Material</button>
        <button onClick={() => setShowLedger(true)} style={{ background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "0 12px", height: 36 }}>Stock In / Adjustment</button>
      </div>
      {vendorCode ? <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>Vendor {vendorCode}</div> : null}
      {message ? <div style={{ marginTop: 12, background: "#ecfeff", border: "1px solid #99f6e4", color: "#0f766e", borderRadius: 8, padding: 10 }}>{message}</div> : null}
      {error ? <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: 10 }}>{error}</div> : null}

      <section style={{ marginTop: 18, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Projected Coverage (Open POs)</h3>
        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>
          Materials: {coverageSummary.total_materials} · Shortages: {coverageSummary.shortage_count}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Material", "On hand", "Demand (open POs)", "Projected balance", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", color: "#475569", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverageRows.map((row) => (
                <tr key={row.material_id} style={row.shortage_flag ? { background: "#fef2f2" } : undefined}>
                  <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{row.material_name}</td>
                  <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{row.on_hand_qty} {row.uom}</td>
                  <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{row.demand_qty_next} {row.uom}</td>
                  <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9", fontWeight: row.shortage_flag ? 700 : 500, color: row.shortage_flag ? "#991b1b" : "inherit" }}>{row.projected_balance} {row.uom}</td>
                  <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                    {row.shortage_flag ? <StatusBadge status="SHORTAGE" /> : <StatusBadge status="OK" />}
                  </td>
                </tr>
              ))}
              {coverageRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#6b7280" }}>No projected coverage data available.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 18, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Alerts</h3>
        {alerts.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No low/out alerts.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {alerts.map((alert) => (
              <li key={alert.material_id}>
                <strong>{alert.name}</strong> — {alert.status} ({alert.on_hand_qty} {alert.default_uom})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 18, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Materials</h3>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Material", "Category", "UOM", "On hand", "Reorder point", "Lead time (days)", "Status"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", color: "#475569", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.material_id}>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.name}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.category || "-"}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.default_uom}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.on_hand_qty}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.reorder_point}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>{item.lead_time_days}</td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}><StatusBadge status={item.status} /></td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 10, color: "#6b7280" }}>No materials found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAdd ? (
        <Modal title="Add material" onClose={() => setShowAdd(false)}>
          <label>Name<input style={baseInputStyle} value={newMaterial.name} onChange={(e) => setNewMaterial((prev) => ({ ...prev, name: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Category<input style={baseInputStyle} value={newMaterial.category} onChange={(e) => setNewMaterial((prev) => ({ ...prev, category: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Default UOM<input style={baseInputStyle} value={newMaterial.default_uom} onChange={(e) => setNewMaterial((prev) => ({ ...prev, default_uom: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Reorder point<input type="number" min="0" style={baseInputStyle} value={newMaterial.reorder_point} onChange={(e) => setNewMaterial((prev) => ({ ...prev, reorder_point: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Lead time (days)<input type="number" min="0" style={baseInputStyle} value={newMaterial.lead_time_days} onChange={(e) => setNewMaterial((prev) => ({ ...prev, lead_time_days: e.target.value }))} /></label>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowAdd(false)}>Cancel</button>
            <button onClick={submitNewMaterial} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px" }}>Save</button>
          </div>
        </Modal>
      ) : null}

      {showLedger ? (
        <Modal title="Stock movement" onClose={() => setShowLedger(false)}>
          <label>Material
            <select style={baseInputStyle} value={ledgerForm.material_id} onChange={(e) => setLedgerForm((prev) => ({ ...prev, material_id: e.target.value }))}>
              {items.map((item) => (
                <option key={item.material_id} value={item.material_id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 10 }}>Type
            <select style={baseInputStyle} value={ledgerForm.entry_type} onChange={(e) => setLedgerForm((prev) => ({ ...prev, entry_type: e.target.value }))}>
              <option value="PURCHASE_IN">Purchase In</option>
              <option value="ADJUST_IN">Adjustment In</option>
              <option value="ADJUST_OUT">Adjustment Out</option>
              <option value="OPENING">Opening</option>
            </select>
          </label>
          <label style={{ display: "block", marginTop: 10 }}>Quantity<input type="number" min="0.0001" step="any" style={baseInputStyle} value={ledgerForm.qty} onChange={(e) => setLedgerForm((prev) => ({ ...prev, qty: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Entry date<input type="date" style={baseInputStyle} value={ledgerForm.entry_date} onChange={(e) => setLedgerForm((prev) => ({ ...prev, entry_date: e.target.value }))} /></label>
          <label style={{ display: "block", marginTop: 10 }}>Notes<textarea style={{ ...baseInputStyle, minHeight: 70 }} value={ledgerForm.notes} onChange={(e) => setLedgerForm((prev) => ({ ...prev, notes: e.target.value }))} /></label>
          {selectedMaterial ? <div style={{ marginTop: 8, color: "#475569", fontSize: 12 }}>UOM will be recorded as: {selectedMaterial.default_uom}</div> : null}
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowLedger(false)}>Cancel</button>
            <button onClick={submitLedgerEntry} style={{ background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px" }}>Submit</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    OK: { bg: "#ecfeff", color: "#0e7490" },
    SHORTAGE: { bg: "#fee2e2", color: "#991b1b" },
    LOW: { bg: "#fef3c7", color: "#92400e" },
    OUT: { bg: "#fee2e2", color: "#991b1b" },
    NEGATIVE: { bg: "#fecaca", color: "#7f1d1d" },
  };
  const style = map[status] || map.OK;
  return <span style={{ background: style.bg, color: style.color, borderRadius: 999, padding: "3px 8px", fontSize: 12, fontWeight: 700 }}>{status}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 12 }}>
      <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
