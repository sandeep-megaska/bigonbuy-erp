import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Product = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

export default function InventoryProductsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [editingId, setEditingId] = useState<string | null>(null);

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
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadProducts(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadProducts(companyId: string, isActive = true) {
    setError("");
    const { data, error: loadError } = await supabase
      .from("erp_products")
      .select("id, title, status, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setItems((data || []) as Product[]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!title.trim()) {
      setError("Please provide a product title.");
      return;
    }
    if (!canWrite) {
      setError("Only owner/admin can create or edit products.");
      return;
    }

    setError("");
    if (editingId) {
      const { error: updateError } = await supabase
        .from("erp_products")
        .update({ title: title.trim(), status })
        .eq("company_id", ctx.companyId)
        .eq("id", editingId);
      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("erp_products").insert({
        company_id: ctx.companyId,
        title: title.trim(),
        status,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }

    setTitle("");
    setStatus("draft");
    setEditingId(null);
    await loadProducts(ctx.companyId);
  }

  function handleEdit(product: Product) {
    setTitle(product.title);
    setStatus(product.status);
    setEditingId(product.id);
  }

  function resetForm() {
    setTitle("");
    setStatus("draft");
    setEditingId(null);
  }

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading inventory products…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Products</p>
            <h1 style={h1Style}>Products</h1>
            <p style={subtitleStyle}>
              Manage style-level products. Products can also be auto-created during SKU CSV import.
            </p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>{editingId ? "Edit Product" : "Create Product"}</h2>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can create or edit products.</p>
          ) : (
            <form onSubmit={handleSubmit} style={formGridStyle}>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Product title (e.g., MBPS06 - One Piece Swimsuit)"
                style={{ ...inputStyle, gridColumn: "1 / -1" }}
              />
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
              <div style={buttonRowStyle}>
                <button type="submit" style={primaryButtonStyle}>
                  {editingId ? "Save Changes" : "Create Product"}
                </button>
                {editingId ? (
                  <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </section>

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Title</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr key={product.id}>
                  <td style={tableCellStyle}>
                    <div style={{ fontWeight: 600 }}>{product.title}</div>
                    <div style={mutedStyle}>{product.id}</div>
                  </td>
                  <td style={tableCellStyle}>{product.status}</td>
                  <td style={tableCellStyle}>{new Date(product.created_at).toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {canWrite ? (
                      <button type="button" onClick={() => handleEdit(product)} style={secondaryButtonStyle}>
                        Edit
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={emptyStateStyle}>
                    No products yet. Add one above or import SKUs from CSV.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 1fr) minmax(160px, 220px)",
  gap: 12,
  alignItems: "center",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: 18,
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
};

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
