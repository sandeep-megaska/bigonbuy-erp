import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent } from "react";
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
import { resolveErpAssetUrl, uploadErpAsset } from "../../../../lib/erp/assetImages";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Product = {
  id: string;
  title: string;
  style_code: string | null;
  hsn_code: string | null;
  status: string;
  created_at: string;
  image_url: string | null;
  image_preview?: string | null;
};

export default function InventoryProductsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [title, setTitle] = useState("");
  const [styleCode, setStyleCode] = useState("");
  const [hsnCode, setHsnCode] = useState("");
  const [status, setStatus] = useState("draft");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

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
      .select("id, title, style_code, hsn_code, status, created_at, image_url")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) {
      const rows = (data || []) as Product[];
      const withImages = await Promise.all(
        rows.map(async (product) => ({
          ...product,
          image_preview: await resolveErpAssetUrl(product.image_url),
        }))
      );
      setItems(withImages);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!title.trim()) {
      setError("Please provide a product title.");
      return;
    }
    if (!styleCode.trim()) {
      setError("Please provide a style code.");
      return;
    }
    if (!canWrite) {
      setError("Only owner/admin can create or edit products.");
      return;
    }

    setError("");
    const trimmedStyleCode = styleCode.trim();
    const trimmedHsnCode = hsnCode.trim();
    const { data: existingStyle, error: styleError } = await supabase
      .from("erp_products")
      .select("id")
      .eq("company_id", ctx.companyId)
      .ilike("style_code", trimmedStyleCode)
      .maybeSingle();
    if (styleError && styleError.code !== "PGRST116") {
      setError(styleError.message);
      return;
    }
    if (existingStyle && existingStyle.id !== editingId) {
      setError(`Style code "${trimmedStyleCode}" is already in use.`);
      return;
    }

    if (editingId) {
      const { error: updateError } = await supabase.rpc("erp_inventory_product_update", {
        p_id: editingId,
        p_title: title.trim(),
        p_style_code: trimmedStyleCode,
        p_hsn_code: trimmedHsnCode || null,
        p_status: status,
      });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      if (imageFile) {
        const path = `company/${ctx.companyId}/products/${editingId}/${Date.now()}-${imageFile.name}`;
        const { error: uploadError } = await uploadErpAsset(path, imageFile);
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const { error: imageError } = await supabase.rpc("erp_inventory_product_set_image", {
          p_id: editingId,
          p_image_url: path,
        });
        if (imageError) {
          setError(imageError.message);
          return;
        }
      }
    } else {
      const { data: newProduct, error: insertError } = await supabase.rpc("erp_inventory_product_create", {
        p_title: title.trim(),
        p_style_code: trimmedStyleCode,
        p_hsn_code: trimmedHsnCode || null,
        p_status: status,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      const productId = typeof newProduct === "object" && newProduct ? (newProduct as { id?: string }).id : null;
      if (imageFile && productId) {
        const path = `company/${ctx.companyId}/products/${productId}/${Date.now()}-${imageFile.name}`;
        const { error: uploadError } = await uploadErpAsset(path, imageFile);
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const { error: imageError } = await supabase.rpc("erp_inventory_product_set_image", {
          p_id: productId,
          p_image_url: path,
        });
        if (imageError) {
          setError(imageError.message);
          return;
        }
      }
    }

    setTitle("");
    setStyleCode("");
    setHsnCode("");
    setStatus("draft");
    setEditingId(null);
    setImageFile(null);
    setImagePreview(null);
    await loadProducts(ctx.companyId);
  }

  function handleEdit(product: Product) {
    setTitle(product.title);
    setStyleCode(product.style_code || "");
    setHsnCode(product.hsn_code || "");
    setStatus(product.status);
    setEditingId(product.id);
    setImageFile(null);
    setImagePreview(product.image_preview || null);
  }

  function resetForm() {
    setTitle("");
    setStyleCode("");
    setHsnCode("");
    setStatus("draft");
    setEditingId(null);
    setImageFile(null);
    setImagePreview(null);
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
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
              <input
                value={styleCode}
                onChange={(event) => setStyleCode(event.target.value)}
                placeholder="Style code (required)"
                style={inputStyle}
                required
              />
              <input
                value={hsnCode}
                onChange={(event) => setHsnCode(event.target.value)}
                placeholder="HSN code (optional)"
                style={inputStyle}
              />
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
              <div style={imageUploadStyle}>
                {imagePreview ? <img src={imagePreview} alt="Product preview" style={imagePreviewStyle} /> : null}
                <label style={imageUploadLabelStyle}>
                  <input type="file" accept="image/*" onChange={handleImageChange} style={fileInputStyle} />
                  {imagePreview ? "Replace image" : "Upload image"}
                </label>
                <span style={mutedStyle}>Optional. Stored in Supabase assets.</span>
              </div>
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
                <th style={tableHeaderCellStyle}>Style Code</th>
                <th style={tableHeaderCellStyle}>HSN Code</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr key={product.id}>
                  <td style={tableCellStyle}>
                    <div style={productCellStyle}>
                      {product.image_preview ? (
                        <img src={product.image_preview} alt={product.title} style={thumbnailStyle} />
                      ) : (
                        <div style={thumbnailPlaceholderStyle}>IMG</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{product.title}</div>
                        <div style={mutedStyle}>{product.id}</div>
                      </div>
                    </div>
                  </td>
                  <td style={tableCellStyle}>{product.style_code || "—"}</td>
                  <td style={tableCellStyle}>{product.hsn_code || "—"}</td>
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
                  <td colSpan={6} style={emptyStateStyle}>
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
  gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, 220px) minmax(180px, 220px)",
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

const imageUploadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  gridColumn: "1 / -1",
};

const imageUploadLabelStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px dashed #cbd5f5",
  cursor: "pointer",
  fontWeight: 600,
};

const fileInputStyle: CSSProperties = {
  display: "none",
};

const imagePreviewStyle: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 12,
  objectFit: "cover",
  border: "1px solid #e5e7eb",
};

const productCellStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const thumbnailStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid #e5e7eb",
};

const thumbnailPlaceholderStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 10,
  border: "1px dashed #d1d5db",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#9ca3af",
  fontSize: 11,
  fontWeight: 600,
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
