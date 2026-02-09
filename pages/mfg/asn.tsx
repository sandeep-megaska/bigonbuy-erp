import { useEffect, useMemo, useState } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";

type VendorAsn = {
  asn_id: string;
  po_id: string;
  po_number: string;
  status: string;
  dispatch_date: string;
  eta_date: string | null;
  total_qty: number;
  cartons_count: number;
  created_at: string;
};

type OpenPoLine = {
  po_id: string;
  po_number: string;
  po_line_id: string;
  sku: string;
  open_qty: number;
};

export default function MfgAsnPage() {
  const [items, setItems] = useState<VendorAsn[]>([]);
  const [poLines, setPoLines] = useState<OpenPoLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({ po_id: "", dispatch_date: "", eta_date: "", asn_id: "", po_line_id: "", qty: "", carton_count: "0" });

  const poOptions = useMemo(() => {
    const map = new Map<string, string>();
    poLines.forEach((line) => map.set(line.po_id, line.po_number || line.po_id));
    return Array.from(map.entries()).map(([id, number]) => ({ id, number }));
  }, [poLines]);

  async function load() {
    setLoading(true);
    setError("");
    const [asnRes, poRes] = await Promise.all([fetch("/api/mfg/asn/list"), fetch("/api/mfg/asn/po-open-lines")]);
    const asnJson = await asnRes.json();
    const poJson = await poRes.json();
    if (!asnRes.ok || !asnJson?.ok) {
      setError(asnJson?.error || "Failed to load ASNs");
      setLoading(false);
      return;
    }
    if (!poRes.ok || !poJson?.ok) {
      setError(poJson?.error || "Failed to load PO lines");
      setLoading(false);
      return;
    }

    setItems(asnJson.data.items || []);
    setPoLines(poJson.data.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const selectedAsn = items.find((item) => item.asn_id === form.asn_id);

  async function createAsn() {
    setError("");
    setMsg("");
    const res = await fetch("/api/mfg/asn/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ po_id: form.po_id, dispatch_date: form.dispatch_date, eta_date: form.eta_date || null }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to create ASN");
    setForm((prev) => ({ ...prev, asn_id: json.data.id }));
    setMsg("ASN draft created.");
    await load();
  }

  async function addLine() {
    const qty = Number(form.qty);
    const res = await fetch("/api/mfg/asn/add-line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asn_id: form.asn_id, po_line_id: form.po_line_id, qty }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to add line");
    setMsg("ASN line saved.");
    await load();
  }

  async function setCartons() {
    const res = await fetch("/api/mfg/asn/set-cartons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asn_id: form.asn_id, carton_count: Number(form.carton_count || 0) }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to set cartons");
    setMsg("Cartons updated.");
    await load();
  }

  async function submitAsn() {
    const res = await fetch("/api/mfg/asn/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asn_id: form.asn_id }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to submit ASN");
    setMsg("ASN submitted.");
    await load();
  }

  const poLineOptions = poLines.filter((line) => !form.po_id || line.po_id === form.po_id);

  return (
    <MfgLayout title="ASN Booking">
      {msg ? <div style={{ marginBottom: 12, color: "#0f766e" }}>{msg}</div> : null}
      {error ? <div style={{ marginBottom: 12, color: "#991b1b" }}>{error}</div> : null}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Create ASN Draft</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 8 }}>
          <select value={form.po_id} onChange={(e) => setForm((prev) => ({ ...prev, po_id: e.target.value }))}>
            <option value="">Select PO</option>
            {poOptions.map((po) => <option key={po.id} value={po.id}>{po.number}</option>)}
          </select>
          <input type="date" value={form.dispatch_date} onChange={(e) => setForm((prev) => ({ ...prev, dispatch_date: e.target.value }))} />
          <input type="date" value={form.eta_date} onChange={(e) => setForm((prev) => ({ ...prev, eta_date: e.target.value }))} />
          <button onClick={createAsn}>Create</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, marginTop: 12 }}>
          <select value={form.asn_id} onChange={(e) => setForm((prev) => ({ ...prev, asn_id: e.target.value }))}>
            <option value="">Select ASN</option>
            {items.filter((item) => item.status === "DRAFT").map((asn) => <option key={asn.asn_id} value={asn.asn_id}>{asn.po_number} • {asn.asn_id.slice(0, 8)}</option>)}
          </select>
          <select value={form.po_line_id} onChange={(e) => setForm((prev) => ({ ...prev, po_line_id: e.target.value }))}>
            <option value="">Select PO line</option>
            {poLineOptions.map((line) => <option key={line.po_line_id} value={line.po_line_id}>{line.sku} (open {line.open_qty})</option>)}
          </select>
          <input type="number" min="0" placeholder="Qty" value={form.qty} onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))} />
          <button onClick={addLine} disabled={!form.asn_id}>Add Line</button>
          <span />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 200px 200px", gap: 8, marginTop: 12 }}>
          <input type="number" min="0" placeholder="Cartons" value={form.carton_count} onChange={(e) => setForm((prev) => ({ ...prev, carton_count: e.target.value }))} />
          <button onClick={setCartons} disabled={!form.asn_id}>Set Cartons</button>
          <button onClick={submitAsn} disabled={!form.asn_id || selectedAsn?.status !== "DRAFT"}>Submit ASN</button>
        </div>
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>My ASNs</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>PO</th><th>Status</th><th>Dispatch</th><th>ETA</th><th>Total Qty</th><th>Cartons</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading...</td></tr> : null}
            {!loading && items.length === 0 ? <tr><td colSpan={6}>No ASNs yet.</td></tr> : null}
            {items.map((asn) => (
              <tr key={asn.asn_id}>
                <td>{asn.po_number}</td>
                <td>{asn.status}</td>
                <td>{asn.dispatch_date}</td>
                <td>{asn.eta_date || "—"}</td>
                <td>{asn.total_qty}</td>
                <td>{asn.cartons_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MfgLayout>
  );
}
