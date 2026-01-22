import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome, isAdmin } from "../../lib/erpContext";

export default function ErpProductsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [styleCode, setStyleCode] = useState("");
  const [hsnCode, setHsnCode] = useState("");
  const [status, setStatus] = useState("draft");

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await load(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function load(companyId, isActive = true) {
    setErr("");
    const { data, error } = await supabase
      .from("erp_products")
      .select("id, title, style_code, hsn_code, status, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setItems(data || []);
  }

  async function createProduct(e) {
    e.preventDefault();
    if (!ctx || !ctx.companyId) return;
    if (!title.trim()) {
      setErr("Product title is required.");
      return;
    }
    if (!styleCode.trim()) {
      setErr("Style code is required.");
      return;
    }
    if (!canWrite) {
      setErr("Only owner/admin can create products.");
      return;
    }

    setErr("");
    const { error } = await supabase.rpc("erp_inventory_product_create", {
      p_title: title.trim(),
      p_style_code: styleCode.trim(),
      p_hsn_code: hsnCode.trim() || null,
      p_status: status,
    });

    if (error) {
      setErr(error.message);
      return;
    }
    setTitle("");
    setStyleCode("");
    setHsnCode("");
    setStatus("draft");
    await load(ctx.companyId);
  }

  async function updateStatus(id, nextStatus) {
    if (!ctx || !ctx.companyId) return;
    if (!canWrite) {
      setErr("Only owner/admin can update products.");
      return;
    }
    setErr("");
    const { error } = await supabase.rpc("erp_inventory_product_update_status", {
      p_id: id,
      p_status: nextStatus,
    });

    if (error) setErr(error.message);
    await load(ctx.companyId);
  }

  async function deleteProduct(id) {
    if (!ctx || !ctx.companyId) return;
    if (!confirm("Delete this product? Variants may also be deleted (cascade).")) return;
    if (!canWrite) {
      setErr("Only owner/admin can delete products.");
      return;
    }

    setErr("");
    const { error } = await supabase.rpc("erp_inventory_product_delete", {
      p_id: id,
    });

    if (error) setErr(error.message);
    await load(ctx.companyId);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Products</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Products</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Create and manage your product catalog (style-level).</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/erp">← ERP Home</a>
          <a href="/erp/variants">Variants →</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Add Product</h3>

        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin can create/update).</div>
        ) : (
          <form onSubmit={createProduct} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product title (e.g., MBPS06 - One Piece Swimsuit)"
              style={{ flex: "1 1 360px", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
            <input
              value={styleCode}
              onChange={(e) => setStyleCode(e.target.value)}
              placeholder="Style code"
              style={{ flex: "1 1 160px", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
            <input
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value)}
              placeholder="HSN code"
              style={{ flex: "1 1 160px", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
            <button style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
              Create
            </button>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Products ({items.length})
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#fff" }}>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Title</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Style Code</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>HSN Code</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Status</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}>Created</th>
                <th style={{ padding: 12, borderBottom: "1px solid #eee" }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>
                    <div style={{ fontWeight: 600 }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: "#777" }}>{p.id}</div>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{p.style_code || "—"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>{p.hsn_code || "—"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1" }}>
                    {canWrite ? (
                      <select
                        value={p.status}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="archived">archived</option>
                      </select>
                    ) : (
                      <span>{p.status}</span>
                    )}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1", color: "#555" }}>
                    {new Date(p.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f1f1", textAlign: "right" }}>
                    {canWrite ? (
                      <button
                        onClick={() => deleteProduct(p.id)}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ffd3d3", background: "#fff3f3" }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "#777" }}>
                    No products yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
