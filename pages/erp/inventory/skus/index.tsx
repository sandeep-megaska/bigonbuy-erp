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
  cost_override: number | null;
  cost_override_effective_from?: string | null;
  ledger_unit_cost?: number | null;
  effective_unit_cost?: number | null;
  effective_stock_value?: number | null;
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

type BulkPreviewRow = {
  line: number;
  raw: string;
  style_code: string;
  hsn: string;
  gst_rate: number | null;
  status: "ok" | "error";
  reason?: string;
};

type BulkUpsertResult = {
  total_lines: number;
  valid: number;
  inserted: number;
  updated: number;
  upserted: number;
  skipped: number;
  errors: number;
  error_rows?: Array<{
    line: number;
    style_code: string | null;
    sku?: string | null;
    hsn: string | null;
    gst_rate: string | null;
    reason: string;
  }>;
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
  const [taxBulkText, setTaxBulkText] = useState("");
  const [taxBulkPreview, setTaxBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [taxBulkResult, setTaxBulkResult] = useState<BulkUpsertResult | null>(null);
  const [taxBulkError, setTaxBulkError] = useState<string | null>(null);
  const [taxBulkSaving, setTaxBulkSaving] = useState(false);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);
  const canManageTax = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );
  const inrFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

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

    const variants = (varData || []) as VariantRow[];
    const skuList = Array.from(
      new Set(
        variants
          .map((variant) => variant.sku?.trim())
          .filter((sku): sku is string => Boolean(sku))
          .map((sku) => sku.toUpperCase())
      )
    );
    const variantIds = Array.from(
      new Set(
        variants
          .map((variant) => variant.id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const overrideMap = new Map<string, { unit_cost: number; effective_from: string | null }>();
    const ledgerMap = new Map<string, { unit_cost: number }>();
    const effectiveCostMap = new Map<string, { effective_unit_cost: number | null; effective_stock_value: number | null }>();

    if (skuList.length) {
      const { data: overrideData, error: overrideError } = await supabase
        .from("erp_sku_cost_overrides")
        .select("sku, unit_cost, effective_from, created_at")
        .in("sku", skuList)
        .order("effective_from", { ascending: false })
        .order("created_at", { ascending: false });

      if (overrideError && isActive) setError(overrideError.message);
      (overrideData || []).forEach((row) => {
        const key = row.sku?.trim().toUpperCase();
        if (!key || overrideMap.has(key)) return;
        overrideMap.set(key, {
          unit_cost: Number(row.unit_cost),
          effective_from: row.effective_from ?? null,
        });
      });
    }

    if (variantIds.length) {
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("erp_inventory_ledger")
        .select("variant_id, unit_cost, movement_at, updated_at")
        .in("variant_id", variantIds)
        .order("movement_at", { ascending: false })
        .order("updated_at", { ascending: false });

      if (ledgerError && isActive) setError(ledgerError.message);
      (ledgerData || []).forEach((row) => {
        const key = row.variant_id as string | undefined;
        if (!key || ledgerMap.has(key)) return;
        ledgerMap.set(key, {
          unit_cost: Number(row.unit_cost),
        });
      });
    }

    if (variantIds.length) {
      const { data: effectiveData, error: effectiveError } = await supabase
        .from("erp_inventory_effective_cost_v")
        .select("variant_id, on_hand_qty, effective_unit_cost, effective_value")
        .in("variant_id", variantIds);

      if (effectiveError && isActive) setError(effectiveError.message);

      const rollupMap = new Map<
        string,
        {
          onHandWithCost: number;
          effectiveValueTotal: number;
        }
      >();

      (effectiveData || []).forEach((row) => {
        const key = row.variant_id as string | undefined;
        if (!key) return;
        const onHand = Number(row.on_hand_qty ?? 0);
        const effectiveValue = row.effective_value == null ? null : Number(row.effective_value);
        if (!rollupMap.has(key)) {
          rollupMap.set(key, { onHandWithCost: 0, effectiveValueTotal: 0 });
        }
        const rollup = rollupMap.get(key)!;
        if (effectiveValue != null) {
          rollup.onHandWithCost += onHand;
          rollup.effectiveValueTotal += effectiveValue;
        }
      });

      rollupMap.forEach((rollup, key) => {
        const effectiveUnitCost =
          rollup.onHandWithCost > 0 ? rollup.effectiveValueTotal / rollup.onHandWithCost : null;
        const effectiveStockValue =
          rollup.onHandWithCost > 0 ? rollup.effectiveValueTotal : null;
        effectiveCostMap.set(key, {
          effective_unit_cost: effectiveUnitCost,
          effective_stock_value: effectiveStockValue,
        });
      });
    }

    const productMap = new Map((withImages || []).map((prod) => [prod.id, prod]));
    const withTitle = await Promise.all(
      variants.map(async (variant) => {
        const product = productMap.get((variant as any).product_id) as ProductOption | undefined;
        const override = overrideMap.get(variant.sku?.trim().toUpperCase() || "");
        const ledger = ledgerMap.get(variant.id);
        const effectiveCost = effectiveCostMap.get(variant.id);
        return {
          ...(variant as any),
          product_title: product?.title || "",
          image_preview: await resolveErpAssetUrl((variant as any).image_url),
          product_image_preview: product?.image_preview || null,
          cost_override: override?.unit_cost ?? null,
          cost_override_effective_from: override?.effective_from ?? null,
          ledger_unit_cost: ledger?.unit_cost ?? null,
          effective_unit_cost: effectiveCost?.effective_unit_cost ?? null,
          effective_stock_value: effectiveCost?.effective_stock_value ?? null,
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
      p_product_id: productId,
      p_sku: sku.trim(),
      p_size: size.trim() || null,
      p_color: color.trim() || null,
      p_cost_price: costPrice ? Number(costPrice) : null,
      p_selling_price: null,
    };

    if (costPrice && Number.isNaN(payload.p_cost_price)) {
      setError("Cost price must be a number.");
      return;
    }

    if (editingId) {
      const { error: updateError } = await supabase.rpc("erp_inventory_variant_upsert", {
        p_id: editingId,
        ...payload,
      });
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
        const { error: imageError } = await supabase.rpc("erp_inventory_variant_set_image", {
          p_id: editingId,
          p_image_url: path,
        });
        if (imageError) {
          setError(imageError.message);
          return;
        }
      }
    } else {
      const { data: newVariant, error: insertError } = await supabase.rpc("erp_inventory_variant_upsert", {
        p_id: null,
        ...payload,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      const variantId = typeof newVariant === "object" && newVariant ? (newVariant as { id?: string }).id : null;
      if (variantImageFile && variantId) {
        const path = `company/${ctx.companyId}/variants/${variantId}/${Date.now()}-${variantImageFile.name}`;
        const { error: uploadError } = await uploadErpAsset(path, variantImageFile);
        if (uploadError) {
          setError(uploadError.message);
          return;
        }
        const { error: imageError } = await supabase.rpc("erp_inventory_variant_set_image", {
          p_id: variantId,
          p_image_url: path,
        });
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

    if (missing.length) {
      setImportError(`Missing required columns: ${missing.join(", ")}.`);
      return;
    }

    const parsed = rows.slice(1).map((row, idx) => ({
      rowNumber: idx + 2,
      sku: row[skuIndex] ?? "",
      title: titleIndex === -1 ? "" : row[titleIndex] ?? "",
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

  const parseTaxBulkRows = (raw: string): BulkPreviewRow[] => {
    const rows: BulkPreviewRow[] = [];
    const lines = raw.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const withoutComments = line.split("#")[0]?.trim() ?? "";
      if (!withoutComments) {
        return;
      }

      const commaParts = withoutComments.split(/[,\t]+/).map((part) => part.trim());
      const parts =
        commaParts.length >= 2 ? commaParts : withoutComments.split(/\s+/).map((part) => part.trim());

      const style = (parts[0] || "").toUpperCase();
      const rawHsn = parts[1] || "";
      const normalizedHsn = rawHsn.replace(/\D/g, "");
      const rawRate = parts[2];
      const rateValue = rawRate === undefined || rawRate === "" ? 5 : Number(rawRate);

      let reason = "";
      if (!style) {
        reason = "Style code is required.";
      } else if (!normalizedHsn) {
        reason = "HSN is required.";
      } else if (!/^\d{4,10}$/.test(normalizedHsn)) {
        reason = "HSN must be 4-10 digits.";
      } else if (!Number.isFinite(rateValue)) {
        reason = "GST rate must be numeric.";
      } else if (rateValue !== 5) {
        reason = "GST rate must be 5.";
      }

      rows.push({
        line: lineNumber,
        raw: withoutComments,
        style_code: style,
        hsn: normalizedHsn,
        gst_rate: Number.isFinite(rateValue) ? rateValue : null,
        status: reason ? "error" : "ok",
        reason: reason || undefined,
      });
    });

    return rows;
  };

  const handleTaxBulkValidate = () => {
    setTaxBulkError(null);
    setTaxBulkResult(null);
    setTaxBulkPreview(parseTaxBulkRows(taxBulkText));
  };

  const handleTaxBulkSave = async () => {
    setTaxBulkError(null);
    setTaxBulkResult(null);

    if (!canManageTax) {
      setTaxBulkError("You need finance/admin/owner access to update GST mappings.");
      return;
    }

    const parsed = parseTaxBulkRows(taxBulkText);
    setTaxBulkPreview(parsed);
    const validRows = parsed.filter((row) => row.status === "ok");

    if (!validRows.length) {
      setTaxBulkError("No valid rows to save. Please fix errors and try again.");
      return;
    }

    setTaxBulkSaving(true);
    const { data, error: bulkSaveError } = await supabase.rpc("erp_inventory_sku_tax_bulk_upsert", {
      p_rows: validRows.map((row) => ({
        style_code: row.style_code,
        hsn: row.hsn,
        gst_rate: row.gst_rate ?? 5,
      })),
    });

    if (bulkSaveError) {
      setTaxBulkError(bulkSaveError.message);
      setTaxBulkSaving(false);
      return;
    }

    setTaxBulkResult((data || null) as BulkUpsertResult | null);
    setTaxBulkSaving(false);
  };

  function getPreviewSizeAndColor(row: ImportRow) {
    const { sizeValue, colorValue, hasOptionData } = deriveSizeAndColorFromOptions(row);
    const skuFallback = deriveSizeAndColorFromSku(row.sku.trim());
    let resolvedSize: string | null = sizeValue;
    let resolvedColor: string | null = colorValue;

    if (!hasOptionData) {
      resolvedSize = skuFallback.sizeValue;
      resolvedColor = skuFallback.colorValue;
    } else {
      if (!resolvedSize) resolvedSize = skuFallback.sizeValue;
      if (!resolvedColor) resolvedColor = skuFallback.colorValue;
    }

    return { size: resolvedSize, color: resolvedColor };
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
    const errorBuckets = new Map<string, number[]>();
    const productCreationIssues: string[] = [];

    const addRowError = (reason: string, rowNumber: number) => {
      const existing = errorBuckets.get(reason) || [];
      existing.push(rowNumber);
      errorBuckets.set(reason, existing);
    };

    const styleTitleMap = new Map<string, string>();
    const styleCodes = new Set<string>();
    importRows.forEach((row) => {
      const skuTrim = row.sku.trim();
      if (!skuTrim) return;
      const { styleCode } = deriveSizeAndColorFromSku(skuTrim);
      if (!styleCode) return;
      styleCodes.add(styleCode);
      const title = row.title.trim();
      if (title && !styleTitleMap.has(styleCode)) {
        styleTitleMap.set(styleCode, title);
      }
    });

    const missingStyles = Array.from(styleCodes).filter((styleCode) => !productMap.has(styleCode.toLowerCase()));
    let createdProducts = 0;

    if (missingStyles.length) {
      for (const styleCode of missingStyles) {
        const title = styleTitleMap.get(styleCode) || `Style ${styleCode}`;
        if (dryRun) {
          createdProducts += 1;
          productMap.set(styleCode.toLowerCase(), { id: `dry-${styleCode}`, title, style_code: styleCode });
        } else {
          const { data, error: insertError } = await supabase.rpc("erp_inventory_product_create", {
            p_title: title,
            p_style_code: styleCode,
            p_hsn_code: null,
            p_status: "draft",
          });
          const productId = typeof data === "object" && data ? (data as { id?: string }).id : null;
          if (insertError || !productId) {
            productCreationIssues.push(styleCode);
            continue;
          }
          createdProducts += 1;
          productMap.set(styleCode.toLowerCase(), {
            id: productId,
            title,
            style_code: styleCode,
          } as ProductOption);
        }
      }
    }

    importRows.forEach((row) => {
      const skuTrim = row.sku.trim();

      if (!skuTrim) {
        addRowError("Missing Variant SKU", row.rowNumber);
        return;
      }

      const costValue = row.costRaw.trim();
      if (costValue && Number.isNaN(Number(costValue))) {
        addRowError("Cost per item must be a number", row.rowNumber);
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
        addRowError("SKU must include a style code segment", row.rowNumber);
        return;
      }

      if (!resolvedSize) {
        addRowError("Missing size for SKU", row.rowNumber);
        return;
      }

      if (seenSkus.has(skuTrim)) {
        skippedRows.push(row.rowNumber);
        return;
      }

      seenSkus.add(skuTrim);
      pendingRows.push({ ...row, skuTrim, styleCode, sizeValue: resolvedSize, colorValue: resolvedColor });
    });

    let createdSkus = 0;
    if (dryRun) {
      createdSkus = pendingRows.length;
    } else {
      for (const row of pendingRows) {
        const product = productMap.get(row.styleCode.toLowerCase());
        if (!product) {
          addRowError("Product will be auto-created from style code", row.rowNumber);
          continue;
        }
        const payload = {
          p_id: null,
          p_product_id: product.id,
          p_sku: row.skuTrim,
          p_size: row.sizeValue,
          p_color: row.colorValue,
          p_cost_price: row.costRaw.trim() ? Number(row.costRaw.trim()) : null,
          p_selling_price: null,
        };
        const { error: insertError } = await supabase.rpc("erp_inventory_variant_upsert", payload);
        if (insertError) {
          addRowError(insertError.message, row.rowNumber);
          continue;
        }
        createdSkus += 1;
      }
    }

    const errors = Array.from(errorBuckets.entries()).map(([reason, rows]) => {
      const uniqueRows = Array.from(new Set(rows)).sort((a, b) => a - b);
      return `${reason} (rows: ${uniqueRows.join(", ")})`;
    });
    if (productCreationIssues.length) {
      errors.push(`Failed to create products (styles: ${productCreationIssues.join(", ")})`);
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
            Accepts Shopify product export CSV files. Required header: Variant SKU. Size comes from Option1 Value or
            SKU. Color is optional. Optional: Title, Option2 Value (Color), Cost per item.
          </p>
          <p style={mutedStyle}>Product will be auto-created from style code.</p>
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
                      {previewRows.map((row) => {
                        const preview = getPreviewSizeAndColor(row);
                        return (
                          <tr key={row.rowNumber}>
                            <td style={tableCellStyle}>{row.sku || "—"}</td>
                            <td style={tableCellStyle}>{row.title || "(inherits from style)"}</td>
                            <td style={tableCellStyle}>{preview.size || "—"}</td>
                            <td style={tableCellStyle}>{preview.color || "—"}</td>
                            <td style={tableCellStyle}>{row.costRaw || "—"}</td>
                          </tr>
                        );
                      })}
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

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>GST / HSN Mapping (Bulk Paste)</h2>
          <p style={mutedStyle}>
            Paste style_code, HSN, optional GST rate (defaults to 5). This updates all SKUs under the style.
          </p>
          {!canManageTax ? (
            <p style={mutedStyle}>Only finance/admin/owner can update GST mappings.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Bulk paste</span>
                <textarea
                  rows={6}
                  value={taxBulkText}
                  onChange={(event) => setTaxBulkText(event.target.value)}
                  style={{ ...inputStyle, fontFamily: "monospace" }}
                  placeholder={`MGSW29,61124990,5\nMWSJ14 61124990\nMWSW06\t61124990\t5`}
                />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={secondaryButtonStyle} onClick={handleTaxBulkValidate}>
                  Validate
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handleTaxBulkSave}
                  disabled={taxBulkSaving}
                >
                  {taxBulkSaving ? "Saving…" : "Save Bulk"}
                </button>
              </div>
            </div>
          )}

          {taxBulkPreview.length > 0 && (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ paddingBottom: 8 }}>Line</th>
                    <th style={{ paddingBottom: 8 }}>Style Code</th>
                    <th style={{ paddingBottom: 8 }}>HSN</th>
                    <th style={{ paddingBottom: 8 }}>GST Rate</th>
                    <th style={{ paddingBottom: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {taxBulkPreview.map((row) => (
                    <tr key={`${row.line}-${row.raw}`} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "8px 0" }}>{row.line}</td>
                      <td style={{ padding: "8px 0" }}>{row.style_code || "—"}</td>
                      <td style={{ padding: "8px 0" }}>{row.hsn || "—"}</td>
                      <td style={{ padding: "8px 0" }}>{row.gst_rate ?? "—"}</td>
                      <td style={{ padding: "8px 0" }}>
                        {row.status === "ok" ? (
                          <span style={{ color: "#047857" }}>OK</span>
                        ) : (
                          <span style={{ color: "#b91c1c" }}>{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {taxBulkResult && (
            <div style={{ marginTop: 12, color: "#047857" }}>
              Bulk save complete: updated {taxBulkResult.updated}, errors {taxBulkResult.errors}.
              {taxBulkResult.error_rows && taxBulkResult.error_rows.length > 0 && (
                <div style={{ marginTop: 8, color: "#b91c1c" }}>
                  <strong>First errors:</strong>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {taxBulkResult.error_rows.slice(0, 10).map((row) => (
                      <li key={`${row.line}-${row.style_code}-${row.hsn}`}>
                        Line {row.line}: {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {taxBulkError && <p style={{ color: "#b91c1c", marginTop: 12 }}>{taxBulkError}</p>}
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
                <th style={tableHeaderCellStyle}>Cost (Override)</th>
                <th style={tableHeaderCellStyle}>Effective Unit Cost</th>
                <th style={tableHeaderCellStyle}>Effective Stock Value</th>
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
                  <td
                    style={tableCellStyle}
                    title={
                      row.ledger_unit_cost != null ? `Ledger: ${inrFormatter.format(row.ledger_unit_cost)}` : undefined
                    }
                  >
                    {row.cost_override != null ? inrFormatter.format(row.cost_override) : "—"}
                  </td>
                  <td style={tableCellStyle}>
                    {row.effective_unit_cost != null ? inrFormatter.format(row.effective_unit_cost) : "—"}
                  </td>
                  <td style={tableCellStyle}>
                    {row.effective_stock_value != null ? inrFormatter.format(row.effective_stock_value) : "—"}
                  </td>
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
                  <td colSpan={10} style={emptyStateStyle}>
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
