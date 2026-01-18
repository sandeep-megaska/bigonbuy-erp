import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ChangeEvent, FormEvent } from "react";
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
import { parseCsv } from "../../../../lib/erp/parseCsv";
import { supabase } from "../../../../lib/supabaseClient";

type ProductOption = {
  id: string;
  title: string;
  style_code?: string | null;
  image_url?: string | null;
  image_preview?: string | null;
};

type VariantRow = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  cost_price: number | null;
  product_id: string;
  product_title: string;
  created_at: string;
  image_url: string | null;
  image_preview?: string | null;
  product_image_preview?: string | null;
};

type ImportRow = {
  rowNumber: number;
  sku: string;
  title: string;
  option1Name: string;
  option1Value: string;
  option2Name: string;
  option2Value: string;
  costRaw: string;
};

type ImportSummary = {
  createdProducts: number;
  createdSkus: number;
  skippedDuplicates: number;
  skippedRows: number[];
  errors: string[];
  isDryRun: boolean;
};

const REQUIRED_HEADERS = {
  sku: ["variant sku"],
  title: ["title"],
  option1Name: ["option1 name"],
  option1Value: ["option1 value"],
  option2Name: ["option2 name"],
  option2Value: ["option2 value"],
  cost: ["cost per item"],
};

export default function InventorySkusPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<VariantRow[]>([]);
  const [productId, setProductId] = useState("");
  const [sku, setSku] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [variantImageFile, setVariantImageFile] = useState<File | null>(null);
  const [variantImagePreview, setVariantImagePreview] = useState<string | null>(null);

  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");

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

      await loadAll(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadAll(companyId: string, isActive = true) {
    setError("");

    const { data: prodData, error: prodError } = await supabase
      .from("erp_products")
      .select("id, title, style_code, image_url")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (prodError && isActive) setError(prodError.message);
    const list = (prodData || []) as ProductOption[];
    const withImages = await Promise.all(
      list.map(async (product) => ({
        ...product,
        image_preview: await resolveErpAssetUrl(product.image_url || null),
      }))
    );
    if (isActive) {
      setProducts(withImages);
      setProductId((prev) => prev || withImages?.[0]?.id || "");
    }

    const { data: varData, error: varError } = await supabase
      .from("erp_variants")
      .select("id, sku, size, color, cost_price, created_at, product_id, image_url")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (varError && isActive) setError(varError.message);

    const productMap = new Map((withImages || []).map((prod) => [prod.id, prod]));
    const withTitle = await Promise.all(
      (varData || []).map(async (variant) => {
        const product = productMap.get((variant as any).product_id) as ProductOption | undefined;
        return {
          ...(variant as any),
          product_title: product?.title || "",
          image_preview: await resolveErpAssetUrl((variant as any).image_url),
          product_image_preview: product?.image_preview || null,
        } as VariantRow;
      })
    );

    if (isActive) setItems(withTitle);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!productId || !sku.trim()) {
      setError("Please choose a product and enter a SKU.");
      return;
    }
    if (!canWrite) {
      setError("Only owner/admin can create or edit SKUs.");
      return;
    }

    setError("");
    const payload = {
      company_id: ctx.companyId,
      product_id: productId,
      sku: sku.trim(),
      size: size.trim() || null,
      color: color.trim() || null,
      cost_price: costPrice ? Number(costPrice) : null,
    };

    if (costPrice && Number.isNaN(payload.cost_price)) {
      setError("Cost price must be a number.");
      return;
    }

    if (editingId) {
      const { error: updateError } = await supabase
        .from("erp_variants")
        .update(payload)
        .eq("company_id", ctx.companyId)
        .eq("id", editingId);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      if (variantImageFile) {
        const path = `company/${ctx.companyId}/variants/${editingId}/${Date.now()}-${variantImageFile.name}`;
        const { error: uploadError } = await uploadErpAsset(path, variantImageFile);
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const { error: imageError } = await supabase
          .from("erp_variants")
          .update({ image_url: path })
          .eq("company_id", ctx.companyId)
          .eq("id", editingId);
        if (imageError) {
          setError(imageError.message);
          return;
        }
      }
    } else {
      const { data: newVariant, error: insertError } = await supabase
        .from("erp_variants")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) {
        setError(insertError.message);
        return;
      }
      if (variantImageFile && newVariant?.id) {
        const path = `company/${ctx.companyId}/variants/${newVariant.id}/${Date.now()}-${variantImageFile.name}`;
        const { error: uploadError } = await uploadErpAsset(path, variantImageFile);
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const { error: imageError } = await supabase
          .from("erp_variants")
          .update({ image_url: path })
          .eq("company_id", ctx.companyId)
          .eq("id", newVariant.id);
        if (imageError) {
          setError(imageError.message);
          return;
        }
      }
    }

    resetForm();
    await loadAll(ctx.companyId);
  }

  function resetForm() {
    setEditingId(null);
    setSku("");
    setSize("");
    setColor("");
    setCostPrice("");
    setVariantImageFile(null);
    setVariantImagePreview(null);
  }

  function handleEdit(row: VariantRow) {
    setEditingId(row.id);
    setProductId(row.product_id);
    setSku(row.sku);
    setSize(row.size || "");
    setColor(row.color || "");
    setCostPrice(row.cost_price != null ? String(row.cost_price) : "");
    setVariantImageFile(null);
    setVariantImagePreview(row.image_preview || row.product_image_preview || null);
  }

  function handleVariantImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setVariantImageFile(file);
    setVariantImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function normalizeHeader(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function findHeaderIndex(headers: string[], candidates: string[]) {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
      const index = normalized.findIndex(
        (header) => header === candidate || header.startsWith(candidate)
      );
      if (index !== -1) return index;
    }
    return -1;
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setImportSummary(null);
    setImportError("");
    setImportRows([]);

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      setImportError("The CSV file appears to be empty.");
      return;
    }

    const headers = rows[0];
    const skuIndex = findHeaderIndex(headers, REQUIRED_HEADERS.sku);
    const titleIndex = findHeaderIndex(headers, REQUIRED_HEADERS.title);
    const option1NameIndex = findHeaderIndex(headers, REQUIRED_HEADERS.option1Name);
    const option1ValueIndex = findHeaderIndex(headers, REQUIRED_HEADERS.option1Value);
    const option2NameIndex = findHeaderIndex(headers, REQUIRED_HEADERS.option2Name);
    const option2ValueIndex = findHeaderIndex(headers, REQUIRED_HEADERS.option2Value);
    const costIndex = findHeaderIndex(headers, REQUIRED_HEADERS.cost);

    const missing: string[] = [];
    if (skuIndex === -1) missing.push("Variant SKU");
    if (titleIndex === -1) missing.push("Title");

    if (missing.length) {
      setImportError(`Missing required columns: ${missing.join(", ")}.`);
      return;
    }

    const parsed = rows.slice(1).map((row, idx) => ({
      rowNumber: idx + 2,
      sku: row[skuIndex] ?? "",
      title: row[titleIndex] ?? "",
      option1Name: option1NameIndex === -1 ? "" : row[option1NameIndex] ?? "",
      option1Value: option1ValueIndex === -1 ? "" : row[option1ValueIndex] ?? "",
      option2Name: option2NameIndex === -1 ? "" : row[option2NameIndex] ?? "",
      option2Value: option2ValueIndex === -1 ? "" : row[option2ValueIndex] ?? "",
      costRaw: costIndex === -1 ? "" : row[costIndex] ?? "",
    }));

    setImportRows(parsed);
  }

  function normalizeOptionLabel(value: string) {
    return value.trim().toLowerCase();
  }

  function deriveSizeAndColorFromOptions(
    row: ImportRow,
  ): { sizeValue: string | null; colorValue: string | null; hasOptionData: boolean } {
    let sizeValue: string | null = null;
    let colorValue: string | null = null;
    let hasOptionData = false;

    const optionPairs = [
      { name: row.option1Name, value: row.option1Value },
      { name: row.option2Name, value: row.option2Value },
    ];

    optionPairs.forEach((option) => {
      const name = option.name.trim();
      const value = option.value.trim();
      if (name || value) {
        hasOptionData = true;
      }
      if (!value) return;
      const normalizedName = normalizeOptionLabel(name);
      if (normalizedName.includes("size")) {
        sizeValue = value;
      }
      if (normalizedName.includes("color") || normalizedName.includes("colour")) {
        colorValue = value;
      }
    });

    return { sizeValue, colorValue, hasOptionData };
  }

  function deriveSizeAndColorFromSku(
    skuTrim: string,
  ): { sizeValue: string | null; colorValue: string | null; styleCode: string } {
    const parts = skuTrim
      .split("-")
      .map((part) => part.trim())
      .filter(Boolean);
    const colorValue = parts.length >= 2 ? parts[1] : null;
    const sizeValue = parts.length >= 3 ? parts.slice(2).join("-") : parts.length === 2 ? parts[1] : null;
    return { sizeValue, colorValue, styleCode: parts[0] || "" };
  }

  async function runImport() {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setImportError("Only owner/admin can import SKUs.");
      return;
    }
    if (!importRows.length) {
      setImportError("Upload a Shopify CSV before importing.");
      return;
    }

    setImportError("");
    setImportSummary(null);
    setImporting(true);

    const [productsRes, variantsRes] = await Promise.all([
      supabase
        .from("erp_products")
        .select("id, title, style_code")
        .eq("company_id", ctx.companyId),
      supabase
        .from("erp_variants")
        .select("sku")
        .eq("company_id", ctx.companyId),
    ]);

    if (productsRes.error || variantsRes.error) {
      setImportError(productsRes.error?.message || variantsRes.error?.message || "Failed to load catalog.");
      setImporting(false);
      return;
    }

    const productMap = new Map<string, ProductOption>();
    (productsRes.data || []).forEach((product) => {
      const styleCode = (product as ProductOption).style_code?.trim();
      if (styleCode) {
        productMap.set(styleCode.toLowerCase(), product as ProductOption);
      }
    });

    const existingSkus = new Set<string>((variantsRes.data || []).map((row) => row.sku.trim()));
    const seenSkus = new Set<string>(existingSkus);
    const pendingRows: Array<
      ImportRow & {
        skuTrim: string;
        styleCode: string;
        sizeValue: string | null;
        colorValue: string | null;
      }
    > = [];
    const skippedRows: number[] = [];
    const errors: string[] = [];

    importRows.forEach((row) => {
      const skuTrim = row.sku.trim();

      if (!skuTrim) {
        errors.push(`Row ${row.rowNumber}: Missing Variant SKU.`);
        return;
      }

      const costValue = row.costRaw.trim();
      if (costValue && Number.isNaN(Number(costValue))) {
        errors.push(`Row ${row.rowNumber}: Cost per item must be a number.`);
        return;
      }

      const { sizeValue, colorValue, hasOptionData } = deriveSizeAndColorFromOptions(row);
      const skuFallback = deriveSizeAndColorFromSku(skuTrim);
      let resolvedSize: string | null = sizeValue;
      let resolvedColor: string | null = colorValue;

      if (!hasOptionData) {
        resolvedSize = skuFallback.sizeValue;
        resolvedColor = skuFallback.colorValue;
      } else {
        if (!resolvedSize) resolvedSize = skuFallback.sizeValue;
        if (!resolvedColor) resolvedColor = skuFallback.colorValue;
      }
      const styleCode = skuFallback.styleCode;

      if (!styleCode) {
        errors.push(`Row ${row.rowNumber}: SKU must include a style code segment.`);
        return;
      }

      if (!productMap.has(styleCode.toLowerCase())) {
        errors.push(`Row ${row.rowNumber}: Missing product for style code "${styleCode}".`);
        return;
      }

      if (!resolvedSize || !resolvedColor) {
        errors.push(`Row ${row.rowNumber}: Missing size or color for SKU ${skuTrim}.`);
        return;
      }

      if (seenSkus.has(skuTrim)) {
        skippedRows.push(row.rowNumber);
        return;
      }

      seenSkus.add(skuTrim);
      pendingRows.push({ ...row, skuTrim, styleCode, sizeValue: resolvedSize, colorValue: resolvedColor });
    });

    const createdProducts = 0;

    let createdSkus = 0;
    if (dryRun) {
      createdSkus = pendingRows.length;
    } else {
      for (const row of pendingRows) {
        const product = productMap.get(row.styleCode.toLowerCase());
        if (!product) {
          errors.push(`Row ${row.rowNumber}: Missing product for style code "${row.styleCode}".`);
          continue;
        }
        const payload = {
          company_id: ctx.companyId,
          product_id: product.id,
          sku: row.skuTrim,
          size: row.sizeValue,
          color: row.colorValue,
          cost_price: row.costRaw.trim() ? Number(row.costRaw.trim()) : null,
        };
        const { error: insertError } = await supabase.from("erp_variants").insert(payload);
        if (insertError) {
          errors.push(`Row ${row.rowNumber}: ${insertError.message}`);
          continue;
        }
        createdSkus += 1;
      }
    }

    setImportSummary({
      createdProducts,
      createdSkus,
      skippedDuplicates: skippedRows.length,
      skippedRows,
      errors,
      isDryRun: dryRun,
    });

    setImporting(false);

    if (!dryRun) {
      await loadAll(ctx.companyId);
    }
  }

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading SKUs…</div>
      </ErpShell>
    );
  }

  const previewRows = importRows.slice(0, 6);

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · SKUs</p>
            <h1 style={h1Style}>SKUs (Variants)</h1>
            <p style={subtitleStyle}>Create and manage SKU-level variants linked to products.</p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>{editingId ? "Edit SKU" : "Create SKU"}</h2>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can create or edit SKUs.</p>
          ) : (
            <form onSubmit={handleSubmit} style={formGridStyle}>
              <select value={productId} onChange={(event) => setProductId(event.target.value)} style={inputStyle}>
                <option value="">Select product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.style_code ? `${product.title} (${product.style_code})` : product.title}
                  </option>
                ))}
              </select>
              <input
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                placeholder="SKU (unique per company)"
                style={inputStyle}
              />
              <input
                value={size}
                onChange={(event) => setSize(event.target.value)}
                placeholder="Size"
                style={inputStyle}
              />
              <input
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder="Color"
                style={inputStyle}
              />
              <input
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
                placeholder="Cost price"
                style={inputStyle}
              />
              <div style={imageUploadStyle}>
                {variantImagePreview ? (
                  <img src={variantImagePreview} alt="SKU preview" style={imagePreviewStyle} />
                ) : null}
                <label style={imageUploadLabelStyle}>
                  <input type="file" accept="image/*" onChange={handleVariantImageChange} style={fileInputStyle} />
                  {variantImagePreview ? "Replace image" : "Upload image"}
                </label>
                <span style={mutedStyle}>Optional. SKU image overrides product image.</span>
              </div>
              <div style={buttonRowStyle}>
                <button type="submit" style={primaryButtonStyle}>
                  {editingId ? "Save Changes" : "Create SKU"}
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

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Import SKUs (CSV)</h2>
          <p style={mutedStyle}>
            Accepts Shopify product export CSV files. Required headers: Variant SKU, Title, Option1 Value (Size),
            Option2 Value (Color). Optional: Cost per item.
          </p>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can run imports.</p>
          ) : (
            <>
              <div style={importControlsStyle}>
                <label style={fileLabelStyle}>
                  <input type="file" accept=".csv" onChange={handleFileChange} style={fileInputStyle} />
                  Choose CSV
                </label>
                <span style={mutedStyle}>{fileName || "No file selected"}</span>
                <label style={checkboxStyle}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(event) => setDryRun(event.target.checked)}
                  />
                  Dry run (no inserts)
                </label>
                <button type="button" onClick={runImport} style={primaryButtonStyle} disabled={importing}>
                  {importing ? "Importing…" : "Run Import"}
                </button>
              </div>
              {importError ? <div style={errorStyle}>{importError}</div> : null}
              {previewRows.length ? (
                <div style={previewBoxStyle}>
                  <div style={previewTitleStyle}>Preview (first {previewRows.length} rows)</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>SKU</th>
                        <th style={tableHeaderCellStyle}>Title</th>
                        <th style={tableHeaderCellStyle}>Size</th>
                        <th style={tableHeaderCellStyle}>Color</th>
                        <th style={tableHeaderCellStyle}>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td style={tableCellStyle}>{row.sku || "—"}</td>
                          <td style={tableCellStyle}>{row.title || "—"}</td>
                          <td style={tableCellStyle}>{row.size || "—"}</td>
                          <td style={tableCellStyle}>{row.color || "—"}</td>
                          <td style={tableCellStyle}>{row.costRaw || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {importSummary ? (
                <div style={summaryBoxStyle}>
                  <div style={summaryTitleStyle}>
                    {importSummary.isDryRun ? "Dry Run Summary" : "Import Summary"}
                  </div>
                  <ul style={summaryListStyle}>
                    <li>Created products: {importSummary.createdProducts}</li>
                    <li>Created SKUs: {importSummary.createdSkus}</li>
                    <li>Skipped duplicates: {importSummary.skippedDuplicates}</li>
                  </ul>
                  {importSummary.skippedRows.length ? (
                    <div style={mutedStyle}>
                      Skipped rows: {importSummary.skippedRows.join(", ")}
                    </div>
                  ) : null}
                  {importSummary.errors.length ? (
                    <div style={errorListStyle}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Errors</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {importSummary.errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Image</th>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Product</th>
                <th style={tableHeaderCellStyle}>Size</th>
                <th style={tableHeaderCellStyle}>Color</th>
                <th style={tableHeaderCellStyle}>Cost</th>
                <th style={tableHeaderCellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td style={tableCellStyle}>
                    {row.image_preview || row.product_image_preview ? (
                      <img
                        src={row.image_preview || row.product_image_preview || undefined}
                        alt={`${row.sku} image`}
                        style={thumbnailStyle}
                      />
                    ) : (
                      <div style={thumbnailPlaceholderStyle}>IMG</div>
                    )}
                  </td>
                  <td style={{ ...tableCellStyle, fontWeight: 600 }}>{row.sku}</td>
                  <td style={tableCellStyle}>{row.product_title}</td>
                  <td style={tableCellStyle}>{row.size || "—"}</td>
                  <td style={tableCellStyle}>{row.color || "—"}</td>
                  <td style={tableCellStyle}>{row.cost_price ?? "—"}</td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {canWrite ? (
                      <button type="button" onClick={() => handleEdit(row)} style={secondaryButtonStyle}>
                        Edit
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={emptyStateStyle}>
                    No SKUs yet. Create one above or import from CSV.
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
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "center",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const importControlsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  marginTop: 12,
};

const fileLabelStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px dashed #cbd5f5",
  cursor: "pointer",
  fontWeight: 600,
};

const fileInputStyle: CSSProperties = {
  display: "none",
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

const imagePreviewStyle: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 12,
  objectFit: "cover",
  border: "1px solid #e5e7eb",
};

const thumbnailStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid #e5e7eb",
};

const thumbnailPlaceholderStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "1px dashed #d1d5db",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#9ca3af",
  fontSize: 11,
  fontWeight: 600,
};

const checkboxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const previewBoxStyle: CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
};

const previewTitleStyle: CSSProperties = {
  padding: "10px 16px",
  fontWeight: 600,
  backgroundColor: "#f8fafc",
};

const summaryBoxStyle: CSSProperties = {
  marginTop: 16,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 16,
  backgroundColor: "#f8fafc",
};

const summaryTitleStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 8,
};

const summaryListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: "#111827",
};

const errorListStyle: CSSProperties = {
  marginTop: 12,
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  padding: 12,
  color: "#991b1b",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  margin: 0,
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
