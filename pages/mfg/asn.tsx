import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";

type VendorAsn = {
  asn_id: string;
  po_id: string;
  po_number: string;
  status: string;
  dispatch_date: string;
  eta_date: string | null;
  transporter_name?: string | null;
  tracking_no?: string | null;
  dispatched_at?: string | null;
  remarks?: string | null;
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

type PackingState = {
  cartons: { id: string; carton_no: number; status: string }[];
  lines_in_asn: { po_line_id: string; sku: string; qty_packed_total: number }[];
  applied_scan_count: number;
};

type AsnEvent = { id: string; event_type: string; event_ts?: string | null; created_at?: string | null; payload?: { note?: string } | null };
type AsnDoc = { id: string; doc_type: string; file_path: string; uploaded_at: string; signed_url?: string | null };

export default function MfgAsnPage() {
  const [items, setItems] = useState<VendorAsn[]>([]);
  const [poLines, setPoLines] = useState<OpenPoLine[]>([]);
  const [packing, setPacking] = useState<PackingState>({ cartons: [], lines_in_asn: [], applied_scan_count: 0 });
  const [cartonLines, setCartonLines] = useState<{ po_line_id: string; sku: string; qty_packed: number }[]>([]);
  const [selectedCartonId, setSelectedCartonId] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [scanStatus, setScanStatus] = useState("");

  const [events, setEvents] = useState<AsnEvent[]>([]);
  const [documents, setDocuments] = useState<AsnDoc[]>([]);
  const [dispatchForm, setDispatchForm] = useState({ transporter_name: "", tracking_no: "", dispatched_at: "", remarks: "" });
  const [noteText, setNoteText] = useState("");
  const [docForm, setDocForm] = useState({ doc_type: "COURIER_RECEIPT", filename: "", mime_type: "application/pdf", file_base64: "" });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showManual, setShowManual] = useState(false);

  const [form, setForm] = useState({ po_id: "", dispatch_date: "", eta_date: "", asn_id: "", po_line_id: "", qty: "", carton_count: "0" });

  const poOptions = useMemo(() => {
    const map = new Map<string, string>();
    poLines.forEach((line) => map.set(line.po_id, line.po_number || line.po_id));
    return Array.from(map.entries()).map(([id, number]) => ({ id, number }));
  }, [poLines]);

  const selectedAsn = items.find((item) => item.asn_id === form.asn_id);

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

  async function loadPackingState(asnId: string) {
    if (!asnId) {
      setPacking({ cartons: [], lines_in_asn: [], applied_scan_count: 0 });
      setSelectedCartonId("");
      setCartonLines([]);
      return;
    }
    const res = await fetch(`/api/mfg/asn/packing-state?asn_id=${asnId}`);
    const json = await res.json();
    if (!res.ok || !json?.ok || !json?.data?.ok) return;
    const next = json.data as PackingState;
    setPacking(next);
    const firstCarton = next.cartons[0]?.id || "";
    setSelectedCartonId((prev) => (prev && next.cartons.some((c) => c.id === prev) ? prev : firstCarton));
    if ((next.cartons?.length || 0) > 0) setShowManual(false);
  }

  async function loadTracking(asnId: string) {
    if (!asnId) {
      setEvents([]);
      setDocuments([]);
      return;
    }
    const res = await fetch(`/api/mfg/asns/${asnId}/tracking`);
    const json = await res.json();
    if (!res.ok || !json?.ok) return;
    setEvents(json.data?.events || []);
    setDocuments(json.data?.documents || []);
    const asn = json.data?.asn;
    if (asn) {
      setDispatchForm({
        transporter_name: asn.transporter_name || "",
        tracking_no: asn.tracking_no || "",
        dispatched_at: asn.dispatched_at ? String(asn.dispatched_at).slice(0, 16) : "",
        remarks: asn.remarks || "",
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadPackingState(form.asn_id);
    void loadTracking(form.asn_id);
  }, [form.asn_id]);

  async function createAsn() {
    setError("");
    setMsg("");
    const res = await fetch("/api/mfg/asn/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ po_id: form.po_id, dispatch_date: form.dispatch_date, eta_date: form.eta_date || null }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to create ASN");
    setForm((prev) => ({ ...prev, asn_id: json.data.id }));
    setMsg("ASN draft created.");
    await load();
    await loadPackingState(json.data.id);
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
    setMsg("Boxes created.");
    await load();
    await loadPackingState(form.asn_id);
  }

  async function submitAsn() {
    const res = await fetch("/api/mfg/asn/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asn_id: form.asn_id }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to submit ASN");
    setMsg("ASN submitted.");
    await load();
    await loadPackingState(form.asn_id);
  }

  async function scanPiece() {
    setError("");
    if (!selectedCartonId || !scanInput.trim()) return;
    const res = await fetch("/api/mfg/asn/scan-piece", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carton_id: selectedCartonId, barcode: scanInput.trim() }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to scan item");
    if (!json?.data?.ok) {
      setScanStatus(`Rejected: ${json?.data?.reason || "UNKNOWN"}`);
      setError(`Scan rejected (${json?.data?.reason || "UNKNOWN"}).`);
    } else {
      setScanStatus("Applied");
      setCartonLines(json.data.lines_in_carton || []);
    }
    setScanInput("");
    await load();
    await loadPackingState(form.asn_id);
  }

  async function markDispatched() {
    const res = await fetch(`/api/mfg/asns/${form.asn_id}/mark-dispatched`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dispatchForm) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to mark dispatched");
    setMsg("ASN marked dispatched.");
    await load();
    await loadTracking(form.asn_id);
  }

  async function markInTransit() {
    const res = await fetch(`/api/mfg/asns/${form.asn_id}/mark-in-transit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarks: dispatchForm.remarks }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to mark in transit");
    setMsg("ASN marked in transit.");
    await load();
    await loadTracking(form.asn_id);
  }

  async function addNote() {
    const res = await fetch(`/api/mfg/asns/${form.asn_id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: noteText }) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to add note");
    setNoteText("");
    await loadTracking(form.asn_id);
  }

  async function uploadDoc() {
    const res = await fetch(`/api/mfg/asns/${form.asn_id}/docs/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(docForm) });
    const json = await res.json();
    if (!res.ok || !json?.ok) return setError(json?.error || "Failed to upload document");
    setDocForm((prev) => ({ ...prev, filename: "", file_base64: "" }));
    await loadTracking(form.asn_id);
  }

  const poLineOptions = poLines.filter((line) => !form.po_id || line.po_id === form.po_id);
  const canSubmit = Boolean(form.asn_id && selectedAsn?.status === "DRAFT" && packing.cartons.length > 0 && packing.applied_scan_count > 0);
  const hasPackingForPrint = packing.cartons.length > 0 && packing.applied_scan_count > 0;
  const allowReprint = selectedAsn?.status === "SUBMITTED" || selectedAsn?.status === "DISPATCHED" || selectedAsn?.status === "IN_TRANSIT";
  const canPrint = Boolean(form.asn_id && (hasPackingForPrint || allowReprint));

  return (
    <MfgLayout title="ASN Booking">
      <div style={{ marginBottom: 12, padding: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, color: "#1e3a8a" }}>
        Tip: Create ASN → Create Boxes → Scan items into each Box → Submit ASN
      </div>
      {msg ? <div style={{ marginBottom: 12, color: "#0f766e" }}>{msg}</div> : null}
      {error ? <div style={{ marginBottom: 12, color: "#991b1b" }}>{error}</div> : null}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Create ASN Draft</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(190px, 1fr))", gap: 12 }}>
          <div><label>Purchase Order (PO)</label><select value={form.po_id} onChange={(e) => setForm((prev) => ({ ...prev, po_id: e.target.value }))} style={{ width: "100%" }}><option value="">Select PO</option>{poOptions.map((po) => <option key={po.id} value={po.id}>{po.number}</option>)}</select></div>
          <div><label>Dispatch Date</label><input type="date" value={form.dispatch_date} onChange={(e) => setForm((prev) => ({ ...prev, dispatch_date: e.target.value }))} style={{ width: "100%" }} /></div>
          <div><label>Expected Arrival Date (ETA)</label><input type="date" value={form.eta_date} onChange={(e) => setForm((prev) => ({ ...prev, eta_date: e.target.value }))} style={{ width: "100%" }} /></div>
          <div style={{ alignSelf: "end" }}><button onClick={createAsn}>Create ASN Draft</button></div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(190px, 1fr))", gap: 12, marginTop: 14 }}>
          <div><label>ASN Draft (Select to continue packing)</label><select value={form.asn_id} onChange={(e) => setForm((prev) => ({ ...prev, asn_id: e.target.value }))} style={{ width: "100%" }}><option value="">Select ASN draft</option>{items.filter((item) => item.status === "DRAFT").map((asn) => <option key={asn.asn_id} value={asn.asn_id}>{asn.po_number} • {asn.asn_id.slice(0, 8)}</option>)}</select></div>
          <div><label>Number of Boxes (Cartons)</label><input type="number" min="0" value={form.carton_count} onChange={(e) => setForm((prev) => ({ ...prev, carton_count: e.target.value }))} style={{ width: "100%" }} /></div>
          <div style={{ alignSelf: "end" }}><button onClick={setCartons} disabled={!form.asn_id}>Create Boxes</button></div>
          <div style={{ alignSelf: "end" }}><button onClick={submitAsn} disabled={!canSubmit}>Submit ASN</button></div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => window.open(`/api/mfg/asns/${form.asn_id}/packing-slip.pdf?format=slip`, "_blank", "noopener,noreferrer")} disabled={!canPrint}>Print Packing Slip</button>
          <button onClick={() => window.open(`/api/mfg/asns/${form.asn_id}/box-labels.pdf`, "_blank", "noopener,noreferrer")} disabled={!canPrint}>Print Box Labels</button>
        </div>

        <div style={{ marginTop: 12 }}><button onClick={() => setShowManual((prev) => !prev)}>{showManual ? "Hide" : "Show"} Advanced/manual entry</button></div>

        {showManual ? <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(190px, 1fr))", gap: 12, marginTop: 12 }}>
          <div><label>PO Item (SKU/Size)</label><select value={form.po_line_id} onChange={(e) => setForm((prev) => ({ ...prev, po_line_id: e.target.value }))} style={{ width: "100%" }}><option value="">Select PO item</option>{poLineOptions.map((line) => <option key={line.po_line_id} value={line.po_line_id}>{line.sku} (open {line.open_qty})</option>)}</select></div>
          <div><label>Qty</label><input type="number" min="0" value={form.qty} onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))} style={{ width: "100%" }} /></div>
          <div style={{ alignSelf: "end" }}><button onClick={addLine} disabled={!form.asn_id}>Add Item (Manual)</button></div>
        </div> : null}
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Dispatch & Tracking</h3>
        {selectedAsn?.status === "SUBMITTED" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10 }}>
          <input placeholder="Transporter" value={dispatchForm.transporter_name} onChange={(e) => setDispatchForm((p) => ({ ...p, transporter_name: e.target.value }))} />
          <input placeholder="AWB/LR" value={dispatchForm.tracking_no} onChange={(e) => setDispatchForm((p) => ({ ...p, tracking_no: e.target.value }))} />
          <input type="datetime-local" value={dispatchForm.dispatched_at} onChange={(e) => setDispatchForm((p) => ({ ...p, dispatched_at: e.target.value }))} />
          <input placeholder="Remarks" value={dispatchForm.remarks} onChange={(e) => setDispatchForm((p) => ({ ...p, remarks: e.target.value }))} />
          <button onClick={markDispatched} style={{ gridColumn: "1 / -1" }}>Mark Dispatched</button>
        </div> : null}
        {selectedAsn?.status === "DISPATCHED" ? <button onClick={markInTransit}>Mark In Transit</button> : null}
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Documents</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(130px, 1fr))", gap: 8 }}>
          <select value={docForm.doc_type} onChange={(e) => setDocForm((p) => ({ ...p, doc_type: e.target.value }))}><option value="COURIER_RECEIPT">Courier Receipt</option><option value="PACKING_SLIP">Packing Slip</option><option value="OTHER">Other</option></select>
          <input placeholder="filename.pdf" value={docForm.filename} onChange={(e) => setDocForm((p) => ({ ...p, filename: e.target.value }))} />
          <input placeholder="mime type" value={docForm.mime_type} onChange={(e) => setDocForm((p) => ({ ...p, mime_type: e.target.value }))} />
          <input placeholder="base64 content" value={docForm.file_base64} onChange={(e) => setDocForm((p) => ({ ...p, file_base64: e.target.value }))} />
          <button onClick={uploadDoc} disabled={!form.asn_id || !docForm.file_base64}>Upload</button>
        </div>
        <ul>{documents.map((doc) => <li key={doc.id}>{doc.doc_type} - {doc.signed_url ? <a href={doc.signed_url} target="_blank" rel="noreferrer">open</a> : doc.file_path}</li>)}</ul>
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Timeline</h3>
        <div style={{ display: "flex", gap: 8 }}><input placeholder="Add note" value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ flex: 1 }} /><button onClick={addNote} disabled={!form.asn_id || !noteText.trim()}>Add Note</button></div>
        <ul>{events.map((ev) => <li key={ev.id}>{ev.event_type} • {ev.event_ts || ev.created_at}{ev.payload?.note ? ` • ${ev.payload.note}` : ""}</li>)}</ul>
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Packing (Scan)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr auto", gap: 10, alignItems: "end" }}>
          <div><label>Carton</label><select value={selectedCartonId} onChange={(e) => setSelectedCartonId(e.target.value)} style={{ width: "100%" }}><option value="">Select Box</option>{packing.cartons.map((c) => <option key={c.id} value={c.id}>Box-{c.carton_no}</option>)}</select></div>
          <div><label>Barcode Scan</label><input value={scanInput} onChange={(e) => setScanInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void scanPiece(); }} placeholder="Scan barcode and press Enter" style={{ width: "100%", fontSize: 18, padding: 10 }} /></div>
          <button onClick={scanPiece} disabled={!selectedCartonId || !scanInput.trim()}>Scan Piece</button>
        </div>
        {scanStatus ? <div style={{ marginTop: 10 }}>Last scan status: {scanStatus}</div> : null}
        {form.asn_id ? <div style={{ marginTop: 10 }}><Link href={`/mfg/asn/packing-list?asn_id=${form.asn_id}`}>Printable packing list (Box → SKU → Qty)</Link></div> : null}
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>My ASNs</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>PO</th><th>Status</th><th>Dispatch</th><th>ETA</th><th>Transporter</th><th>Tracking</th><th>Total Qty</th><th>Cartons</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8}>Loading...</td></tr> : null}
            {!loading && items.length === 0 ? <tr><td colSpan={8}>No ASNs yet.</td></tr> : null}
            {items.map((asn) => <tr key={asn.asn_id}><td>{asn.po_number}</td><td>{asn.status}</td><td>{asn.dispatch_date}</td><td>{asn.eta_date || "—"}</td><td>{asn.transporter_name || "—"}</td><td>{asn.tracking_no || "—"}</td><td>{asn.total_qty}</td><td>{asn.cartons_count}</td></tr>)}
          </tbody>
        </table>
      </div>
    </MfgLayout>
  );
}
