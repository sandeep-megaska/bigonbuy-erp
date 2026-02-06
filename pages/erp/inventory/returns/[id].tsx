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
import { apiFetch } from "../../../../lib/erp/apiFetch";

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

type ReturnHeader = {
  id: string;
  status: string;
  warehouse_id: string;
  receipt_date: string;
  receipt_type: string;
  reference: string | null;
  notes: string | null;
  posted_at: string | null;
  party_type: "vendor" | "customer" | null;
  party_id: string | null;
  party_name: string | null;
};

type ReturnLineRow = {
  id: string;
  variant_id: string;
  qty: number;
  condition: string | null;
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
    condition: "",
  };
}

export default function ReturnReceiptDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReturnHeader | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lines, setLines] = useState<InventoryLine[]>([createEmptyLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);
  const isDraft = receipt?.status === "draft";

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

      await loadReceipt(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadReceipt = useCallback(async (companyId: string, receiptId: string, isActive = true) => {
    setError(null);
    setNotice(null);

    const [receiptRes, lineRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_return_receipts")
        .select("id, status, warehouse_id, receipt_date, receipt_type, reference, notes, posted_at, party_type, party_id, party_name")
        .eq("company_id", companyId)
        .eq("id", receiptId)
        .single(),
      supabase
        .from("erp_return_receipt_lines")
        .select("id, variant_id, qty, condition")
        .eq("company_id", companyId)
        .eq("receipt_id", receiptId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_warehouses").select("id, name, code").eq("company_id", companyId).order("name"),
    ]);

    if (receiptRes.error || lineRes.error || warehouseRes.error) {
      if (isActive) {
        setError(
          receiptRes.error?.message ||
            lineRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load return receipt."
        );
      }
      return;
    }

    const receiptHeader = receiptRes.data as ReturnHeader;
    const lineRows = (lineRes.data || []) as ReturnLineRow[];

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
      setReceipt(receiptHeader);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      if (lineRows.length > 0) {
        setLines(
          lineRows.map((line) => ({
            id: line.id,
            variant_id: line.variant_id,
            qty: line.qty.toString(),
            variant: variantMap.get(line.variant_id) || null,
            condition: line.condition ?? "",
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
    const parsedLines: Array<{ variant_id: string; qty: number; condition?: string | null }> = [];

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
      parsedLines.push({
        variant_id: line.variant_id,
        qty,
        condition: line.condition ? line.condition : null,
      });
    });

    return { errors, parsedLines };
  }, []);

  const handleResolveVariantBySku = useCallback(async (sku: string) => resolveVariantBySku(sku), []);

  const handleScanResolvedVariant = useCallback((variant: VariantSearchResult) => {
    setLines((prev) => upsertQtyLine(prev, variant, 1));
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!receipt || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to update return receipts.");
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

    const headerRes = await supabase.rpc("erp_return_receipt_update_header", {
      p_receipt_id: receipt.id,
      p_warehouse_id: receipt.warehouse_id,
      p_receipt_type: receipt.receipt_type,
      p_receipt_date: receipt.receipt_date,
      p_reference: receipt.reference,
      p_notes: receipt.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update receipt header.");
      setSaving(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_return_receipt_upsert_lines", {
      p_receipt_id: receipt.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save receipt lines.");
      setSaving(false);
      return;
    }

    await supabase
      .from("erp_return_receipts")
      .update({
        party_type: receipt.party_type,
        party_id: receipt.party_id,
        party_name: receipt.party_name,
      })
      .eq("id", receipt.id)
      .eq("company_id", ctx.companyId);

    setNotice("Draft saved.");
    setSaving(false);
    await loadReceipt(ctx.companyId, receipt.id, true);
  }, [receipt, ctx?.companyId, canWrite, lines, validateLines, loadReceipt]);

  const handlePost = useCallback(async () => {
    if (!receipt || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post return receipts.");
      return;
    }

    const { errors, parsedLines } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before posting.");
      return;
    }

    if (!window.confirm("Post this return receipt? This cannot be undone.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setNotice(null);

    const headerRes = await supabase.rpc("erp_return_receipt_update_header", {
      p_receipt_id: receipt.id,
      p_warehouse_id: receipt.warehouse_id,
      p_receipt_type: receipt.receipt_type,
      p_receipt_date: receipt.receipt_date,
      p_reference: receipt.reference,
      p_notes: receipt.notes,
    });

    if (headerRes.error) {
      setError(headerRes.error.message || "Failed to update receipt header.");
      setPosting(false);
      return;
    }

    const linesRes = await supabase.rpc("erp_return_receipt_upsert_lines", {
      p_receipt_id: receipt.id,
      p_lines: parsedLines,
    });

    if (linesRes.error) {
      setError(linesRes.error.message || "Failed to save receipt lines.");
      setPosting(false);
      return;
    }

    await supabase
      .from("erp_return_receipts")
      .update({
        party_type: receipt.party_type,
        party_id: receipt.party_id,
        party_name: receipt.party_name,
      })
      .eq("id", receipt.id)
      .eq("company_id", ctx.companyId);

    const { data, error: postError } = await supabase.rpc("erp_return_receipt_post", {
      p_receipt_id: receipt.id,
    });

    if (postError) {
      setError(postError.message || "Failed to post receipt.");
      setPosting(false);
      return;
    }

    const parseResult = postResponseSchema.safeParse(data);
    if (!parseResult.success) {
      setError("Failed to parse post response.");
      setPosting(false);
      return;
    }

    setNotice(`Receipt posted (${parseResult.data.posted_lines} lines).`);
    setPosting(false);
    await loadReceipt(ctx.companyId, receipt.id, true);
  }, [receipt, ctx?.companyId, canWrite, lines, validateLines, loadReceipt]);

  const updateHeader = useCallback(
    (updates: Partial<ReturnHeader>) => {
      setReceipt((prev) => (prev ? { ...prev, ...updates } : prev));
    },
    []
  );

  const handleCreateFinanceNote = useCallback(async () => {
    if (!ctx?.companyId || !receipt) return;
    const accessToken = (await supabase.auth.getSession()).data.session?.access_token || null;
    if (!accessToken) {
      setError("Not authenticated.");
      return;
    }

    setCreatingNote(true);
    setError(null);
    const partyType = receipt.party_type || (receipt.receipt_type === "return" || receipt.receipt_type === "rto" ? "customer" : "vendor");
    const noteKind = partyType === "vendor" ? "debit" : "credit";

    const response = await apiFetch("/api/finance/notes/from-return-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        companyId: ctx.companyId,
        returnReceiptId: receipt.id,
        partyType,
        noteKind,
        reason: receipt.notes,
      }),
    });

    const payload = (await response.json()) as { ok: true; noteId: string } | { ok: false; error: string };
    if (!payload.ok) {
      setCreatingNote(false);
      setError(payload.error || "Failed to create finance note.");
      return;
    }

    setCreatingNote(false);
    router.push(`/erp/finance/notes/${payload.noteId}`);
  }, [ctx?.companyId, receipt, router]);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading return receipt…</div>
      </ErpShell>
    );
  }

  if (!receipt) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error || "Return receipt not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Returns/RTO</p>
            <h1 style={h1Style}>Return Receipt</h1>
            <p style={subtitleStyle}>Capture customer returns and RTO receipts into Jaipur warehouse.</p>
          </div>
          <div style={statusPillStyle}>{receipt.status}</div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={headerGridStyle}>
            <label style={{ display: "grid", gap: 6 }}>
              Receipt Date
              <input
                style={inputStyle}
                type="date"
                value={receipt.receipt_date}
                onChange={(event) => updateHeader({ receipt_date: event.target.value })}
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Warehouse
              <select
                style={inputStyle}
                value={receipt.warehouse_id}
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
              Receipt Type
              <select
                style={inputStyle}
                value={receipt.receipt_type}
                onChange={(event) => updateHeader({ receipt_type: event.target.value })}
                disabled={!isDraft}
              >
                <option value="return">Return</option>
                <option value="rto">RTO</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reference
              <input
                style={inputStyle}
                value={receipt.reference ?? ""}
                onChange={(event) => updateHeader({ reference: event.target.value })}
                placeholder="Order ID / AWB"
                disabled={!isDraft}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Party Type
              <select
                style={inputStyle}
                value={receipt.party_type ?? ""}
                onChange={(event) => updateHeader({ party_type: (event.target.value || null) as "vendor" | "customer" | null })}
                disabled={!isDraft}
              >
                <option value="">Select</option>
                <option value="customer">Customer</option>
                <option value="vendor">Vendor</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Party Name
              <input
                style={inputStyle}
                value={receipt.party_name ?? ""}
                onChange={(event) => updateHeader({ party_name: event.target.value || null })}
                placeholder="Customer / Vendor"
                disabled={!isDraft}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={receipt.notes ?? ""}
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
            showCondition
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
            {posting ? "Posting…" : "Post Receipt"}
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={handleCreateFinanceNote} disabled={creatingNote}>
            {creatingNote
              ? "Creating…"
              : receipt.receipt_type === "return" || receipt.receipt_type === "rto"
                ? "Create Customer Credit Note"
                : "Create Vendor Debit Note"}
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
  backgroundColor: "#ecfeff",
  color: "#0e7490",
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
