import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/router";
import MfgLayout from "../../../../components/mfg/MfgLayout";

type StageCode = "CUTTING" | "STITCHING" | "PRESSING" | "PACKING" | "READY_TO_DISPATCH";

const STAGE_CODES: StageCode[] = ["CUTTING", "STITCHING", "PRESSING", "PACKING", "READY_TO_DISPATCH"];

type PoLineListRow = {
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

type ProgressLine = {
  po_line_id: string;
  sku: string;
  qty_ordered: number;
  has_active_bom: boolean;
  checkpoint_progress: Array<{
    checkpoint_id: string;
    checkpoint_name: string;
    is_consumption_point: boolean;
    qty_done: number;
  }>;
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: 9,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  marginTop: 6,
};

export default function VendorProductionPage() {
  const router = useRouter();
  const vendorCode = typeof router.query.vendor_code === "string" ? router.query.vendor_code.toUpperCase() : "";

  return (
    <MfgLayout title="Production" requestedVendorCode={vendorCode}>
      <ProductionContent />
    </MfgLayout>
  );
}

function ProductionContent() {
  const [poRows, setPoRows] = useState<PoLineListRow[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [lines, setLines] = useState<ProgressLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ po_line_id: "", stage_code: "CUTTING" as StageCode, completed_qty_abs: "", notes: "" });

  const poList = useMemo(() => {
    const map = new Map<string, { po_id: string; po_number: string; po_date: string; due_date: string | null; po_status: string }>();
    for (const row of poRows) {
      if (!map.has(row.po_id)) map.set(row.po_id, { po_id: row.po_id, po_number: row.po_number, po_date: row.po_date, due_date: row.due_date, po_status: row.po_status });
    }
    return Array.from(map.values());
  }, [poRows]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError("");
    try {
      await fetch("/api/mfg/prod/checkpoints/seed-defaults", { method: "POST" });
      const [cpRes, poRes] = await Promise.all([
        fetch("/api/mfg/prod/checkpoints/list"),
        fetch("/api/mfg/prod/po-lines?status=open"),
      ]);
      const cpJson = await cpRes.json();
      const poJson = await poRes.json();
      if (!cpRes.ok || !cpJson?.ok) throw new Error(cpJson?.error || "Failed to load checkpoints");
      if (!poRes.ok || !poJson?.ok) throw new Error(poJson?.error || "Failed to load PO list");

      const cpItems = Array.isArray(cpJson?.data?.items) ? cpJson.data.items : [];
      const poItems = Array.isArray(poJson?.data?.items) ? poJson.data.items : [];
      setCheckpoints(cpItems);
      setPoRows(poItems);

      const nextPoId = selectedPoId || (poItems[0]?.po_id ? String(poItems[0].po_id) : "");
      if (nextPoId) {
        setSelectedPoId(nextPoId);
        await loadPoProgress(nextPoId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load production data");
    } finally {
      setLoading(false);
    }
  }

  async function loadPoProgress(poId: string) {
    const res = await fetch(`/api/mfg/prod/po-progress?po_id=${encodeURIComponent(poId)}`);
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load PO progress");
    setLines(Array.isArray(json?.data?.lines) ? json.data.lines : []);
  }

  async function onSelectPo(poId: string) {
    setSelectedPoId(poId);
    setError("");
    try {
      await loadPoProgress(poId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load PO progress");
    }
  }

  function openUpdate(line: ProgressLine) {
    setForm({ po_line_id: line.po_line_id, stage_code: "CUTTING", completed_qty_abs: "", notes: "" });
    setShowModal(true);
  }

  async function saveProgress() {
    setError("");
    setMessage("");

    const qty = Number(form.completed_qty_abs);
    if (!form.po_line_id || Number.isNaN(qty)) {
      setError("stage_code and completed_qty_abs are required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/mfg/po-lines/${encodeURIComponent(form.po_line_id)}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageCode: form.stage_code,
          completedQtyAbs: qty,
          note: form.notes,
          clientEventId: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to post stage event");

      setMessage("Stage event saved. Consumption pending internal posting.");
      setShowModal(false);
      await loadPoProgress(selectedPoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to post stage event";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {message ? <div style={{ marginTop: 12, background: "#ecfeff", border: "1px solid #99f6e4", color: "#0f766e", borderRadius: 8, padding: 10 }}>{message}</div> : null}
      {error ? <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: 10 }}>{error}</div> : null}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>PO List</h3>
          {loading ? <div>Loading…</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {poList.map((po) => (
                <button key={po.po_id} onClick={() => onSelectPo(po.po_id)} style={{ textAlign: "left", border: selectedPoId === po.po_id ? "1px solid #2563eb" : "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#fff" }}>
                  <div style={{ fontWeight: 700 }}>{po.po_number || "PO"}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{po.po_date}</div>
                </button>
              ))}
              {poList.length === 0 ? <div style={{ color: "#6b7280" }}>No production POs found.</div> : null}
            </div>
          )}
        </section>

        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>PO Line Production Progress</h3>
          {!selectedPoId ? <div style={{ color: "#6b7280" }}>Select a PO from the left.</div> : null}
          {selectedPoId ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Ordered Qty</th>
                    {checkpoints.map((cp) => <th key={cp.id} style={thStyle}>{cp.name}</th>)}
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.po_line_id}>
                      <td style={tdStyle}>
                        {line.sku}
                        {!line.has_active_bom ? <span style={{ marginLeft: 8, fontSize: 11, color: "#b45309", border: "1px solid #fcd34d", borderRadius: 999, padding: "2px 8px", background: "#fffbeb" }}>BOM required</span> : null}
                      </td>
                      <td style={tdStyle}>{line.qty_ordered}</td>
                      {checkpoints.map((cp) => {
                        const found = line.checkpoint_progress.find((x) => x.checkpoint_id === cp.id);
                        return <td key={cp.id} style={tdStyle}>{found?.qty_done ?? 0}</td>;
                      })}
                      <td style={tdStyle}><button onClick={() => openUpdate(line)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", padding: "6px 10px" }}>Post Stage Event</button></td>
                    </tr>
                  ))}
                  {lines.length === 0 ? <tr><td colSpan={3 + checkpoints.length} style={tdStyle}>No PO lines.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {showModal ? (
        <Modal title="Post Stage Completion" onClose={() => setShowModal(false)}>
          <label>Stage
            <select style={inputStyle} value={form.stage_code} onChange={(e) => setForm((prev) => ({ ...prev, stage_code: e.target.value as StageCode }))}>
              {STAGE_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 10 }}>Completed Qty (absolute)
            <input type="number" min="0" style={inputStyle} value={form.completed_qty_abs} onChange={(e) => setForm((prev) => ({ ...prev, completed_qty_abs: e.target.value }))} />
          </label>
          <label style={{ display: "block", marginTop: 10 }}>Notes
            <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </label>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowModal(false)}>Cancel</button>
            <button onClick={saveProgress} disabled={saving} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px" }}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const thStyle: CSSProperties = { textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", color: "#475569", fontWeight: 600, fontSize: 12 };
const tdStyle: CSSProperties = { padding: "10px 6px", borderBottom: "1px solid #f1f5f9", fontSize: 13 };

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center", zIndex: 60 }}>
      <div style={{ width: "min(580px, 92vw)", background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    </div>
  );
}
