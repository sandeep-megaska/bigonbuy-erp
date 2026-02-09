import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import MfgLayout from "../../components/mfg/MfgLayout";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../components/erp/ui/styles";

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

type ScanFeedback = { state: "APPLIED" | "REJECTED"; reason?: string } | null;

export default function MfgAsnPage() {
  const [items, setItems] = useState<VendorAsn[]>([]);
  const [poLines, setPoLines] = useState<OpenPoLine[]>([]);
  const [packing, setPacking] = useState<PackingState>({ cartons: [], lines_in_asn: [], applied_scan_count: 0 });
  const [cartonLines, setCartonLines] = useState<{ po_line_id: string; sku: string; qty_packed: number }[]>([]);
  const [selectedCartonId, setSelectedCartonId] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);

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

  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const poOptions = useMemo(() => {
    const map = new Map<string, string>();
    poLines.forEach((line) => map.set(line.po_id, line.po_number || line.po_id));
    return Array.from(map.entries()).map(([id, number]) => ({ id, number }));
  }, [poLines]);

  const selectedAsn = items.find((item) => item.asn_id === form.asn_id);
  const selectedCarton = packing.cartons.find((carton) => carton.id === selectedCartonId);

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
      const reason = json?.data?.reason || "UNKNOWN";
      setScanFeedback({ state: "REJECTED", reason });
      setError(`Scan rejected (${reason}).`);
    } else {
      setScanFeedback({ state: "APPLIED" });
      setCartonLines(json.data.lines_in_carton || []);
    }
    setScanInput("");
    await load();
    await loadPackingState(form.asn_id);
    scanInputRef.current?.focus();
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
      <div style={infoBannerStyle}>Tip: Create ASN → Create Boxes → Scan items into each Box → Submit ASN</div>
      {msg ? <div style={successBannerStyle}>{msg}</div> : null}
      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>ASN Details</h3>
        <p style={sectionCaptionStyle}>Choose the purchase order and shipment dates to create an ASN draft.</p>
        <div style={formGridStyle}>
          <div>
            <label style={labelStyle}>Purchase Order (PO)</label>
            <select value={form.po_id} onChange={(e) => setForm((prev) => ({ ...prev, po_id: e.target.value }))} style={{ ...inputStyle, width: "100%" }}>
              <option value="">Select PO</option>
              {poOptions.map((po) => <option key={po.id} value={po.id}>{po.number}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Dispatch Date</label>
            <input type="date" value={form.dispatch_date} onChange={(e) => setForm((prev) => ({ ...prev, dispatch_date: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
            <p style={helperTextStyle}>Date when vendor hands over packed cartons to transporter.</p>
          </div>
          <div>
            <label style={labelStyle}>Expected Arrival Date (ETA)</label>
            <input type="date" value={form.eta_date} onChange={(e) => setForm((prev) => ({ ...prev, eta_date: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
            <p style={helperTextStyle}>Estimated date when shipment reaches destination warehouse.</p>
          </div>
        </div>
        <div style={buttonBarStyle}>
          <div />
          <button onClick={createAsn} style={primaryButtonStyle}>Create ASN Draft</button>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={sectionTitleStyle}>Boxes</h3>
        <p style={sectionCaptionStyle}>Select ASN draft, create cartons, and review the current box setup.</p>
        <div style={formGridStyle}>
          <div>
            <label style={labelStyle}>ASN Draft</label>
            <select value={form.asn_id} onChange={(e) => setForm((prev) => ({ ...prev, asn_id: e.target.value }))} style={{ ...inputStyle, width: "100%" }}>
              <option value="">Select ASN draft</option>
              {items.filter((item) => item.status === "DRAFT").map((asn) => <option key={asn.asn_id} value={asn.asn_id}>{asn.po_number} • {asn.asn_id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Number of Boxes (Cartons)</label>
            <input type="number" min="0" value={form.carton_count} onChange={(e) => setForm((prev) => ({ ...prev, carton_count: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle}>Box Status</label>
            <div style={statusBoxStyle}>{packing.cartons.length} created • {packing.applied_scan_count} scans applied</div>
          </div>
        </div>
        <div style={buttonBarStyle}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => window.open(`/api/mfg/asns/${form.asn_id}/packing-slip.pdf?format=slip`, "_blank", "noopener,noreferrer")} disabled={!canPrint} style={secondaryButtonStyle}>Print Packing Slip</button>
            <button onClick={() => window.open(`/api/mfg/asns/${form.asn_id}/box-labels.pdf`, "_blank", "noopener,noreferrer")} disabled={!canPrint} style={secondaryButtonStyle}>Print Box Labels</button>
          </div>
          <button onClick={setCartons} disabled={!form.asn_id} style={primaryButtonStyle}>Create Boxes</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowManual((prev) => !prev)} style={secondaryButtonStyle}>{showManual ? "Hide" : "Show"} Advanced/manual entry</button>
          {showManual ? (
            <div style={{ ...formGridStyle, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>PO Item (SKU/Size)</label>
                <select value={form.po_line_id} onChange={(e) => setForm((prev) => ({ ...prev, po_line_id: e.target.value }))} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">Select PO item</option>
                  {poLineOptions.map((line) => <option key={line.po_line_id} value={line.po_line_id}>{line.sku} (open {line.open_qty})</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Qty</label>
                <input type="number" min="0" value={form.qty} onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div style={{ alignSelf: "end" }}>
                <button onClick={addLine} disabled={!form.asn_id} style={secondaryButtonStyle}>Add Item (Manual)</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={sectionTitleStyle}>Packing (Scan)</h3>
        <p style={sectionCaptionStyle}>Select box, scan barcodes quickly, and verify line totals in real time.</p>
        <div style={formGridStyle}>
          <div>
            <label style={labelStyle}>Carton</label>
            <select value={selectedCartonId} onChange={(e) => setSelectedCartonId(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
              <option value="">Select Box</option>
              {packing.cartons.map((c) => <option key={c.id} value={c.id}>Box-{c.carton_no}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Barcode Scan</label>
            <input
              ref={scanInputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void scanPiece(); }}
              placeholder="Scan barcode and press Enter"
              style={{ ...inputStyle, width: "100%", fontSize: 20, padding: "12px 14px", fontWeight: 600 }}
            />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button onClick={scanPiece} disabled={!selectedCartonId || !scanInput.trim()} style={primaryButtonStyle}>Scan Piece</button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...badgeStyle, backgroundColor: "#eef2ff", color: "#3730a3" }}>Selected: {selectedCarton ? `Box-${selectedCarton.carton_no}` : "None"}</span>
          {scanFeedback ? (
            <span style={{ ...badgeStyle, backgroundColor: scanFeedback.state === "APPLIED" ? "#dcfce7" : "#fee2e2", color: scanFeedback.state === "APPLIED" ? "#166534" : "#991b1b" }}>
              {scanFeedback.state}{scanFeedback.reason ? ` · ${scanFeedback.reason}` : ""}
            </span>
          ) : null}
          {form.asn_id ? <Link href={`/mfg/asn/packing-list?asn_id=${form.asn_id}`}>Printable packing list (Box → SKU → Qty)</Link> : null}
        </div>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <div>
            <h4 style={subSectionHeadingStyle}>Packed in selected box</h4>
            {cartonLines.length === 0 ? <p style={helperTextStyle}>No scanned items for selected box.</p> : (
              <table style={tableStyle}>
                <thead>
                  <tr><th style={tableHeaderCellStyle}>SKU</th><th style={tableHeaderCellStyle}>Qty</th></tr>
                </thead>
                <tbody>
                  {cartonLines.map((line) => <tr key={line.po_line_id}><td style={tableCellStyle}>{line.sku}</td><td style={tableCellStyle}>{line.qty_packed}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h4 style={subSectionHeadingStyle}>ASN packed totals</h4>
            {packing.lines_in_asn.length === 0 ? <p style={helperTextStyle}>No packed totals yet.</p> : (
              <table style={tableStyle}>
                <thead>
                  <tr><th style={tableHeaderCellStyle}>SKU</th><th style={tableHeaderCellStyle}>Qty Packed</th></tr>
                </thead>
                <tbody>
                  {packing.lines_in_asn.map((line) => <tr key={line.po_line_id}><td style={tableCellStyle}>{line.sku}</td><td style={tableCellStyle}>{line.qty_packed_total}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={sectionTitleStyle}>Submit / Status</h3>
        <p style={sectionCaptionStyle}>Submit ready ASN and progress shipment status updates.</p>
        {selectedAsn?.status === "SUBMITTED" ? <div style={formGridStyle}>
          <div><label style={labelStyle}>Transporter</label><input value={dispatchForm.transporter_name} onChange={(e) => setDispatchForm((p) => ({ ...p, transporter_name: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
          <div><label style={labelStyle}>AWB/LR</label><input value={dispatchForm.tracking_no} onChange={(e) => setDispatchForm((p) => ({ ...p, tracking_no: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
          <div><label style={labelStyle}>Dispatched At</label><input type="datetime-local" value={dispatchForm.dispatched_at} onChange={(e) => setDispatchForm((p) => ({ ...p, dispatched_at: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
          <div><label style={labelStyle}>Remarks</label><input value={dispatchForm.remarks} onChange={(e) => setDispatchForm((p) => ({ ...p, remarks: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
        </div> : null}
        <div style={buttonBarStyle}>
          <div>
            {selectedAsn?.status === "DISPATCHED" ? <button onClick={markInTransit} style={secondaryButtonStyle}>Mark In Transit</button> : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedAsn?.status === "SUBMITTED" ? <button onClick={markDispatched} style={primaryButtonStyle}>Mark Dispatched</button> : null}
            <button onClick={submitAsn} disabled={!canSubmit} style={primaryButtonStyle}>Submit ASN</button>
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={sectionTitleStyle}>Timeline & Documents</h3>
        <p style={sectionCaptionStyle}>Upload shipping documents and record ASN event notes.</p>
        <div style={{ ...formGridStyle, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div><label style={labelStyle}>Document Type</label><select value={docForm.doc_type} onChange={(e) => setDocForm((p) => ({ ...p, doc_type: e.target.value }))} style={{ ...inputStyle, width: "100%" }}><option value="COURIER_RECEIPT">Courier Receipt</option><option value="PACKING_SLIP">Packing Slip</option><option value="OTHER">Other</option></select></div>
          <div><label style={labelStyle}>Filename</label><input value={docForm.filename} onChange={(e) => setDocForm((p) => ({ ...p, filename: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
          <div><label style={labelStyle}>Mime Type</label><input value={docForm.mime_type} onChange={(e) => setDocForm((p) => ({ ...p, mime_type: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
          <div><label style={labelStyle}>File Base64</label><input value={docForm.file_base64} onChange={(e) => setDocForm((p) => ({ ...p, file_base64: e.target.value }))} style={{ ...inputStyle, width: "100%" }} /></div>
        </div>
        <div style={buttonBarStyle}>
          <div />
          <button onClick={uploadDoc} disabled={!form.asn_id || !docForm.file_base64} style={primaryButtonStyle}>Upload Document</button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <div>
            <h4 style={subSectionHeadingStyle}>Documents</h4>
            <ul style={listStyle}>{documents.map((doc) => <li key={doc.id}>{doc.doc_type} - {doc.signed_url ? <a href={doc.signed_url} target="_blank" rel="noreferrer">open</a> : doc.file_path}</li>)}</ul>
          </div>
          <div>
            <h4 style={subSectionHeadingStyle}>Timeline</h4>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="Add note" />
              <button onClick={addNote} disabled={!form.asn_id || !noteText.trim()} style={secondaryButtonStyle}>Add Note</button>
            </div>
            <ul style={listStyle}>{events.map((ev) => <li key={ev.id}>{ev.event_type} • {ev.event_ts || ev.created_at}{ev.payload?.note ? ` • ${ev.payload.note}` : ""}</li>)}</ul>
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={sectionTitleStyle}>My ASNs</h3>
        <table style={tableStyle}>
          <thead><tr><th style={tableHeaderCellStyle}>PO</th><th style={tableHeaderCellStyle}>Status</th><th style={tableHeaderCellStyle}>Dispatch</th><th style={tableHeaderCellStyle}>ETA</th><th style={tableHeaderCellStyle}>Transporter</th><th style={tableHeaderCellStyle}>Tracking</th><th style={tableHeaderCellStyle}>Total Qty</th><th style={tableHeaderCellStyle}>Cartons</th></tr></thead>
          <tbody>
            {loading ? <tr><td style={tableCellStyle} colSpan={8}>Loading...</td></tr> : null}
            {!loading && items.length === 0 ? <tr><td style={tableCellStyle} colSpan={8}>No ASNs yet.</td></tr> : null}
            {items.map((asn) => <tr key={asn.asn_id}><td style={tableCellStyle}>{asn.po_number}</td><td style={tableCellStyle}>{asn.status}</td><td style={tableCellStyle}>{asn.dispatch_date}</td><td style={tableCellStyle}>{asn.eta_date || "—"}</td><td style={tableCellStyle}>{asn.transporter_name || "—"}</td><td style={tableCellStyle}>{asn.tracking_no || "—"}</td><td style={tableCellStyle}>{asn.total_qty}</td><td style={tableCellStyle}>{asn.cartons_count}</td></tr>)}
          </tbody>
        </table>
      </section>
    </MfgLayout>
  );
}

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 20, color: "#111827" };
const sectionCaptionStyle: CSSProperties = { margin: "6px 0 14px", color: "#6b7280", fontSize: 13 };
const subSectionHeadingStyle: CSSProperties = { margin: "0 0 8px", fontSize: 15, color: "#111827" };
const labelStyle: CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13, color: "#111827" };
const helperTextStyle: CSSProperties = { margin: "6px 0 0", fontSize: 12, color: "#6b7280" };
const buttonBarStyle: CSSProperties = { marginTop: 14, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" };

const infoBannerStyle: CSSProperties = { marginBottom: 12, padding: "10px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, color: "#1e3a8a" };
const successBannerStyle: CSSProperties = { marginBottom: 12, padding: "10px 12px", background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 8, color: "#166534" };
const errorBannerStyle: CSSProperties = { marginBottom: 12, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b" };
const statusBoxStyle: CSSProperties = { ...inputStyle, backgroundColor: "#f8fafc", color: "#334155", minHeight: 40, display: "flex", alignItems: "center" };
const listStyle: CSSProperties = { margin: "8px 0 0", paddingLeft: 16, display: "grid", gap: 6 };
