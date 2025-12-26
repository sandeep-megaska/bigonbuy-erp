import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { requireErpAuthOrRedirect, isAdmin } from "../../lib/erpContext";

export default function ErpInventoryPage() {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [warehouses, setWarehouses] = useState([]);
  const [variants, setVariants] = useState([]);
  const [stockRows, setStockRows] = useState([]);

  // adjustment form
  const [warehouseId, setWarehouseId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [type, setType] = useState("adjustment");
  const [reason, setReason] = useState("Manual adjustment");
  const [ref, setRef] = useState("");

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    (async () => {
      const c = await requireErpAuthOrRedirect();
      if (!c) return;
      setCtx(c);
      await loadAll(c.companyId);
      setLoading(false);
    })();
  }, []);

  async function loadAll(companyId) {
    setErr("");

    const { data: wh, error: whErr } = await supabase
      .from("erp_warehouses")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (whErr) setErr(whErr.message);
    setWarehouses(wh || []);
    setWarehouseId(wh?.[0]?.id || "");

    const { data: vars, error: vErr } = await supabase
      .from("erp_variants")
      .select("id, sku, product_id, color, size")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (vErr) setErr(vErr.message);
    setVariants(vars || []);
    setVariantId(vars?.[0]?.id || "");

    // stock view
    const { data: st, error: sErr } = await supabase
      .from("erp_inventory_on_hand")
      .select("company_id, warehouse_id, variant_id, qty_on_hand")
      .eq("company_id", companyId);

    if (sErr) setErr(sErr.message);

    // map names for display
    const whMap = new Map((wh || []).map((w) => [w.id, w.name]));
    const vMap = new Map((vars || []).map((v) => [v.id, v.sku]));

    const decorated = (st || []).map((r) => ({
      ...r,
      warehouse_name: whMap.get(r.warehouse_id) || r.warehouse_id,
      sku: vMap.get(r.variant_id) || r.variant_id,
    }));

    // sort: warehouse then sku
    decorated.sort((a, b) => (a.warehouse_name + a.sku).localeCompare(b.warehouse_name + b.sku));
    setStockRows(decorated);
  }

  async function createAdjustment(e) {
    e.preventDefault();
    if (!ctx) return;

    const q = Number(qty);
    if (!warehouseId || !variantId || !Number.isFinite(q) || q === 0) {
      setErr("Please select warehouse, variant and enter a non-zero qty.");
      return;
    }

    setErr("");
    const payload = {
      company_id: ctx.companyId,
      warehouse_id: warehouseId,
      variant_id: variantId,
      qty: q, // +in, -out
      type,
      reason: reason || null,
      ref: ref || null,
      created_by: ctx.user.id,
    };

    const { error } = await supabase.from("erp_inventory_ledger").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }

    setQty("");
    setReason("Manual adjustment");
    setRef("");
    await loadAll(ctx.companyId);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Inventory</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Track stock levels and post adjustments (qty + / -).</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/erp">← ERP Home</a>
          <a href="/erp/products">Products</a>
          <a href="/erp/variants">Variants</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Stock Adjustment</h3>
        <p style={{ marginTop: 6, color: "#777", fontSize: 13 }}>
          Convention: <b>+qty</b> means stock IN, <b>-qty</b> means stock OUT.
        </p>

        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin can post ledger entries).</div>
        ) : (
          <form onSubmit={createAdjustment} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.sku}</option>
              ))}
            </select>

            <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty (e.g. 10 or -2)"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              <option value="opening">opening</option>
              <option value="adjustment">adjustment</option>
              <option value="purchase_in">purchase_in</option>
              <option value="sale_out">sale_out</option>
              <option value="return_in">return_in</option>
            </select>

            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference (optional)"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <div style={{ gridColumn: "1 / -1" }}>
              <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
                Post Ledger Entry
              </button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Stock On Hand
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Warehouse</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>SKU</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{r.warehouse_name}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1", fontWeight: 600 }}>{r.sku}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{r.qty_on_hand}</td>
                </tr>
              ))}
              {stockRows.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: 16, color: "#777" }}>No stock yet. Post an opening/adjustment entry.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
