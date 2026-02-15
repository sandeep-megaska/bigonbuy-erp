import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
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

type TransferHeader = {
  id: string;
  status: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  reference: string | null;
  notes: string | null;
  posted_at: string | null;
};

type TransferLineRow = {
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

export default function TransferDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferHeader | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lines, setLines] = useState<InventoryLine[]>([createEmptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);
  const isDraft = transfer?.status === "draft";

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

      await loadTransfer(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadTransfer = useCallback(async (companyId: string, transferId: string, isActive = true) => {
    setError(null);
    setNotice(null);

    const [transferRes, lineRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_stock_transfers")
        .select("id, status, from_warehouse_id, to_warehouse_id, transfer_date, reference, notes, posted_at")
        .eq("company_id", companyId)
        .eq("id", transferId)
        .single(),
      supabase
        .from("erp_stock_transfer_lines")
        .select("id, variant_id, qty")
        .eq("company_id", companyId)
        .eq("transfer_id", transferId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId).order("name"),
    ]);

    if (transferRes.error || lineRes.error || warehouseRes.error) {
      if (isActive) {
        setError(
          transferRes.error?.message ||
            lineRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load transfer."
        );
      }
      return;
    }

    const transferHeader = transferRes.data as TransferHeader;
    const lineRows = (lineRes.data || []) as TransferLineRow[];

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
      setTransfer(transferHeader);
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
      parsedLines.push({ variant_id: line.variant_id, qty });
    });

    return { errors, parsedLines };
  }, []);

  const handleResolveVariantBySku = useCallback(async (sku: string) => resolveVariantBySku(sku), []);

  const handleScanResolvedVariant = useCallback((variant: VariantSearchResult) => {
    setLines((prev) => upsertQtyLine(prev, variant, 1));
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!transfer || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to update transfers.");
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

    const headerRes = await supabase.rpc("erp_stock_transfer_update_header", {
      p_transfer_id: transfer.id,
      p_from_warehouse_id: transfer.from_warehouse_id,
      p_to_warehouse_id: transfer.to_warehouse_id,
      p_transfer_date: transfer.transfer_date,
      p_reference: transfer.reference,
      p_notes: transfer.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update transfer header.");
      setSaving(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_stock_transfer_upsert_lines", {
      p_transfer_id: transfer.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save transfer lines.");
      setSaving(false);
      return;
    }

    setNotice("Draft saved.");
    setSaving(false);
    await loadTransfer(ctx.companyId, transfer.id, true);
  }, [transfer, ctx?.companyId, canWrite, lines, validateLines, loadTransfer]);

  const handlePost = useCallback(async () => {
    if (!transfer || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post transfers.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before posting.");
      return;
    }

    if (!window.confirm("Post this transfer? This cannot be undone.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_stock_transfer_update_header", {
      p_transfer_id: transfer.id,
      p_from_warehouse_id: transfer.from_warehouse_id,
      p_to_warehouse_id: transfer.to_warehouse_id,
      p_transfer_date: transfer.transfer_date,
      p_reference: transfer.reference,
      p_notes: transfer.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update transfer header.");
      setPosting(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_stock_transfer_upsert_lines", {
      p_transfer_id: transfer.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save transfer lines.");
      setPosting(false);
      return;
    }

    const { data, error: postError } = await supabase.rpc("erp_stock_transfer_post", {
      p_transfer_id: transfer.id,
    });

    if (postError) {
      setError(postError.message || "Failed to post transfer.");
      setPosting(false);
      return;
    }

    const parseResult = postResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse post response.");
      setPosting(false);
      return;
    }

    setNotice(`Transfer posted (${parseResult.data.posted_lines} lines).`);
    setPosting(false);
    await loadTransfer(ctx.companyId, transfer.id, true);
  }, [transfer, ctx?.companyId, canWrite, lines, validateLines, loadTransfer]);

  const updateHeader = useCallback(
    (updates: Partial<TransferHeader>) => {
      setTransfer((prev) => (prev ? { ...prev, ...updates } : prev));
    },
    []
  );

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading transfer…</div>
      </>
    );
  }

  if (!transfer) {
    return (
      <>
        <div style={pageContainerStyle}>{error || "Transfer not found."}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Transfers</p>
            <h1 style={h1Style}>Transfer</h1>
            <p style={subtitleStyle}>Move stock between warehouses with ledger-backed posting.</p>
          </div>
          <div style={statusPillStyle}>{transfer.status}</div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={headerGridStyle}>
            <label style={{ display: "grid", gap: 6 }}>
              Transfer Date
              <input
                style={inputStyle}
                type="date"
                value={transfer.transfer_date}
                onChange={(event) => updateHeader({ transfer_date: event.target.value })}
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              From Warehouse
              <select
                style={inputStyle}
                value={transfer.from_warehouse_id}
                onChange={(event) => updateHeader({ from_warehouse_id: event.target.value })}
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
              To Warehouse
              <select
                style={inputStyle}
                value={transfer.to_warehouse_id}
                onChange={(event) => updateHeader({ to_warehouse_id: event.target.value })}
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
              Reference
              <input
                style={inputStyle}
                value={transfer.reference ?? ""}
                onChange={(event) => updateHeader({ reference: event.target.value })}
                placeholder="Optional reference"
                disabled={!isDraft}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={transfer.notes ?? ""}
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
            disabled={!canWrite || !isDraft || posting}
          >
            {posting ? "Posting…" : "Post Transfer"}
          </button>
        </div>
      </div>
    </>
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
  backgroundColor: "#eef2ff",
  color: "#3730a3",
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
