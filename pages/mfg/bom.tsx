import { useEffect, useMemo, useState, type CSSProperties } from "react";
import MfgLayout, { useMfgContext } from "../../components/mfg/MfgLayout";

type MaterialRow = {
  material_id: string;
  name: string;
  default_uom: string;
  is_active: boolean;
};

type BomListRow = {
  id: string;
  sku: string;
  status: "draft" | "active" | "archived";
  notes: string | null;
  line_count: number;
  created_at: string;
  updated_at: string;
};

type BomLine = {
  id?: string;
  material_id: string;
  qty_per_unit: string;
  uom: string;
  waste_pct: string;
  notes: string;
};

type AssignedSkuRow = {
  sku: string;
  variant_id: string | null;
  product_title: string | null;
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #d1d5db",
  borderRadius: 8,
};

export default function VendorBomPage() {
  return (
    <MfgLayout title="BOM Management">
      <BomContent />
    </MfgLayout>
  );
}

function BomContent() {
  const { vendorCode } = useMfgContext();
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [assignedSkus, setAssignedSkus] = useState<AssignedSkuRow[]>([]);
  const [boms, setBoms] = useState<BomListRow[]>([]);
  const [selectedBomId, setSelectedBomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    sku: "",
    status: "draft" as "draft" | "active",
    notes: "",
    lines: [] as BomLine[],
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

  function resetFormForNewSku() {
    setSelectedBomId("");
    setForm({ sku: "", status: "draft", notes: "", lines: [] });
  }

  async function loadData(active = true) {
    setLoading(true);
    setError("");
    try {
      const [matRes, bomRes, skuRes] = await Promise.all([
        fetch("/api/mfg/materials/list?only_active=true"),
        fetch("/api/mfg/bom/list"),
        fetch("/api/mfg/vendor/skus"),
      ]);
      const matJson = await matRes.json();
      const bomJson = await bomRes.json();
      const skuJson = await skuRes.json();
      if (!matRes.ok || !matJson?.ok) throw new Error(matJson?.error || "Failed to load materials");
      if (!bomRes.ok || !bomJson?.ok) throw new Error(bomJson?.error || "Failed to load BOMs");
      if (!skuRes.ok || !skuJson?.ok) throw new Error(skuJson?.error || "Failed to load assigned SKUs");
      if (!active) return;

      setMaterials(Array.isArray(matJson?.data?.items) ? matJson.data.items : []);
      setAssignedSkus(Array.isArray(skuJson?.data?.items) ? skuJson.data.items : []);
      setBoms(Array.isArray(bomJson?.data?.items) ? bomJson.data.items : []);
      if (!selectedBomId && !form.sku) {
        resetFormForNewSku();
      }
    } catch (e) {
      if (!active) return;
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      if (active) setLoading(false);
    }
  }

  async function hydrateFromBomPayload(data: any) {
    const bom = data?.bom;
    if (!bom?.id) {
      setError("Failed to load BOM details");
      return;
    }
    const lines = Array.isArray(data?.lines) ? data.lines : [];
    setSelectedBomId(String(bom.id));
    setForm({
      sku: String(bom.sku || ""),
      status: String(bom.status || "draft") === "active" ? "active" : "draft",
      notes: String(bom.notes || ""),
      lines: lines.map((line: any) => ({
        id: String(line.id),
        material_id: String(line.material_id || ""),
        qty_per_unit: String(line.qty_per_unit ?? ""),
        uom: String(line.uom || ""),
        waste_pct: line.waste_pct == null ? "" : String(line.waste_pct),
        notes: String(line.notes || ""),
      })),
    });
  }

  async function hydrateFormFromBom(bomId: string) {
    setError("");
    setMessage("");
    const res = await fetch(`/api/mfg/bom/get?bom_id=${encodeURIComponent(bomId)}`);
    const json = await res.json();
    if (!res.ok || !json?.ok || !json?.data?.bom) {
      setError(json?.error || "Failed to load BOM details");
      return;
    }
    await hydrateFromBomPayload(json.data);
  }

  async function hydrateFormFromSku(sku: string) {
    const trimmedSku = sku.trim();
    setError("");
    setMessage("");
    if (!trimmedSku) {
      resetFormForNewSku();
      return;
    }

    const res = await fetch(`/api/mfg/bom/by-sku?sku=${encodeURIComponent(trimmedSku)}`);
    const json = await res.json();
    if (!res.ok || !json?.ok || !json?.data?.bom) {
      setError(json?.error || "Failed to load BOM details");
      return;
    }
    await hydrateFromBomPayload(json.data);
  }

  const materialById = useMemo(() => {
    const map = new Map<string, MaterialRow>();
    materials.forEach((m) => map.set(m.material_id, m));
    return map;
  }, [materials]);

  function addLine() {
    const firstMaterial = materials[0];
    setForm((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          material_id: firstMaterial?.material_id || "",
          qty_per_unit: "",
          uom: firstMaterial?.default_uom || "",
          waste_pct: "",
          notes: "",
        },
      ],
    }));
  }

  function removeLine(index: number) {
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  }

  function updateLine(index: number, patch: Partial<BomLine>) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        if (patch.material_id && materialById.has(patch.material_id)) {
          const m = materialById.get(patch.material_id)!;
          if (!next.uom) next.uom = m.default_uom;
        }
        return next;
      }),
    }));
  }

  async function save(targetStatus: "draft" | "active") {
    setError("");
    setMessage("");

    if (!form.sku.trim()) {
      setError("SKU is required");
      return;
    }
    if (form.lines.length === 0) {
      setError("Add at least one BOM line");
      return;
    }

    const payloadLines = form.lines.map((line) => ({
      material_id: line.material_id,
      qty_per_unit: Number(line.qty_per_unit || 0),
      uom: line.uom,
      waste_pct: line.waste_pct === "" ? null : Number(line.waste_pct),
      notes: line.notes || null,
    }));

    if (payloadLines.some((line) => !line.material_id || !line.uom || line.qty_per_unit <= 0)) {
      setError("Each line requires material, qty_per_unit > 0, and uom");
      return;
    }

    setSaving(true);
    try {
      const upsertRes = await fetch("/api/mfg/bom/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: form.sku,
          status: targetStatus,
          notes: form.notes,
        }),
      });
      const upsertJson = await upsertRes.json();
      if (!upsertRes.ok || !upsertJson?.ok || !upsertJson?.data?.id) {
        throw new Error(upsertJson?.error || "Failed to save BOM");
      }

      const bomId = String(upsertJson.data.id);
      const linesRes = await fetch("/api/mfg/bom/lines-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom_id: bomId, lines: payloadLines }),
      });
      const linesJson = await linesRes.json();
      if (!linesRes.ok || !linesJson?.ok) {
        throw new Error(linesJson?.error || "Failed to save BOM lines");
      }

      setSelectedBomId(bomId);
      setMessage(targetStatus === "active" ? "BOM activated" : "Draft saved");
      await loadData();
      await hydrateFormFromSku(form.sku);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save BOM";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button onClick={resetFormForNewSku} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "0 12px", height: 36 }}>New SKU BOM</button>
        </div>
        {vendorCode ? <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>Vendor {vendorCode}</div> : null}

        {message ? <div style={{ marginTop: 12, background: "#ecfeff", border: "1px solid #99f6e4", color: "#0f766e", borderRadius: 8, padding: 10 }}>{message}</div> : null}
        {error ? <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: 10 }}>{error}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginTop: 18 }}>
          <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>BOM List</h3>
            {loading ? <div>Loading…</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {boms.map((bom) => (
                  <button key={bom.id} onClick={() => hydrateFormFromBom(bom.id)} style={{ textAlign: "left", border: selectedBomId === bom.id ? "1px solid #2563eb" : "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#fff" }}>
                    <div style={{ fontWeight: 700 }}>{bom.sku}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>Status: {bom.status} • Lines: {bom.line_count}</div>
                  </button>
                ))}
                {boms.length === 0 ? <div style={{ color: "#6b7280" }}>No BOMs yet.</div> : null}
              </div>
            )}
          </section>

          <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>{selectedBomId ? "Edit BOM" : "New SKU BOM"}</h3>
            {assignedSkus.length === 0 ? (
              <div style={{ marginBottom: 10, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 8, padding: 10 }}>
                No SKUs assigned yet. Please contact Megaska.
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <label>SKU
                <select
                  style={inputStyle}
                  value={form.sku}
                  disabled={assignedSkus.length === 0}
                  onChange={(e) => hydrateFormFromSku(e.target.value)}
                >
                  <option value="">Select SKU</option>
                  {assignedSkus.map((sku) => (
                    <option key={sku.sku} value={sku.sku}>
                      {sku.product_title ? `${sku.sku} — ${sku.product_title}` : sku.sku}
                    </option>
                  ))}
                </select>
              </label>
              <label>Status
                <select style={inputStyle} value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value === "active" ? "active" : "draft" }))}>
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                </select>
              </label>
              <label>Notes<input style={inputStyle} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} /></label>
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0 }}>Lines</h4>
              <button onClick={addLine} disabled={materials.length === 0}>Add line</button>
            </div>

            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Material", "Qty per unit", "UOM", "Waste %", "Notes", ""].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px", color: "#475569" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => (
                    <tr key={`${line.id || "new"}-${index}`}>
                      <td style={{ padding: 6 }}>
                        <select style={inputStyle} value={line.material_id} onChange={(e) => updateLine(index, { material_id: e.target.value, uom: materialById.get(e.target.value)?.default_uom || line.uom })}>
                          <option value="">Select material</option>
                          {materials.map((material) => (
                            <option key={material.material_id} value={material.material_id}>{material.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6 }}><input style={inputStyle} type="number" step="any" min="0" value={line.qty_per_unit} onChange={(e) => updateLine(index, { qty_per_unit: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input style={inputStyle} value={line.uom} onChange={(e) => updateLine(index, { uom: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input style={inputStyle} type="number" step="any" min="0" value={line.waste_pct} onChange={(e) => updateLine(index, { waste_pct: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><input style={inputStyle} value={line.notes} onChange={(e) => updateLine(index, { notes: e.target.value })} /></td>
                      <td style={{ padding: 6 }}><button onClick={() => removeLine(index)}>Remove</button></td>
                    </tr>
                  ))}
                  {form.lines.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 10, color: "#6b7280" }}>No lines yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button disabled={saving} onClick={() => save("draft")}>Save Draft</button>
              <button disabled={saving} onClick={() => save("active")} style={{ background: "#065f46", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px" }}>Activate</button>
            </div>
          </section>
        </div>
    </>
  );
}
