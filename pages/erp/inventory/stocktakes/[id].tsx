import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import StocktakeLinesEditor, { type StocktakeLine } from "../../../../components/inventory/StocktakeLinesEditor";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import type { VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

type StocktakeHeader = {
  id: string;
  status: string;
  warehouse_id: string;
  stocktake_date: string;
  reference: string | null;
  notes: string | null;
  posted_at: string | null;
};

type StocktakeLineRow = {
  id: string;
  variant_id: string;
  counted_qty: number;
};

type PreviewRow = {
  variant_id: string;
  sku: string;
  product_title: string;
  size: string | null;
  color: string | null;
  on_hand: number;
  counted_qty: number;
  delta: number;
};

const previewRowSchema = z.object({
  variant_id: z.string().uuid(),
  sku: z.string(),
  product_title: z.string(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  on_hand: z.coerce.number().int(),
  counted_qty: z.coerce.number().int(),
  delta: z.coerce.number().int(),
});

const previewResponseSchema = z.array(previewRowSchema);

const postResponseSchema = z.object({
  ok: z.boolean(),
  posted_lines: z.number(),
});

const createLineId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createEmptyLine(): StocktakeLine {
  return {
    id: createLineId(),
    variant_id: "",
    counted_qty: "",
    variant: null,
  };
}

export default function StocktakeDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stocktake, setStocktake] = useState<StocktakeHeader | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lines, setLines] = useState<StocktakeLine[]>([createEmptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [posting, setPosting] = useState(false);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);
  const isDraft = stocktake?.status === "draft";
  const editorDisabled = !isDraft || !canWrite;

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (typeof id !== "string") {
        setLoading(false);
        return;
      }

      await loadStocktake(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadStocktake = useCallback(async (companyId: string, stocktakeId: string, isActive = true) => {
    setError(null);
    setNotice(null);

    const [headerRes, lineRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_stocktakes")
        .select("id, status, warehouse_id, stocktake_date, reference, notes, posted_at")
        .eq("company_id", companyId)
        .eq("id", stocktakeId)
        .single(),
      supabase
        .from("erp_stocktake_lines")
        .select("id, variant_id, counted_qty")
        .eq("company_id", companyId)
        .eq("stocktake_id", stocktakeId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId).order("name"),
    ]);

    if (headerRes.error || lineRes.error || warehouseRes.error) {
      if (isActive) {
        setError(
          headerRes.error?.message ||
            lineRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load stocktake."
        );
      }
      return;
    }

    const header = headerRes.data as StocktakeHeader;
    const lineRows = (lineRes.data || []) as StocktakeLineRow[];

    const variantIds = lineRows.map((line) => line.variant_id);
    let variantMap = new Map<string, VariantSearchResult>();

    if (variantIds.length > 0) {
      const { data: variantRows, error: variantError } = await supabase
        .from("erp_variants")
        .select("id, sku, size, color, product_id, erp_products(title, hsn_code, style_code)")
        .in("id", variantIds);

      if (variantError) {
        if (isActive) setError(variantError.message || "Failed to load variants.");
        return;
      }

      (variantRows || []).forEach((row) => {
        const product = (row as { erp_products?: { title?: string | null; hsn_code?: string | null; style_code?: string | null } })
          .erp_products;
        variantMap.set(row.id, {
          variant_id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          product_id: row.product_id,
          style_code: product?.style_code ?? null,
          title: product?.title ?? null,
          hsn_code: product?.hsn_code ?? null,
        });
      });
    }

    if (isActive) {
      setStocktake(header);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      if (lineRows.length > 0) {
        setLines(
          lineRows.map((line) => ({
            id: line.id,
            variant_id: line.variant_id,
            counted_qty: line.counted_qty.toString(),
            variant: variantMap.get(line.variant_id) || null,
          }))
        );
      } else {
        setLines([createEmptyLine()]);
      }
    }
  }, []);

  const handleAddLine = useCallback(() => {
    setLines((prev) => [...prev, createEmptyLine()]);
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== lineId)));
  }, []);

  const handleUpdateLine = useCallback((lineId: string, updates: Partial<StocktakeLine>) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...updates } : line)));
  }, []);

  const validateLines = useCallback((lineItems: StocktakeLine[]) => {
    const errors: Record<string, string> = {};
    const parsedLines: Array<{ variant_id: string; counted_qty: number }> = [];

    lineItems.forEach((line) => {
      if (!line.variant_id) {
        errors[line.id] = "Select a SKU.";
        return;
      }
      const counted = Number(line.counted_qty);
      if (!Number.isFinite(counted) || counted < 0 || !Number.isInteger(counted)) {
        errors[line.id] = "Enter a whole number greater than or equal to 0.";
        return;
      }
      parsedLines.push({ variant_id: line.variant_id, counted_qty: counted });
    });

    return { errors, parsedLines };
  }, []);

  const persistDraft = useCallback(async () => {
    if (!stocktake || !ctx?.companyId) return false;
    if (!canWrite) {
      setError("You do not have permission to update stocktakes.");
      return false;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before saving.");
      return false;
    }

    const headerRes = await supabase
      .from("erp_stocktakes")
      .update({
        warehouse_id: stocktake.warehouse_id,
        stocktake_date: stocktake.stocktake_date,
        reference: stocktake.reference,
        notes: stocktake.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stocktake.id)
      .eq("company_id", ctx.companyId)
      .eq("status", "draft");

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update stocktake header.");
      return false;
    }

    const linesRes = await supabase.rpc("erp_stocktake_save_lines", {
      p_id: stocktake.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save stocktake lines.");
      return false;
    }

    return true;
  }, [stocktake, ctx?.companyId, canWrite, lines, validateLines]);

  const handleSaveDraft = useCallback(async () => {
    if (!stocktake || !ctx?.companyId) return;
    if (!isDraft) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    const ok = await persistDraft();
    if (!ok) {
      setSaving(false);
      return;
    }

    setNotice("Draft saved.");
    setSaving(false);
    await loadStocktake(ctx.companyId, stocktake.id, true);
  }, [stocktake, ctx?.companyId, isDraft, persistDraft, loadStocktake]);

  const handlePreview = useCallback(async () => {
    if (!stocktake || !ctx?.companyId) return;

    setPreviewing(true);
    setError(null);
    setNotice(null);

    if (isDraft) {
      const ok = await persistDraft();
      if (!ok) {
        setPreviewing(false);
        return;
      }
    }

    const { data, error: previewError } = await supabase.rpc("erp_stocktake_preview_deltas", {
      p_id: stocktake.id,
    });

    if (previewError) {
      setError(previewError.message || "Failed to preview deltas.");
      setPreviewing(false);
      return;
    }

    const parseResult = previewResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse preview response.");
      setPreviewing(false);
      return;
    }

    setPreviewRows(parseResult.data as PreviewRow[]);
    setPreviewing(false);
  }, [stocktake, ctx?.companyId, isDraft, persistDraft]);

  const handlePost = useCallback(async () => {
    if (!stocktake || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post stocktakes.");
      return;
    }

    if (!isDraft) return;

    if (!window.confirm("This will create adjustment ledger entries.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setNotice(null);

    const ok = await persistDraft();
    if (!ok) {
      setPosting(false);
      return;
    }

    const { data, error: postError } = await supabase.rpc("erp_stocktake_post", {
      p_id: stocktake.id,
    });

    if (postError) {
      setError(postError.message || "Failed to post stocktake.");
      setPosting(false);
      return;
    }

    const parseResult = postResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse post response.");
      setPosting(false);
      return;
    }

    setNotice(`Stocktake posted (${parseResult.data.posted_lines} adjustments).`);
    setPosting(false);
    await loadStocktake(ctx.companyId, stocktake.id, true);
  }, [stocktake, ctx?.companyId, canWrite, isDraft, persistDraft, loadStocktake]);

  const updateHeader = useCallback((updates: Partial<StocktakeHeader>) => {
    setStocktake((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const deltaStyle = useCallback((delta: number) => {
    if (delta > 0) return { color: "#166534", fontWeight: 600 };
    if (delta < 0) return { color: "#b91c1c", fontWeight: 600 };
    return { color: "#475569", fontWeight: 600 };
  }, []);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading stocktake…</div>
      </ErpShell>
    );
  }

  if (!stocktake) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error || "Stocktake not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stocktakes</p>
            <h1 style={h1Style}>Stocktake</h1>
            <p style={subtitleStyle}>
              {stocktake.status === "posted" ? "Posted stocktake adjustments." : "Draft stocktake ready for review."}
            </p>
          </div>
          <div style={statusBadgeStyle}>{stocktake.status.toUpperCase()}</div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={headerGridStyle}>
            <label style={fieldStyle}>
              Warehouse
              <select
                style={inputStyle}
                value={stocktake.warehouse_id}
                onChange={(event) => updateHeader({ warehouse_id: event.target.value })}
                disabled={editorDisabled}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              Stocktake Date
              <input
                style={inputStyle}
                type="date"
                value={stocktake.stocktake_date}
                onChange={(event) => updateHeader({ stocktake_date: event.target.value })}
                disabled={editorDisabled}
              />
            </label>
            <label style={fieldStyle}>
              Reference
              <input
                style={inputStyle}
                value={stocktake.reference || ""}
                onChange={(event) => updateHeader({ reference: event.target.value })}
                placeholder="Cycle Count Week 3"
                disabled={editorDisabled}
              />
            </label>
          </div>
          <label style={{ ...fieldStyle, marginTop: 12 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={stocktake.notes || ""}
              onChange={(event) => updateHeader({ notes: event.target.value })}
              placeholder="Optional notes..."
              disabled={editorDisabled}
            />
          </label>
          {stocktake.posted_at ? (
            <div style={postedMetaStyle}>Posted at {new Date(stocktake.posted_at).toLocaleString()}</div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Counted Lines</h2>
          <StocktakeLinesEditor
            lines={lines}
            lineErrors={lineErrors}
            disabled={editorDisabled}
            onAddLine={handleAddLine}
            onRemoveLine={handleRemoveLine}
            onUpdateLine={handleUpdateLine}
            onVariantError={(message) => setError(message)}
          />
        </section>

        <section style={buttonRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handlePreview}
            disabled={previewing || (!canWrite && isDraft)}
          >
            {previewing ? "Previewing…" : "Preview Deltas"}
          </button>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={handleSaveDraft}
              disabled={!isDraft || saving || !canWrite}
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={handlePost}
              disabled={!isDraft || posting || !canWrite}
            >
              {posting ? "Posting…" : "Post Stocktake"}
            </button>
          </div>
        </section>

        {previewRows.length > 0 ? (
          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>Preview Deltas</h2>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>On Hand</th>
                  <th style={tableHeaderCellStyle}>Counted</th>
                  <th style={tableHeaderCellStyle}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.variant_id}>
                    <td style={tableCellStyle}>
                      <div>{row.sku}</div>
                      <div style={mutedTextStyle}>
                        {row.product_title}
                        {row.size ? ` · ${row.size}` : ""}
                        {row.color ? ` · ${row.color}` : ""}
                      </div>
                    </td>
                    <td style={tableCellStyle}>{row.on_hand}</td>
                    <td style={tableCellStyle}>{row.counted_qty}</td>
                    <td style={{ ...tableCellStyle, ...deltaStyle(row.delta) }}>{row.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}

const headerGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const fieldStyle = {
  display: "grid",
  gap: 6,
  fontSize: 14,
};

const statusBadgeStyle = {
  backgroundColor: "#e2e8f0",
  color: "#1e293b",
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
};

const sectionTitleStyle = {
  margin: "0 0 12px",
  fontSize: 16,
};

const buttonRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  margin: "18px 0",
  flexWrap: "wrap" as const,
  gap: 12,
};

const postedMetaStyle = {
  marginTop: 12,
  fontSize: 12,
  color: "#64748b",
};

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  marginBottom: 16,
};

const noticeStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#ecfccb",
  color: "#365314",
  marginBottom: 16,
};

const mutedTextStyle = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 4,
};
