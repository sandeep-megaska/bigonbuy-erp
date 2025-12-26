import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { requireErpAuthOrRedirect, isAdmin } from "../../lib/erpContext";

export default function ErpVariantsPage() {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [products, setProducts] = useState([]);
  const [items, setItems] = useState([]);

  const [productId, setProductId] = useState("");
  const [sku, setSku] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");

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

    const { data: prods, error: perr } = await supabase
      .from("erp_products")
      .select("id, title")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (perr) setErr(perr.message);
    setProducts(prods || []);
    setProductId(prods?.[0]?.id || "");

    const { data: vars, error: verr } = await supabase
      .from("erp_variants")
      .select("id, sku, size, color, cost_price, selling_price, created_at, product_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (verr) setErr(verr.message);

    // attach product title
    const map = new Map((prods || []).map((p) => [p.id, p.title]));
    const withTitle = (vars || []).map((v) => ({ ...v, product_title: map.get(v.product_id) || "" }));
    setItems(withTitle);
  }

  async function createVariant(e) {
    e.preventDefault();
    if (!ctx) return;
    if (!productId) return;
    if (!sku.trim()) return;

    setErr("");
    const payload = {
      company_id: ctx.companyId,
      product_id: productId,
      sku: sku.trim(),
      size: size.trim() || null,
      color: color.trim() || null,
      cost_price: costPrice ? Number(costPrice) : null,
      selling_price: sellingPrice ? Number(sellingPrice) : null,
    };

    const { error } = await supabase.from("erp_variants").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }

    setSku("");
    setSize("");
    setColor("");
    setCostPrice("");
    setSellingPrice("");
    await loadAll(ctx.companyId);
  }

  async function deleteVariant(id) {
    if (!ctx) return;
    if (!confirm("Delete this variant? Ledger rows referencing it may block deletion.")) return;

    setErr("");
    const { error } = await supabase
      .from("erp_variants")
      .delete()
      .eq("id", id)
      .eq("company_id", ctx.companyId);

    if (error) setErr(error.message);
    await loadAll(ctx.companyId);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Variants (SKUs)</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Manage SKU-level variants linked to products.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/erp">← ERP Home</a>
          <a href="/erp/products">← Products</a>
          <a href="/erp/inventory">Inventory →</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Add Variant</h3>

        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin can create/update).</div>
        ) : (
          <form onSubmit={createVariant} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>

            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (unique) e.g. MBPS06-Navy-XL"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size (S/M/L/XL…)"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="Cost price"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <input value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="Selling price"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />

            <div style={{ gridColumn: "1 / -1" }}>
              <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
                Create Variant
              </button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Variants ({items.length})
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>SKU</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Product</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Color</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Size</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Cost</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Selling</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id}>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1", fontWeight: 600 }}>{v.sku}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{v.product_title}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{v.color || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{v.size || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{v.cost_price ?? "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{v.selling_price ?? "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1", textAlign: "right" }}>
                    {canWrite ? (
                      <button
                        onClick={() => deleteVariant(v.id)}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ffd3d3", background: "#fff3f3" }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 16, color: "#777" }}>No variants yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
