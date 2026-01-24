import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type GrnHeader = {
  id: string;
  grn_no: string | null;
  status: string;
  received_at: string;
  purchase_order_id: string;
  created_at: string;
  notes: string | null;
};

type GrnLine = {
  id: string;
  variant_id: string;
  warehouse_id: string;
  received_qty: number;
  unit_cost: number | null;
  created_at: string;
  purchase_order_line_id: string;
};

type PurchaseOrder = {
  id: string;
  po_no: string | null;
  doc_no: string | null;
  vendor_id: string;
};

type Vendor = {
  id: string;
  legal_name: string;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type VariantInfo = {
  id: string;
  sku: string;
  title: string | null;
  hsn_code: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const tableLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};

const toastStyle = (type: "success" | "error") => ({
  border: `1px solid ${type === "success" ? "#86efac" : "#fecaca"}`,
  background: type === "success" ? "#ecfdf5" : "#fef2f2",
  color: type === "success" ? "#047857" : "#b91c1c",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
});

const formatDateForFilename = (value: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }
  return date.toISOString().slice(0, 10).replace(/-/g, "");
};

const csvEscape = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const needsQuotes = /[",\r\n]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
};

const toCsv = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","));
  return [headers.join(","), ...lines].join("\r\n");
};

const toDatetimeLocalValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (segment: number) => String(segment).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
};

export default function GrnDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [grn, setGrn] = useState<GrnHeader | null>(null);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [variants, setVariants] = useState<VariantInfo[]>([]);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);

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

      await loadGrn(context.companyId, id, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadGrn = useCallback(async (companyId: string, grnId: string, isActive = true) => {
    setError(null);
    setToast(null);

    const grnRes = await supabase
      .from("erp_grns")
      .select("id, grn_no, status, received_at, purchase_order_id, created_at, notes")
      .eq("company_id", companyId)
      .eq("id", grnId)
      .single();

    if (grnRes.error) {
      if (isActive) setError(grnRes.error.message || "Failed to load GRN.");
      return;
    }

    const grnRow = grnRes.data as GrnHeader;

    const [lineRes, warehouseRes, poRes] = await Promise.all([
      supabase
        .from("erp_grn_lines")
        .select("id, variant_id, warehouse_id, received_qty, unit_cost, created_at, purchase_order_line_id")
        .eq("company_id", companyId)
        .eq("grn_id", grnId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId),
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, doc_no, vendor_id")
        .eq("company_id", companyId)
        .eq("id", grnRow.purchase_order_id)
        .single(),
    ]);

    if (lineRes.error || warehouseRes.error || poRes.error) {
      if (isActive) {
        setError(lineRes.error?.message || warehouseRes.error?.message || poRes.error?.message || "Failed to load GRN.");
      }
      return;
    }

    const lineRows = (lineRes.data || []) as GrnLine[];
    const poRow = poRes.data as PurchaseOrder;

    let vendorRow: Vendor | null = null;

    const vendorRes = await supabase
      .from("erp_vendors")
      .select("id, legal_name")
      .eq("company_id", companyId)
      .eq("id", poRow.vendor_id)
      .single();

    if (vendorRes.error) {
      if (isActive) setError(vendorRes.error.message || "Failed to load vendor.");
      return;
    }

    vendorRow = vendorRes.data as Vendor;

    let variantRows: VariantInfo[] = [];
    const variantIds = lineRows.map((line) => line.variant_id).filter(Boolean);

    if (variantIds.length > 0) {
      const { data: variantData, error: variantError } = await supabase
        .from("erp_variants")
        .select("id, sku, product_id, erp_products(title, hsn_code)")
        .in("id", variantIds);

      if (variantError) {
        if (isActive) setError(variantError.message || "Failed to load variants.");
        return;
      }

      variantRows = (variantData || []).map((row) => {
        const product = (row as { erp_products?: { title?: string | null; hsn_code?: string | null } }).erp_products;
        return {
          id: row.id,
          sku: row.sku,
          title: product?.title ?? null,
          hsn_code: product?.hsn_code ?? null,
        };
      });
    }

    if (isActive) {
      setGrn(grnRow);
      setLines(lineRows);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
      setPurchaseOrder(poRow);
      setVendor(vendorRow);
      setVariants(variantRows);
    }
  }, []);

  const warehouseMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const isDraft = grn?.status === "draft";
  const receivedAtInput = useMemo(() => toDatetimeLocalValue(grn?.received_at ?? null), [grn?.received_at]);

  const warehouseSummary = useMemo(() => {
    if (!lines.length) return "—";
    const uniqueIds = Array.from(new Set(lines.map((line) => line.warehouse_id).filter(Boolean)));
    if (uniqueIds.length === 1) {
      return warehouseMap.get(uniqueIds[0]) || "—";
    }
    if (uniqueIds.length > 1) {
      return "Multiple";
    }
    return "—";
  }, [lines, warehouseMap]);

  const validateLines = useCallback((draftLines: GrnLine[]) => {
    const errors: Record<string, string> = {};
    let validLines = 0;

    draftLines.forEach((line) => {
      if (!line.warehouse_id) {
        errors[line.id] = "Select a warehouse.";
        return;
      }

      if (!Number.isFinite(line.received_qty) || line.received_qty <= 0) {
        errors[line.id] = "Qty must be greater than 0.";
        return;
      }

      if (!Number.isInteger(line.received_qty)) {
        errors[line.id] = "Qty must be a whole number.";
        return;
      }

      validLines += 1;
    });

    return { errors, validLines };
  }, []);

  const lineSnapshot = useMemo(() => validateLines(lines), [lines, validateLines]);
  const hasLineErrors = Object.keys(lineSnapshot.errors).length > 0;
  const canPost = isDraft && lineSnapshot.validLines > 0 && !hasLineErrors;

  const updateHeader = useCallback((updates: Partial<GrnHeader>) => {
    setGrn((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const updateLine = useCallback((lineId: string, updates: Partial<GrnLine>) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...updates } : line)));
  }, []);

  const handleExport = useCallback(async () => {
    if (!grn || exporting) return;
    setExporting(true);
    setToast(null);

    const { data, error: exportError } = await supabase.rpc("erp_grn_export_csv_rows", { p_grn_id: grn.id });

    if (exportError) {
      setToast({ type: "error", message: exportError.message || "Failed to export GRN." });
      setExporting(false);
      return;
    }

    const rows = (data || []) as Record<string, unknown>[];

    if (rows.length === 0) {
      setToast({ type: "error", message: "No GRN lines found to export." });
      setExporting(false);
      return;
    }

    const csv = toCsv(rows);
    const grnLabel = grn.grn_no || grn.id;
    const filename = `GRN_${grnLabel}_${formatDateForFilename(grn.received_at)}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setToast({ type: "success", message: "GRN CSV exported." });
    setExporting(false);
  }, [exporting, grn]);

  const handleSaveDraft = useCallback(async () => {
    if (!grn || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to update GRNs.");
      return;
    }

    const { errors } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setToast(null);

    const payload = {
      received_at: grn.received_at,
      notes: grn.notes,
      lines: lines.map((line) => ({
        id: line.id,
        purchase_order_line_id: line.purchase_order_line_id,
        variant_id: line.variant_id,
        warehouse_id: line.warehouse_id,
        received_qty: line.received_qty,
        unit_cost: line.unit_cost,
      })),
    };

    const { error: saveError } = await supabase.rpc("erp_grn_draft_save", {
      p_grn_id: grn.id,
      p_payload: payload,
    });

    if (saveError) {
      setError(saveError.message || "Failed to save draft GRN.");
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Draft GRN saved." });
    setSaving(false);
    await loadGrn(ctx.companyId, grn.id, true);
  }, [grn, ctx?.companyId, canWrite, validateLines, lines, loadGrn]);

  const handlePost = useCallback(async () => {
    if (!grn || !ctx?.companyId) return;
    if (!canWrite) {
      setError("You do not have permission to post GRNs.");
      return;
    }

    const { errors } = validateLines(lines);
    setLineErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError("Fix the line errors before posting.");
      return;
    }

    if (!window.confirm("Post this GRN? This cannot be undone.")) {
      return;
    }

    setPosting(true);
    setError(null);
    setToast(null);

    const savePayload = {
      received_at: grn.received_at,
      notes: grn.notes,
      lines: lines.map((line) => ({
        id: line.id,
        purchase_order_line_id: line.purchase_order_line_id,
        variant_id: line.variant_id,
        warehouse_id: line.warehouse_id,
        received_qty: line.received_qty,
        unit_cost: line.unit_cost,
      })),
    };

    const { error: saveError } = await supabase.rpc("erp_grn_draft_save", {
      p_grn_id: grn.id,
      p_payload: savePayload,
    });

    if (saveError) {
      setError(saveError.message || "Failed to save draft GRN.");
      setPosting(false);
      return;
    }

    const { error: postError } = await supabase.rpc("erp_grn_post", { p_grn_id: grn.id });

    if (postError) {
      setError(postError.message || "Failed to post GRN.");
      setPosting(false);
      return;
    }

    setToast({ type: "success", message: "GRN posted." });
    setPosting(false);
    await loadGrn(ctx.companyId, grn.id, true);
  }, [grn, ctx?.companyId, canWrite, validateLines, lines, loadGrn]);

  const grnLabel = grn?.grn_no || "—";
  const poLabel = purchaseOrder?.doc_no || purchaseOrder?.po_no || "—";

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>GRN {grnLabel}</h1>
            <p style={subtitleStyle}>Review, update, and post goods receipt notes.</p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/erp/inventory/grns" style={tableLinkStyle}>
              Back to GRNs
            </Link>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !grn}
              style={{
                ...secondaryButtonStyle,
                opacity: exporting || !grn ? 0.6 : 1,
                cursor: exporting || !grn ? "not-allowed" : "pointer",
              }}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <div style={subtitleStyle}>Status</div>
            <div>{grn?.status || "—"}</div>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={subtitleStyle}>Received At</span>
            {isDraft ? (
              <input
                type="datetime-local"
                style={inputStyle}
                value={receivedAtInput}
                onChange={(event) => {
                  if (!event.target.value) return;
                  updateHeader({ received_at: new Date(event.target.value).toISOString() });
                }}
              />
            ) : (
              <div>{grn ? new Date(grn.received_at).toLocaleString() : "—"}</div>
            )}
          </label>
          <div>
            <div style={subtitleStyle}>Purchase Order</div>
            {purchaseOrder ? (
              <Link href={`/erp/inventory/purchase-orders/${purchaseOrder.id}`} style={tableLinkStyle}>
                {poLabel}
              </Link>
            ) : (
              <div>{poLabel}</div>
            )}
          </div>
          <div>
            <div style={subtitleStyle}>Vendor</div>
            <div>{vendor?.legal_name || "—"}</div>
          </div>
          <div>
            <div style={subtitleStyle}>Warehouse</div>
            <div>{warehouseSummary}</div>
          </div>
          <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
            <span style={subtitleStyle}>Notes</span>
            {isDraft ? (
              <textarea
                style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                value={grn?.notes ?? ""}
                onChange={(event) => updateHeader({ notes: event.target.value })}
              />
            ) : (
              <div>{grn?.notes || "—"}</div>
            )}
          </label>
        </section>

        {isDraft ? (
          <section style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={handleSaveDraft}
              disabled={!canWrite || saving}
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              style={{
                ...primaryButtonStyle,
                opacity: !canPost || posting ? 0.6 : 1,
                cursor: !canPost || posting ? "not-allowed" : "pointer",
              }}
              onClick={handlePost}
              disabled={!canPost || posting}
            >
              {posting ? "Posting…" : "Post GRN"}
            </button>
          </section>
        ) : null}

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Item</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Qty Received</th>
                <th style={tableHeaderCellStyle}>Unit Cost</th>
                <th style={tableHeaderCellStyle}>Line Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    Loading GRN lines...
                  </td>
                </tr>
              ) : lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No lines found for this GRN.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const variant = variantMap.get(line.variant_id);
                  const lineAmount = (line.received_qty || 0) * (line.unit_cost || 0);
                  const lineError = lineErrors[line.id];
                  return (
                    <tr key={line.id}>
                      <td style={tableCellStyle}>{variant?.sku || "—"}</td>
                      <td style={tableCellStyle}>{variant?.title || "—"}</td>
                      <td style={tableCellStyle}>
                        {isDraft ? (
                          <select
                            style={inputStyle}
                            value={line.warehouse_id ?? ""}
                            onChange={(event) => updateLine(line.id, { warehouse_id: event.target.value })}
                          >
                            <option value="">Select warehouse</option>
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          warehouseMap.get(line.warehouse_id) || "—"
                        )}
                      </td>
                      <td style={tableCellStyle}>
                        {isDraft ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              style={{
                                ...inputStyle,
                                borderColor: lineError ? "#fca5a5" : "#d1d5db",
                              }}
                              value={Number.isFinite(line.received_qty) ? line.received_qty : ""}
                              onChange={(event) =>
                                updateLine(line.id, { received_qty: Number(event.target.value || 0) })
                              }
                            />
                            {lineError ? (
                              <span style={{ color: "#b91c1c", fontSize: 12 }}>{lineError}</span>
                            ) : null}
                          </div>
                        ) : (
                          line.received_qty
                        )}
                      </td>
                      <td style={tableCellStyle}>
                        {isDraft ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            style={inputStyle}
                            value={line.unit_cost ?? ""}
                            onChange={(event) =>
                              updateLine(line.id, {
                                unit_cost: event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                        ) : (
                          line.unit_cost ?? "—"
                        )}
                      </td>
                      <td style={tableCellStyle}>{lineAmount.toFixed(2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
