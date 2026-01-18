import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import InventoryLinesEditor, { type InventoryLine } from "../../../../components/inventory/InventoryLinesEditor";
import ScanSkuAddBar from "../../../../components/inventory/ScanSkuAddBar";
import { upsertQtyLine } from "../../../../components/inventory/lineUpsert";
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
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import type { VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";
import { resolveVariantBySku } from "../../../../components/inventory/variantLookup";

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

type WriteoffHeader = {
  id: string;
  status: string;
  warehouse_id: string;
  writeoff_date: string;
  reason: string | null;
  ref: string | null;
  notes: string | null;
  posted_at: string | null;
};

type WriteoffLineRow = {
  id: string;
  variant_id: string;
  qty: number;
};

const postResponseSchema = z.object({
  ok: z.boolean(),
  posted_lines: z.number(),
});

const createLineId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createEmptyLine(): InventoryLine {
  return {
    id: createLineId(),
    variant_id: "",
    qty: "",
    variant: null,
  };
}

export default function InventoryWriteoffDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeoff, setWriteoff] = useState<WriteoffHeader | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lines, setLines] = useState<InventoryLine[]>([createEmptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);
  const isDraft = writeoff?.status === "draft";

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

      await loadWriteoff(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadWriteoff = useCallback(async (companyId: string, writeoffId: string, isActive = true) => {
    setError(null);
    setNotice(null);

    const [writeoffRes, lineRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_inventory_writeoffs")
        .select("id, status, warehouse_id, writeoff_date, reason, ref, notes, posted_at")
        .eq("company_id", companyId)
        .eq("id", writeoffId)
        .single(),
      supabase
        .from("erp_inventory_writeoff_lines")
        .select("id, variant_id, qty")
        .eq("company_id", companyId)
        .eq("writeoff_id", writeoffId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId).order("name"),
    ]);

    if (writeoffRes.error || lineRes.error || warehouseRes.error) {
      if (isActive) {
        setError(
          writeoffRes.error?.message ||
            lineRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load write-off."
        );
      }
      return;
    }

    const writeoffHeader = writeoffRes.data as WriteoffHeader;
    const lineRows = (lineRes.data || []) as WriteoffLineRow[];

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
      setWriteoff(writeoffHeader);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      if (lineRows.length > 0) {
        setLines(
          lineRows.map((line) => ({
            id: line.id,
            variant_id: line.variant_id,
            qty: line.qty.toString(),
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

  const handleUpdateLine = useCallback((lineId: string, updates: Partial<InventoryLine>) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...updates } : line)));
  }, []);

  const validateLines = useCallback((lineItems: InventoryLine[]) => {
    const errors: Record<string, string> = {};
    const parsedLines: Array<{ variant_id: string; qty: number }> = [];

    lineItems.forEach((line) => {
      if (!line.variant_id) {
        errors[line.id] = "Select a SKU.";
        return;
      }
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors[line.id] = "Enter a quantity greater than 0.";
        return;
      }
      if (!Number.isInteger(qty)) {
        errors[line.id] = "Quantity must be a whole number.";
        return;
      }
      parsedLines.push({
        variant_id: line.variant_id,
        qty,
      });
    });

    return { errors, parsedLines };
  }, []);

  const handleResolveVariantBySku = useCallback(async (sku: string) => resolveVariantBySku(sku), []);

  const handleScanResolvedVariant = useCallback((variant: VariantSearchResult) => {
    setLines((prev) => upsertQtyLine(prev, variant, 1));
  }, []);

  const lineSnapshot = useMemo(() => validateLines(lines), [lines, validateLines]);
  const hasLineErrors = Object.keys(lineSnapshot.errors).length > 0;
  const hasValidLines = lineSnapshot.parsedLines.length > 0;

  const handleSaveDraft = useCallback(async () => {
    if (!writeoff || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to update write-offs.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_inventory_writeoff_update_header", {
      p_id: writeoff.id,
      p_warehouse_id: writeoff.warehouse_id,
      p_date: writeoff.writeoff_date,
      p_reason: writeoff.reason,
      p_ref: writeoff.ref,
      p_notes: writeoff.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update write-off header.");
      setSaving(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_inventory_writeoff_save_lines", {
      p_id: writeoff.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save write-off lines.");
      setSaving(false);
      return;
    }

    setNotice("Draft saved.");
    setSaving(false);
    await loadWriteoff(ctx.companyId, writeoff.id, true);
  }, [writeoff, ctx?.companyId, canWrite, lines, validateLines, loadWriteoff]);

  const handlePost = useCallback(async () => {
    if (!writeoff || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post write-offs.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before posting.");
      return;
    }

    if (!window.confirm("Post this write-off? This cannot be undone.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_inventory_writeoff_update_header", {
      p_id: writeoff.id,
      p_warehouse_id: writeoff.warehouse_id,
      p_date: writeoff.writeoff_date,
      p_reason: writeoff.reason,
      p_ref: writeoff.ref,
      p_notes: writeoff.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update write-off header.");
      setPosting(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_inventory_writeoff_save_lines", {
      p_id: writeoff.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save write-off lines.");
      setPosting(false);
      return;
    }

    const { data, error: postError } = await supabase.rpc("erp_inventory_writeoff_post", {
      p_id: writeoff.id,
    });

    if (postError) {
      setError(postError.message || "Failed to post write-off.");
      setPosting(false);
      return;
    }

    const parseResult = postResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse post response.");
      setPosting(false);
      return;
    }

    setNotice(`Write-off posted (${parseResult.data.posted_lines} lines).`);
    setPosting(false);
    await loadWriteoff(ctx.companyId, writeoff.id, true);
  }, [writeoff, ctx?.companyId, canWrite, lines, validateLines, loadWriteoff]);

  const updateHeader = useCallback((updates: Partial<WriteoffHeader>) => {
    setWriteoff((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading write-off…</div>
      </ErpShell>
    );
  }

  if (!writeoff) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error || "Write-off not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Damage / Write-offs</p>
            <h1 style={h1Style}>Write-off</h1>
            <p style={subtitleStyle}>Write off damaged, lost, or unresellable inventory.</p>
          </div>
          <div style={statusPillStyle}>{writeoff.status}</div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={headerGridStyle}>
            <label style={{ display: "grid", gap: 6 }}>
              Write-off Date
              <input
                style={inputStyle}
                type="date"
                value={writeoff.writeoff_date}
                onChange={(event) => updateHeader({ writeoff_date: event.target.value })}
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Warehouse
              <select
                style={inputStyle}
                value={writeoff.warehouse_id}
                onChange={(event) => updateHeader({ warehouse_id: event.target.value })}
                disabled={!isDraft}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reason
              <input
                style={inputStyle}
                value={writeoff.reason ?? ""}
                onChange={(event) => updateHeader({ reason: event.target.value })}
                placeholder="Damaged in transit"
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reference
              <input
                style={inputStyle}
                value={writeoff.ref ?? ""}
                onChange={(event) => updateHeader({ ref: event.target.value })}
                placeholder="Return receipt / AWB"
                disabled={!isDraft}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={writeoff.notes ?? ""}
              onChange={(event) => updateHeader({ notes: event.target.value })}
              placeholder="Optional notes"
              disabled={!isDraft}
            />
          </label>
        </section>

        <section style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Lines</div>
          <ScanSkuAddBar
            resolveVariantBySku={handleResolveVariantBySku}
            onResolvedVariant={handleScanResolvedVariant}
            disabled={!isDraft}
          />
          <InventoryLinesEditor
            lines={lines}
            lineErrors={lineErrors}
            onAddLine={handleAddLine}
            onRemoveLine={handleRemoveLine}
            onUpdateLine={handleUpdateLine}
            onVariantError={(message) => setError(message)}
            disabled={!isDraft}
          />
        </section>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleSaveDraft}
            disabled={!canWrite || !isDraft || saving}
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handlePost}
            disabled={!canWrite || !isDraft || posting || !hasValidLines || hasLineErrors}
          >
            {posting ? "Posting…" : "Post Write-off"}
          </button>
        </div>
      </div>
    </ErpShell>
  );
}

const headerGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};

const statusPillStyle = {
  padding: "6px 12px",
  borderRadius: 999,
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase" as const,
};

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};

const noticeStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#ecfdf3",
  color: "#047857",
  fontSize: 14,
};
